import Atspi from 'gi://Atspi';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import { Debouncer } from './utilityDebouncer.js';
import { Logger } from './utilityLogger.js';

const ATSPI_PARENT_DEPTH = 50;
const ATSPI_CLEAR_DELAY_MS = 500;
const ATSPI_STICKY_CONTEXT_TTL_MS = 2500;
const ATSPI_EVENT_DEBOUNCE_MS = 40;
const ATSPI_TOP_LEVEL_ROLES = {
    DOCUMENT_WEB: Atspi.Role.DOCUMENT_WEB,
    DOCUMENT_FRAME: Atspi.Role.DOCUMENT_FRAME,
    FRAME: Atspi.Role.FRAME,
    WINDOW: Atspi.Role.WINDOW,
    APPLICATION: Atspi.Role.APPLICATION,
};

const CLIPBOARD_CHECK_DELAY_MS = 50;

/**
 * Manages clipboard exclusion rules using window level checks and AT-SPI accessibility tree traversal.
 * Tracks focused UI elements to determine whether clipboard capture should be blocked for specific applications or contexts.
 */
export class ExclusionUtils {
    /**
     * Initializes the ExclusionUtils instance.
     */
    constructor() {
        this._atspiInitialized = false;
        this._atspiListenerActive = false;
        this._atspiListener = null;
        this._inExcludedContext = false;
        this._cachedExclusions = [];
        this._processFocusDebouncer = new Debouncer(() => this._flushPendingFocusNow(), ATSPI_EVENT_DEBOUNCE_MS);
        this._clearContextTimeoutId = 0;
        this._pendingFocusSource = null;
        this._settings = null;
        this._settingsSignalIds = [];
        this._cachedHttpHandlers = new Set();
        this._lastFocusedSource = null;
        this._atspiReady = false;
        this._excludedContextExpiryMs = 0;
        this._initHttpHandlerList();
    }

    /**
     * Initializes the exclusion utility lifecycle.
     * @param {Gio.Settings} settings The extension settings object.
     */
    initialize(settings) {
        this.setSettings(settings);
        this._connectSettingsSignals();
        this.refreshExclusions(settings.get_strv('excluded-applications'));
    }

    /**
     * Stores a reference to the extension settings.
     * @param {Gio.Settings} settings The extension settings object.
     */
    setSettings(settings) {
        this._settings = settings;
    }

    /**
     * Connects settings signals for exclusion lifecycle updates.
     * @private
     */
    _connectSettingsSignals() {
        if (!this._settings || this._settingsSignalIds.length > 0) return;

        const exclusionListSignalId = this._settings.connect('changed::excluded-applications', () => {
            this.refreshExclusions(this._settings.get_strv('excluded-applications'));
        });
        this._settingsSignalIds.push(exclusionListSignalId);

        const atspiToggleSignalId = this._settings.connect('changed::enable-atspi-exclusion', () => {
            this.refreshExclusions(this._settings.get_strv('excluded-applications'));
        });
        this._settingsSignalIds.push(atspiToggleSignalId);
    }

    /**
     * Starts AT-SPI tracking if the feature is enabled.
     * @returns {boolean} True if the listener is active.
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
            try {
                this._atspiListener.deregister('object:state-changed:focused');
            } catch {
                // Ignore deregistration failures for detached or destroyed listeners
            }
            this._atspiListener = null;
            this._atspiListenerActive = false;
        }

        this._pendingFocusSource = null;
        this._lastFocusedSource = null;
        this._atspiReady = false;
        this._clearExcludedContextState();
    }

    /**
     * Updates exclusions and synchronizes listener lifecycle with settings.
     * @param {string[]} exclusionList The list of exclusion strings.
     */
    refreshExclusions(exclusionList) {
        this._cachedExclusions = this._normalizeExclusions(exclusionList);
        if (!this._settings || !this._settings.get_boolean('enable-atspi-exclusion')) {
            this.stop();
            return;
        }
        if (this._cachedExclusions.length === 0) {
            this.stop();
            return;
        }
        this.start();
    }

