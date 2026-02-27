import Atspi from 'gi://Atspi';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import { Debouncer } from './utilityDebouncer.js';

const ATSPI_PARENT_DEPTH = 12;
const ATSPI_CLEAR_DELAY_MS = 500;
const ATSPI_EVENT_DEBOUNCE_MS = 40;
const ATSPI_TOP_LEVEL_ROLES = {
    DOCUMENT_WEB: Atspi.Role.DOCUMENT_WEB,
    DOCUMENT_FRAME: Atspi.Role.DOCUMENT_FRAME,
    FRAME: Atspi.Role.FRAME,
    WINDOW: Atspi.Role.WINDOW,
    APPLICATION: Atspi.Role.APPLICATION,
};

const CLIPBOARD_CHECK_DELAY_MS = 50;
const FIRST_CLIPBOARD_WARMUP_DELAY_MS = 120;

/**
 * Manages clipboard exclusion rules using both window-level checks and AT-SPI accessibility tree traversal.
 * Tracks focused UI elements to determine whether clipboard capture should be blocked for specific applications or contexts.
 */
export class ExclusionUtils {
    /**
     * @private
     */
    constructor() {
        this._atspiInitialized = false;
        this._atspiListenerActive = false;
        this._atspiListener = null;
        this._inExcludedContext = false;
        this._atspiReady = false;
        this._cachedExclusions = [];
        this._processFocusDebouncer = new Debouncer(() => this._flushPendingFocusNow(), ATSPI_EVENT_DEBOUNCE_MS);
        this._clearContextTimeoutId = 0;
        this._pendingFocusSource = null;
        this._settings = null;
        this._settingsSignalIds = [];
        this._firstClipboardCheckPending = true;
    }

    /**
     * Stores a reference to the extension settings.
     * @param {Gio.Settings} settings
     */
    setSettings(settings) {
        this._settings = settings;
    }

    /**
     * Initializes exclusion utility lifecycle.
     * @param {Gio.Settings} settings
     */
    initialize(settings) {
        this.setSettings(settings);
        this._firstClipboardCheckPending = true;
        this._connectSettingsSignals();
        this.refreshExclusions(settings.get_strv('exclusion-list'));
    }

    /**
     * Connects settings signals for exclusion lifecycle updates.
     * @private
     */
    _connectSettingsSignals() {
        if (!this._settings || this._settingsSignalIds.length > 0) return;

        const exclusionListSignalId = this._settings.connect('changed::exclusion-list', () => {
            this.refreshExclusions(this._settings.get_strv('exclusion-list'));
        });
        this._settingsSignalIds.push(exclusionListSignalId);

        const atspiToggleSignalId = this._settings.connect('changed::enable-atspi-exclusion', () => {
            const enabled = this._settings.get_boolean('enable-atspi-exclusion');
            if (enabled) {
                this._firstClipboardCheckPending = true;
            }
            this.refreshExclusions(this._settings.get_strv('exclusion-list'));
        });
        this._settingsSignalIds.push(atspiToggleSignalId);
    }

    /**
     * Normalizes exclusion entries for internal matching.
     * @param {string[]} exclusionList
     * @returns {string[]}
     * @private
     */
    _normalizeExclusions(exclusionList) {
        if (!exclusionList || exclusionList.length === 0) return [];
        return exclusionList.map((s) => s.toLowerCase().trim()).filter((s) => s.length > 0);
    }

    /**
     * Starts AT-SPI tracking if the feature is enabled.
     * @returns {boolean}
     */
    start() {
        if (!this._settings || !this._settings.get_boolean('enable-atspi-exclusion')) {
            return false;
        }
        this._ensureAtspiListener();
        this._bootstrapInitialContext();
        return this._atspiListenerActive;
    }

    /**
     * Stops AT-SPI focus tracking and clears cached context.
     */
    stop() {
        if (this._processFocusDebouncer) {
            this._processFocusDebouncer.cancel();
        }

        if (this._clearContextTimeoutId) {
            GLib.source_remove(this._clearContextTimeoutId);
            this._clearContextTimeoutId = 0;
        }

        if (this._atspiListenerActive && this._atspiListener) {
            this._atspiListener.deregister('object:state-changed:focused');
            this._atspiListener = null;
            this._atspiListenerActive = false;
        }

        this._atspiReady = false;
        this._pendingFocusSource = null;
        this._inExcludedContext = false;
    }

