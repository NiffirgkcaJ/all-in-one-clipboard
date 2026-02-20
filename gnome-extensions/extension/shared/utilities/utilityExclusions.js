import Atspi from 'gi://Atspi';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

// How many parent levels to walk up for each focused element
const ATSPI_PARENT_DEPTH = 5;

// Delay in milliseconds to prevent rapid focus transitions from prematurely clearing the excluded context flag.
const ATSPI_CLEAR_DELAY_MS = 500;

/**
 * Utility for handling application exclusions.
 */
export const ExclusionUtils = {
    /**
     * Whether the AT-SPI listener is active.
     * @private
     */
    _atspiListenerActive: false,

    /**
     * The AT-SPI listener for tracking focus events.
     * @private
     */
    _atspiListener: null,

    /**
     * Whether we are currently inside an excluded accessibility context.
     * Set to true when an exclusion match is found in the focus tree.
     * Clear it with a debounce when focus moves to a non-excluded top-level element.
     * @private
     */
    _inExcludedContext: false,

    /**
     * Timer ID for debounced clearing of the excluded context flag.
     * @private
     */
    _clearContextTimeoutId: 0,

    /**
     * Whether the AT-SPI listener has received at least one focus event.
     * Before this, clipboard checks default to blocked for safety.
     * @private
     */
    _atspiReady: false,

    /**
     * The exclusion list used to evaluate the context flag.
     * Cached from the last isWindowExcluded call.
     * @private
     */
    _cachedExclusions: [],

    /**
     * Reference to the extension's Gio.Settings instance.
     * Must be set via setSettings() before AT-SPI features are used.
     * @private
     */
    _settings: null,

    /**
     * Stores a reference to the extension's Gio.Settings for reading preferences.
     * Must be called once during extension initialization.
     *
     * @param {Gio.Settings} settings - The extension's settings instance.
     */
    setSettings(settings) {
        this._settings = settings;
    },

    /**
     * Lazily initializes the AT-SPI event listener for focus tracking.
     * Mirrors the event-driven approach used in the working Python test script.
     * Subsequent calls are a no-op.
     * @private
     */
    _ensureAtspiListener() {
        if (this._atspiListenerActive) return;

        try {
            // Enable the system accessibility service if it is not already active
            const a11ySettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
            if (!a11ySettings.get_boolean('toolkit-accessibility')) {
                a11ySettings.set_boolean('toolkit-accessibility', true);
            }

            if (!Atspi.is_initialized()) {
                Atspi.init();
            }

            this._atspiListener = Atspi.EventListener.new((event) => {
                try {
                    const source = event.source;
                    if (!source) return;

                    // Gather all names in the accessibility ancestor chain
                    const names = [];
                    let current = source;
                    for (let depth = 0; depth < ATSPI_PARENT_DEPTH && current; depth++) {
                        const name = current.get_name();
                        if (name) {
                            names.push(name.toLowerCase());
                        }
                        current = current.get_parent();
                    }

                    // Mark listener as ready after first event
                    this._atspiReady = true;

                    // Check if any name in the chain matches an exclusion
                    const matchesExclusion = names.some((name) => this._cachedExclusions.some((exclusion) => name.includes(exclusion)));

                    if (matchesExclusion) {
                        // Cancel any pending clear and set the flag
                        if (this._clearContextTimeoutId) {
                            GLib.source_remove(this._clearContextTimeoutId);
                            this._clearContextTimeoutId = 0;
                        }
                        this._inExcludedContext = true;
                    } else {
                        // Check if the source element is a top-level content element
                        const role = source.get_role();
                        const isTopLevel = role === Atspi.Role.DOCUMENT_WEB || role === Atspi.Role.DOCUMENT_FRAME || role === Atspi.Role.FRAME;

                        if (isTopLevel && this._inExcludedContext) {
                            // Schedule a debounced clear to prevent rapid focus transitions from prematurely clearing.
                            if (!this._clearContextTimeoutId) {
                                this._clearContextTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ATSPI_CLEAR_DELAY_MS, () => {
                                    this._inExcludedContext = false;
                                    this._clearContextTimeoutId = 0;
                                    return GLib.SOURCE_REMOVE;
                                });
                            }
                        }
                    }
                } catch {
                    // Ignore errors from individual focus events
                }
            });

            this._atspiListener.register('object:state-changed:focused');
            this._atspiListenerActive = true;

            // Seed the context flag by scanning currently focused accessible elements
            this._scanInitialFocus();
        } catch (e) {
            console.warn(`[AIO-Clipboard] AT-SPI init error: ${e.message}`);
        }
    },

    /**
     * Performs a one-time scan at startup to seed the excluded context flag.
     * Finds the currently focused accessible element and checks its ancestor chain for any exclusion matches.
     * @private
     */
    _scanInitialFocus() {
        try {
            const desktop = Atspi.get_desktop(0);
            if (!desktop) return;

            // Walk down the focused-child chain to find the deepest focused element
            let focused = desktop;
            for (let depth = 0; depth < 20; depth++) {
                const stateSet = focused.get_state_set();
                if (!stateSet) break;

                // Find the focused child
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

            // Now walk up from the focused element to gather names
            const names = [];
            let current = focused;
            for (let depth = 0; depth < ATSPI_PARENT_DEPTH && current; depth++) {
                const name = current.get_name();
                if (name) names.push(name.toLowerCase());
                current = current.get_parent();
            }

            const matchesExclusion = names.some((name) => this._cachedExclusions.some((exclusion) => name.includes(exclusion)));

            if (matchesExclusion) {
                this._inExcludedContext = true;
            }
        } catch (e) {
            console.warn(`[AIO-Clipboard] AT-SPI initial scan error: ${e.message}`);
        }
    },

    /**
     * Checks if the current accessibility context is excluded.
     * Uses a sticky flag that is set when an exclusion match appears in the focus tree, and cleared only after a debounce delay.
     *
     * @param {string[]} exclusionList - List of exclusion strings that are already normalized.
     * @returns {boolean} True if currently in an excluded context.
     * @private
     */
    _isAtspiExcluded(exclusionList) {
        // Skip AT-SPI if settings are unavailable or the user has not enabled enhanced detection
        if (!this._settings || !this._settings.get_boolean('enable-atspi-exclusion')) {
            return false;
        }

        // Ensure the system accessibility service stays enabled while this feature is active
        const a11ySettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        if (!a11ySettings.get_boolean('toolkit-accessibility')) {
            a11ySettings.set_boolean('toolkit-accessibility', true);
        }

        // Update cached exclusions so the event listener can evaluate against them
        this._cachedExclusions = exclusionList;
        this._ensureAtspiListener();

        // Allow content through until AT-SPI is ready, as primary window-based exclusion already occurred.
        if (!this._atspiReady) {
            return false;
        }

        return this._inExcludedContext;
    },

    /**
     * Checks if a window should be excluded based on the provided list.
     * Matches against Window Title, Window Class, Application Name, and Application ID.
     *
     * @param {Meta.Window} window - The window to check.
     * @param {string[]} exclusionList - List of excluded strings.
     * @returns {boolean} True if the window is excluded, false otherwise.
     */
    isWindowExcluded(window, exclusionList) {
        if (!window || !exclusionList || exclusionList.length === 0) {
            return false;
        }

        // Normalize exclusion list
        const normalizedExclusions = exclusionList.map((s) => s.toLowerCase().trim()).filter((s) => s.length > 0);

        if (normalizedExclusions.length === 0) {
            return false;
        }

        // Gather identifiers
        const identifiers = [];

        // Window Title
        const title = window.get_title();
        if (title) {
            identifiers.push(title.toLowerCase());
        }

        // Window Class
        const wmClass = window.get_wm_class();
        if (wmClass) {
            identifiers.push(wmClass.toLowerCase());
        }

        // Application Name & ID via WindowTracker
        const app = Shell.WindowTracker.get_default().get_window_app(window);
        if (app) {
            // Application Name
            identifiers.push(app.get_name().toLowerCase());

            // Application ID
            const appId = app.get_id();
            if (appId) {
                identifiers.push(appId.toLowerCase().replace('.desktop', ''));
                identifiers.push(appId.toLowerCase());
            }
        }

        // Check for match using substring matching
        if (identifiers.some((id) => normalizedExclusions.some((exclusion) => id.includes(exclusion)))) {
            return true;
        }

        // Use AT-SPI fallback to check if the focused element is within an excluded context.
        return this._isAtspiExcluded(normalizedExclusions);
    },

    /**
     * Checks if the current AT-SPI context is excluded, independent of any window.
     * Used when there is no focus window to prevent previously blocked content from leaking through.
     *
     * @param {string[]} exclusionList - List of excluded strings.
     * @returns {boolean} True if currently in an excluded context.
     */
    isContextExcluded(exclusionList) {
        if (!exclusionList || exclusionList.length === 0) return false;

        const normalizedExclusions = exclusionList.map((s) => s.toLowerCase().trim()).filter((s) => s.length > 0);
        if (normalizedExclusions.length === 0) return false;

        return this._isAtspiExcluded(normalizedExclusions);
    },

    /**
     * Cleans up resources, timeouts, and listeners.
     */
    destroy() {
        if (this._clearContextTimeoutId) {
            GLib.source_remove(this._clearContextTimeoutId);
            this._clearContextTimeoutId = 0;
        }

        if (this._atspiListenerActive && this._atspiListener) {
            this._atspiListener.deregister('object:state-changed:focused');
            this._atspiListener = null;
            this._atspiListenerActive = false;
        }

        this._cachedExclusions = [];
        this._inExcludedContext = false;
        this._atspiReady = false;
        this._settings = null;
    },
};