    /**
     * Determines whether clipboard capture should be blocked in the current context.
     * @param {Meta.Window|null} focusWindow The currently focused window.
     * @returns {boolean} True if the capture should be blocked.
     */
    shouldBlockClipboardNow(focusWindow) {
        const exclusionList = this._settings?.get_strv('excluded-applications') ?? [];
        if (!exclusionList || exclusionList.length === 0) return false;
        if (!focusWindow) return this.isContextExcluded(exclusionList);

        if (this.isWindowExcluded(focusWindow, exclusionList)) {
            return true;
        }

        // Use sticky AT-SPI state here to avoid leaks and reduce hot-path lag during focus transitions.
        return this._isStickyExcludedContextActive();
    }

    /**
     * Checks if a window should be excluded based on the provided list.
     * @param {Meta.Window} window The window to check.
     * @param {string[]} exclusionList The list of exclusion strings.
     * @returns {boolean} True if the window is excluded.
     */
    isWindowExcluded(window, exclusionList) {
        if (!window || !exclusionList) return false;

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

        if (!this._isHttpHandler(window)) {
            return false;
        }

        return this._isAtspiExcluded(normalizedExclusions);
    }

    /**
     * Checks if the current AT-SPI context is excluded.
     * @param {string[]} exclusionList The list of exclusion strings.
     * @returns {boolean} True if the context is excluded.
     */
    isContextExcluded(exclusionList) {
        if (!exclusionList) return false;
        const normalizedExclusions = exclusionList.map((s) => s.toLowerCase().trim()).filter((s) => s.length > 0);
        return this._isAtspiExcluded(normalizedExclusions);
    }

    /**
     * Checks if the given text content is excluded from metadata fetching.
     * @param {string} text The text to check.
     * @returns {boolean} True if the content is excluded.
     */
    isAddressExcluded(text) {
        if (!text || !this._settings) return false;
        const excludedAddresses = this._settings.get_strv('excluded-addresses');
        if (!excludedAddresses || excludedAddresses.length === 0) return false;

        const normalizedText = text.toLowerCase();
        const normalizedExclusions = this._normalizeExclusions(excludedAddresses);

        return normalizedExclusions.some((exclusion) => normalizedText.includes(exclusion));
    }

    /**
     * Gets the delay before checking clipboard content processing.
     * @returns {number} The delay in milliseconds.
     */
    getClipboardCheckDelayMs() {
        return CLIPBOARD_CHECK_DELAY_MS;
    }