    /**
     * Updates exclusions and synchronizes listener lifecycle with settings.
     * @param {string[]} exclusionList
     */
    refreshExclusions(exclusionList) {
        this._cachedExclusions = this._normalizeExclusions(exclusionList);
        if (!this._settings || !this._settings.get_boolean('enable-atspi-exclusion')) {
            this.stop();
            return;
        }
        if (this._cachedExclusions.length === 0) {
            if (this._clearContextTimeoutId) {
                GLib.source_remove(this._clearContextTimeoutId);
                this._clearContextTimeoutId = 0;
            }
            this._pendingFocusSource = null;
            this._atspiReady = false;
            this._inExcludedContext = false;
        }
        this.start();
    }

    /**
     * Gets the delay before clipboard content processing check.
     * @returns {number}
     */
    getClipboardCheckDelayMs() {
        const atspiEnabled = !!(this._settings && this._settings.get_boolean('enable-atspi-exclusion'));
        if (this._firstClipboardCheckPending) {
            this._firstClipboardCheckPending = false;
            if (atspiEnabled) {
                return FIRST_CLIPBOARD_WARMUP_DELAY_MS;
            }
        }
        return CLIPBOARD_CHECK_DELAY_MS;
    }

    /**
     * Determines whether clipboard capture should be blocked in current context.
     * @param {Meta.Window|null} focusWindow
     * @returns {boolean}
     */
    shouldBlockClipboardNow(focusWindow) {
        const exclusionList = this._settings?.get_strv('exclusion-list') ?? [];
        if (!exclusionList || exclusionList.length === 0) return false;
        if (focusWindow) return this.isWindowExcluded(focusWindow, exclusionList);
        return this.isContextExcluded(exclusionList);
    }

    /**
     * Initializes AT-SPI lazily.
     * @returns {boolean}
     * @private
     */
    _ensureAtspiInitialized() {
        if (this._atspiInitialized) return true;

        try {
            const a11ySettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
            if (!a11ySettings.get_boolean('toolkit-accessibility')) {
                a11ySettings.set_boolean('toolkit-accessibility', true);
            }

            if (!Atspi.is_initialized()) {
                Atspi.init();
            }

            this._atspiInitialized = true;
            return true;
        } catch (e) {
            console.warn(`[AIO-Clipboard] AT-SPI init error ${e.message}`);
            return false;
        }
    }

    /**
     * Initializes the AT-SPI focus listener lazily.
     * @private
     */
    _ensureAtspiListener() {
        if (this._atspiListenerActive) return;
        if (!this._ensureAtspiInitialized()) return;

        try {
            this._atspiListener = Atspi.EventListener.new((event) => {
                if (!event || !event.source || !this._cachedExclusions.length) return;

                this._pendingFocusSource = event.source;

                this._processFocusDebouncer.trigger();
            });

            this._atspiListener.register('object:state-changed:focused');
            this._atspiListenerActive = true;
        } catch (e) {
            console.warn(`[AIO-Clipboard] AT-SPI listener init error ${e.message}`);
        }
    }

    /**
     * Flushes queued focus source immediately to avoid race conditions.
     * @private
     */
    _flushPendingFocusNow() {
        if (!this._pendingFocusSource || !this._cachedExclusions.length) return;

        if (this._processFocusDebouncer) {
            this._processFocusDebouncer.cancel();
        }

        this._evaluateFocusSource(this._pendingFocusSource, this._cachedExclusions);
        this._pendingFocusSource = null;
    }

    /**
     * Builds lowercase ancestor outline chain starting at a specific accessible object.
     * @param {Atspi.Accessible} source
     * @returns {string[]}
     * @private
     */
    _getAncestorNamesFromSource(source) {
        const names = [];
        let current = source;

        for (let depth = 0; depth < ATSPI_PARENT_DEPTH && current; depth++) {
            const name = current.get_name();
            if (name) names.push(name.toLowerCase());
            current = current.get_parent();
        }

        const app = source.get_application();
        if (app) {
            const appName = app.get_name();
            if (appName) names.push(appName.toLowerCase());
            const appDesc = app.get_description();
            if (appDesc) names.push(appDesc.toLowerCase());
        }
        return names;
    }

    /**
     * Walks the AT-SPI desktop tree to find the currently focused element and return its ancestor names.
     * @returns {string[]}
     * @private
     */
    _getAncestorNamesFromCurrentFocus() {
        const names = [];

        try {
            const desktop = Atspi.get_desktop(0);
            if (!desktop) return names;

            let focused = desktop;
            for (let depth = 0; depth < 20; depth++) {
                let foundChild = null;
                const childCount = focused.get_child_count();
                for (let i = 0; i < childCount; i++) {
                    const child = focused.get_child_at_index(i);
                    if (!child) continue;

                    const childState = child.get_state_set();
                    if (childState && childState.contains(Atspi.StateType.FOCUSED)) {
                        foundChild = child;
                        break;
                    }
                }

                if (!foundChild) break;
                focused = foundChild;
            }

            return this._getAncestorNamesFromSource(focused);
        } catch {
            return names;
        }
    }