    /**
     * Initializes AT-SPI lazily.
     * @returns {boolean} True if initialized.
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
            Logger.warn(`AT-SPI init error ${e.message}`);
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
                try {
                    if (!event || !event.source || !this._cachedExclusions.length) return;

                    const isFocusGain = event.detail1 === 1;
                    if (!isFocusGain) return;

                    this._lastFocusedSource = event.source;
                    this._pendingFocusSource = event.source;

                    this._processFocusDebouncer.trigger();
                } catch {
                    // Ignore errors from rapidly disappearing event sources.
                }
            });

            this._atspiListener.register('object:state-changed:focused');
            this._atspiListenerActive = true;
        } catch (e) {
            Logger.warn(`AT-SPI listener init error ${e.message}`);
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
        if (this._chainMatchesExclusion(names, this._cachedExclusions)) {
            this._markExcludedContextActive();
        } else {
            this._clearExcludedContextState();
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

        try {
            this._evaluateFocusSource(this._pendingFocusSource, this._cachedExclusions);
        } catch {
            // Catch and ignore errors from missing objects.
        } finally {
            this._pendingFocusSource = null;
        }
    }

    /**
     * Updates the sticky excluded context flag based on one focus source.
     * @param {Atspi.Accessible} source The accessible object source.
     * @param {string[]} exclusionList The list of exclusion strings.
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
            this._markExcludedContextActive();
            return;
        }

        let isTopLevel = false;
        try {
            isTopLevel = Object.values(ATSPI_TOP_LEVEL_ROLES).includes(source.get_role());
        } catch {
            isTopLevel = false;
        }

        if (this._inExcludedContext && isTopLevel && !this._clearContextTimeoutId) {
            this._clearContextTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ATSPI_CLEAR_DELAY_MS, () => {
                this._clearExcludedContextState();
                this._clearContextTimeoutId = 0;
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    /**
     * Checks if the current accessibility context is excluded.
     * @param {string[]} exclusionList The list of exclusion strings.
     * @returns {boolean} True if excluded.
     * @private
     */
    _isAtspiExcluded(exclusionList) {
        if (!this._settings || !this._settings.get_boolean('enable-atspi-exclusion')) {
            return false;
        }
        this._cachedExclusions = exclusionList;
        if (!this.start()) return false;

        this._flushPendingFocusNow();

        let names = [];
        if (this._lastFocusedSource) {
            try {
                // Verify that the cached source is still focused before trusting its context to prevent stale evaluations.
                const state = this._lastFocusedSource.get_state_set();
                if (state && state.contains(Atspi.StateType.FOCUSED)) {
                    names = this._getAncestorNamesFromSource(this._lastFocusedSource);
                } else {
                    this._lastFocusedSource = null;
                }
            } catch {
                this._lastFocusedSource = null;
            }
        }

        if (names.length === 0) {
            names = this._getAncestorNamesFromCurrentFocus();
        }

        const matchesLive = this._chainMatchesExclusion(names, exclusionList);

        if (matchesLive) {
            if (this._clearContextTimeoutId) {
                GLib.source_remove(this._clearContextTimeoutId);
                this._clearContextTimeoutId = 0;
            }
            this._markExcludedContextActive();
        }

        return matchesLive || this._isStickyExcludedContextActive();
    }

    /**
     * Builds lowercase ancestor outline chain starting at a specific accessible object.
     * @param {Atspi.Accessible} source The accessible object source.
     * @returns {string[]} The list of ancestor names.
     * @private
     */
    _getAncestorNamesFromSource(source) {
        const names = [];
        try {
            const app = source.get_application();
            let appName = '';
            let appDesc = '';
            if (app) {
                const rawName = app.get_name();
                if (rawName) {
                    appName = rawName.toLowerCase();
                    names.push(appName);
                }
                const rawDesc = app.get_description();
                if (rawDesc) {
                    appDesc = rawDesc.toLowerCase();
                    names.push(appDesc);
                }
            }

            const matchesDirectly = this._cachedExclusions.some((exclusion) => appName.includes(exclusion) || appDesc.includes(exclusion));
            if (matchesDirectly) {
                return names;
            }

            if (!this._isKnownHttpHandler(appName)) {
                return names;
            }

            let current = source;
            for (let depth = 0; depth < ATSPI_PARENT_DEPTH && current; depth++) {
                const name = current.get_name();
                if (name) {
                    const lowerName = name.toLowerCase();
                    names.push(lowerName);
                    if (this._cachedExclusions.some((exclusion) => lowerName.includes(exclusion))) {
                        break;
                    }
                }
                current = current.get_parent();
            }
        } catch {
            // Ignore D-Bus timeout errors common during window closing.
        }
        return names;
    }

    /**
     * Walks the AT-SPI desktop tree to find the currently focused element and return its ancestor names.
     * @returns {string[]} The list of ancestor names.
     * @private
     */
    _getAncestorNamesFromCurrentFocus() {
        const names = [];

        try {
            const desktop = Atspi.get_desktop(0);
            if (!desktop) return names;

            let focused = desktop;
            for (let depth = 0; depth < 40; depth++) {
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
     * Checks whether the name chain contains any exclusion match.
     * @param {string[]} names The list of ancestor names.
     * @param {string[]} exclusionList The list of exclusion strings.
     * @returns {boolean} True if a match is found.
     * @private
     */
    _chainMatchesExclusion(names, exclusionList) {
        return names.some((name) => exclusionList.some((exclusion) => name.includes(exclusion)));
    }

    /**
     * Normalizes exclusion entries for internal matching.
     * @param {string[]} exclusionList The list of exclusion strings.
     * @returns {string[]} The normalized list.
     * @private
     */
    _normalizeExclusions(exclusionList) {
        if (!exclusionList || exclusionList.length === 0) return [];
        return exclusionList.map((s) => s.toLowerCase().trim()).filter((s) => s.length > 0);
    }

    /**
     * Queries the system's registered application database to find all HTTP/HTTPS scheme handlers.
     * Operates dynamically via URI scheme handlers, ensuring zero-maintenance support.
     * @private
     */
    _initHttpHandlerList() {
        this._cachedHttpHandlers = new Set();
        try {
            const schemes = ['x-scheme-handler/http', 'x-scheme-handler/https'];
            for (const scheme of schemes) {
                const apps = Gio.AppInfo.get_all_for_type(scheme);
                for (const app of apps) {
                    const id = app.get_id();
                    if (id) {
                        this._cachedHttpHandlers.add(id.toLowerCase().replace('.desktop', ''));
                    }
                    const exec = app.get_executable();
                    if (exec) {
                        const cleanExec = exec.split(' ')[0];
                        const parts = cleanExec.split('/');
                        const name = parts[parts.length - 1].toLowerCase();
                        this._cachedHttpHandlers.add(name);
                    }
                }
            }
        } catch (e) {
            Logger.warn(`Failed to initialize system HTTP handler list: ${e.message}`);
        }
    }

    /**
     * Checks if an AT-SPI application name belongs to a known HTTP/HTTPS scheme handler.
     * @param {string} appName The application name to check.
     * @returns {boolean} True if it is an HTTP handler.
     * @private
     */
    _isKnownHttpHandler(appName) {
        if (!appName) return false;
        const name = appName.toLowerCase();
        return [...this._cachedHttpHandlers].some((b) => name.includes(b) || b.includes(name));
    }

    /**
     * Checks if a window is a registered HTTP/HTTPS scheme handler.
     * @param {Meta.Window} window The window to check.
     * @returns {boolean} True if the window is an HTTP handler.
     * @private
     */
    _isHttpHandler(window) {
        if (!window) return false;

        const identifiers = [];
        const wmClass = window.get_wm_class();
        if (wmClass) identifiers.push(wmClass.toLowerCase());

        const app = Shell.WindowTracker.get_default().get_window_app(window);
        if (app) {
            identifiers.push(app.get_name().toLowerCase());
            const appId = app.get_id();
            if (appId) {
                identifiers.push(appId.toLowerCase());
            }
        }

        return identifiers.some((id) => {
            return [...this._cachedHttpHandlers].some((b) => id.includes(b) || b.includes(id));
        });
    }

    /**
     * Marks excluded context as active and extends its bounded lifetime.
     * @private
     */
    _markExcludedContextActive() {
        this._inExcludedContext = true;
        this._excludedContextExpiryMs = Date.now() + ATSPI_STICKY_CONTEXT_TTL_MS;
    }

    /**
     * Clears excluded context state.
     * @private
     */
    _clearExcludedContextState() {
        this._inExcludedContext = false;
        this._excludedContextExpiryMs = 0;
    }

    /**
     * Checks whether sticky excluded context is still valid.
     * @returns {boolean} True if sticky exclusion is active and not expired.
     * @private
     */
    _isStickyExcludedContextActive() {
        if (!this._inExcludedContext) return false;
        if (Date.now() < this._excludedContextExpiryMs) return true;
        this._clearExcludedContextState();
        return false;
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
        this._cachedExclusions = [];
        this._settings = null;
        if (this._processFocusDebouncer) {
            this._processFocusDebouncer.destroy();
        }
    }
}