    /**
     * Checks whether name chain contains any exclusion match.
     * @param {string[]} names
     * @param {string[]} exclusionList
     * @returns {boolean}
     * @private
     */
    _chainMatchesExclusion(names, exclusionList) {
        return names.some((name) => exclusionList.some((exclusion) => name.includes(exclusion)));
    }

    /**
     * Updates sticky excluded context flag based on one focus source.
     * @param {Atspi.Accessible} source
     * @param {string[]} exclusionList
     * @private
     */
    _evaluateFocusSource(source, exclusionList) {
        if (!source || !exclusionList.length) return;

        const names = this._getAncestorNamesFromSource(source);
        const matchesExclusion = this._chainMatchesExclusion(names, exclusionList);
        this._atspiReady = true;

        if (matchesExclusion) {
            if (this._clearContextTimeoutId) {
                GLib.source_remove(this._clearContextTimeoutId);
                this._clearContextTimeoutId = 0;
            }
            this._inExcludedContext = true;
            return;
        }

        // Leaf controls inside excluded popups should not clear the sticky blocked state.
        let isTopLevel = false;
        try {
            isTopLevel = Object.values(ATSPI_TOP_LEVEL_ROLES).includes(source.get_role());
        } catch {
            isTopLevel = false;
        }

        if (this._inExcludedContext && isTopLevel && !this._clearContextTimeoutId) {
            this._clearContextTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ATSPI_CLEAR_DELAY_MS, () => {
                this._inExcludedContext = false;
                this._clearContextTimeoutId = 0;
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    /**
     * Ensures AT-SPI has produced an initial context at least once.
     * @private
     */
    _bootstrapInitialContext() {
        if (this._atspiReady || !this._cachedExclusions.length) return;
        const names = this._getAncestorNamesFromCurrentFocus();
        this._atspiReady = true;
        this._inExcludedContext = this._chainMatchesExclusion(names, this._cachedExclusions);
    }

    /**
     * Checks if the current accessibility context is excluded.
     * @param {string[]} exclusionList
     * @returns {boolean}
     * @private
     */
    _isAtspiExcluded(exclusionList) {
        if (!this._settings || !this._settings.get_boolean('enable-atspi-exclusion')) {
            return false;
        }
        this._cachedExclusions = exclusionList;
        if (!this.start()) return false;
        this._flushPendingFocusNow();
        return this._inExcludedContext;
    }

    /**
     * Checks if a window should be excluded based on the provided list.
     * @param {Meta.Window} window
     * @param {string[]} exclusionList
     * @returns {boolean}
     */
    isWindowExcluded(window, exclusionList) {
        if (!window || !exclusionList || exclusionList.length === 0) return false;

        const normalizedExclusions = exclusionList.map((s) => s.toLowerCase().trim()).filter((s) => s.length > 0);
        if (normalizedExclusions.length === 0) return false;

        const identifiers = [];
        const title = window.get_title();
        if (title) identifiers.push(title.toLowerCase());

        const wmClass = window.get_wm_class();
        if (wmClass) identifiers.push(wmClass.toLowerCase());

        const app = Shell.WindowTracker.get_default().get_window_app(window);
        if (app) {
            identifiers.push(app.get_name().toLowerCase());
            const appId = app.get_id();
            if (appId) {
                identifiers.push(appId.toLowerCase().replace('.desktop', ''));
                identifiers.push(appId.toLowerCase());
            }
        }

        if (identifiers.some((id) => normalizedExclusions.some((exclusion) => id.includes(exclusion)))) {
            return true;
        }

        return this._isAtspiExcluded(normalizedExclusions);
    }

    /**
     * Checks if the current AT-SPI context is excluded.
     * @param {string[]} exclusionList
     * @returns {boolean}
     */
    isContextExcluded(exclusionList) {
        if (!exclusionList || exclusionList.length === 0) return false;
        const normalizedExclusions = exclusionList.map((s) => s.toLowerCase().trim()).filter((s) => s.length > 0);
        if (normalizedExclusions.length === 0) return false;
        return this._isAtspiExcluded(normalizedExclusions);
    }

    /**
     * Cleans up cached AT-SPI state and listeners.
     */
    destroy() {
        this.stop();
        if (this._settings && this._settingsSignalIds.length > 0) {
            this._settingsSignalIds.forEach((id) => {
                if (id) this._settings.disconnect(id);
            });
        }
        this._settingsSignalIds = [];
        this._atspiInitialized = false;
        this._atspiReady = false;
        this._cachedExclusions = [];
        this._firstClipboardCheckPending = true;
        this._settings = null;
        if (this._processFocusDebouncer) {
            this._processFocusDebouncer.destroy();
        }
    }
}
