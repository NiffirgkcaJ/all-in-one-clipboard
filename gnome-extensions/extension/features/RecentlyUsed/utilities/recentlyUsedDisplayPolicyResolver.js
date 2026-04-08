import { RecentlyUsedLimitMode, RecentlyUsedDisplayMode, RecentlyUsedDefaultPolicy, RecentlyUsedPolicySettings } from '../constants/recentlyUsedPolicyConstants.js';

const LIMIT_MODE = RecentlyUsedLimitMode;
const DISPLAY_MODE = RecentlyUsedDisplayMode;
const DEFAULT_POLICY = RecentlyUsedDefaultPolicy;
const SETTINGS = RecentlyUsedPolicySettings;

// ========================================================================
// Settings Access Helpers
// ========================================================================

/**
 * Utility functions to resolve effective display policies for Recently Used sections based on extension settings and section configurations.
 * This includes normalization of input values, fallback to defaults, and precedence handling between global and section-specific settings.
 * The main exported function is `resolveRecentlyUsedSectionPolicy`, which returns a comprehensive policy model for a given section and context.
 * Internal helper functions handle specific aspects of policy resolution, such as reading settings with fallbacks and normalizing values.
 */
function getSettingsInt(settings, key, fallbackValue) {
    if (!settings || typeof settings.get_int !== 'function') {
        return fallbackValue;
    }

    try {
        return settings.get_int(key);
    } catch {
        return fallbackValue;
    }
}

/**
 * Safely retrieves a string value from GSettings with a fallback, handling missing keys and invalid types gracefully.
 *
 * @param {Gio.Settings} settings GSettings object to read from.
 * @param {string} key The key to retrieve.
 * @param {string} fallbackValue The value to return if retrieval fails.
 * @returns {string} The retrieved string value or the fallback.
 */
function getSettingsString(settings, key, fallbackValue) {
    if (!settings || typeof settings.get_string !== 'function') {
        return fallbackValue;
    }

    try {
        return settings.get_string(key);
    } catch {
        return fallbackValue;
    }
}

/**
 * Safely retrieves a boolean value from GSettings with a fallback, handling missing keys and invalid types gracefully.
 *
 * @param {Gio.Settings} settings GSettings object to read from.
 * @param {string} key The key to retrieve.
 * @param {boolean} fallbackValue The value to return if retrieval fails.
 * @returns {boolean} The retrieved boolean value or the fallback.
 */
function getSettingsBoolean(settings, key, fallbackValue) {
    if (!settings || typeof settings.get_boolean !== 'function') {
        return fallbackValue;
    }

    try {
        return settings.get_boolean(key);
    } catch {
        return fallbackValue;
    }
}

// ========================================================================
// Normalization Helpers
// ========================================================================

/**
 * Normalizes a value to a positive integer with a specified fallback for invalid inputs.
 *
 * @param {any} value The value to normalize.
 * @param {number} fallbackValue The value to return if normalization fails.
 * @returns {number} A positive integer or the fallback.
 */
function normalizePositiveInteger(value, fallbackValue) {
    if (!Number.isFinite(value)) {
        return fallbackValue;
    }

    const normalized = Math.floor(value);
    return normalized >= 1 ? normalized : fallbackValue;
}

/**
 * Normalizes a limit mode value to a known constant, defaulting to a fallback for invalid inputs.
 *
 * @param {string} value The limit mode value to normalize.
 * @param {string} fallbackValue The value to return if normalization fails.
 * @returns {string} A valid limit mode or the fallback.
 */
function normalizeLimitMode(value, fallbackValue) {
    if (value === LIMIT_MODE.LIMITED || value === LIMIT_MODE.UNLIMITED) {
        return value;
    }

    return fallbackValue;
}

/**
 * Normalizes a display mode value to a known constant, defaulting to a fallback for invalid inputs.
 *
 * @param {string} value The display mode value to normalize.
 * @param {string} fallbackValue The value to return if normalization fails.
 * @returns {string} A valid display mode or the fallback.
 */
function normalizeDisplayMode(value, fallbackValue) {
    if (value === DISPLAY_MODE.FIXED_WINDOW || value === DISPLAY_MODE.SCROLL_WINDOW) {
        return value;
    }

    return fallbackValue;
}

/**
 * Determines the layout family based on the effective layout and section configuration, defaulting to 'list' for invalid inputs.
 *
 * @param {string|null} effectiveLayout The effective layout string from runtime context.
 * @param {object|null} sectionConfig The section configuration object.
 * @returns {string} The normalized layout family.
 */
function normalizeLayoutFamily(effectiveLayout, sectionConfig) {
    const candidate = effectiveLayout || sectionConfig?.layoutType || 'list';

    if (candidate === 'grid' || candidate === 'nested-grid') {
        return 'grid';
    }

    return 'list';
}

/**
 * Resolves the display mode for a given layout family based on the resolved policy, applying appropriate fallbacks.
 *
 * @param {string} layoutFamily The normalized layout family.
 * @param {object} resolvedPolicy The resolved policy model containing display mode settings.
 * @returns {string} The effective display mode for the layout family.
 */
function resolveLayoutDisplayMode(layoutFamily, resolvedPolicy) {
    if (layoutFamily === 'grid') {
        return normalizeDisplayMode(resolvedPolicy.gridDisplayMode, resolvedPolicy.displayMode);
    }

    return normalizeDisplayMode(resolvedPolicy.listDisplayMode, resolvedPolicy.displayMode);
}

// ========================================================================
// Policy Model Resolution
// ========================================================================

/**
 * Reads and resolves the global display policy from GSettings, applying normalization and fallbacks for all relevant settings.
 *
 * @param {Gio.Settings} settings The GSettings object to read policy values from.
 * @returns {object} An object containing all resolved policy values with appropriate fallbacks.
 */
function readGlobalPolicy(settings) {
    const globalVisibleItems = normalizePositiveInteger(getSettingsInt(settings, SETTINGS.GLOBAL_VISIBLE_ITEMS, DEFAULT_POLICY.GLOBAL_VISIBLE_ITEMS), DEFAULT_POLICY.GLOBAL_VISIBLE_ITEMS);
    const customVisibleByView = getSettingsBoolean(settings, SETTINGS.ENABLE_CUSTOM_VISIBLE_ITEMS, DEFAULT_POLICY.CUSTOM_VISIBLE_BY_VIEW);

    let listVisibleItems = normalizePositiveInteger(getSettingsInt(settings, SETTINGS.LIST_VISIBLE_ITEMS, globalVisibleItems), globalVisibleItems);
    let gridVisibleItems = normalizePositiveInteger(getSettingsInt(settings, SETTINGS.GRID_VISIBLE_ITEMS, globalVisibleItems), globalVisibleItems);

    if (!customVisibleByView) {
        listVisibleItems = globalVisibleItems;
        gridVisibleItems = globalVisibleItems;
    }

    const globalWindowRows = normalizePositiveInteger(getSettingsInt(settings, SETTINGS.GLOBAL_WINDOW_ROWS, DEFAULT_POLICY.GLOBAL_WINDOW_ROWS), DEFAULT_POLICY.GLOBAL_WINDOW_ROWS);
    const customWindowByView = getSettingsBoolean(settings, SETTINGS.ENABLE_CUSTOM_WINDOW_LIMITS, DEFAULT_POLICY.CUSTOM_WINDOW_BY_VIEW);

    let listWindowRows = normalizePositiveInteger(getSettingsInt(settings, SETTINGS.LIST_WINDOW_ROWS, globalWindowRows), globalWindowRows);
    let gridWindowRows = normalizePositiveInteger(getSettingsInt(settings, SETTINGS.GRID_WINDOW_ROWS, globalWindowRows), globalWindowRows);
    let gridWindowColumns = normalizePositiveInteger(getSettingsInt(settings, SETTINGS.GRID_WINDOW_COLUMNS, DEFAULT_POLICY.GRID_WINDOW_COLUMNS), DEFAULT_POLICY.GRID_WINDOW_COLUMNS);

    if (!customWindowByView) {
        listWindowRows = globalWindowRows;
        gridWindowRows = globalWindowRows;
        gridWindowColumns = DEFAULT_POLICY.GRID_WINDOW_COLUMNS;
    }

    const displayMode = normalizeDisplayMode(getSettingsString(settings, SETTINGS.DEFAULT_DISPLAY_MODE, DEFAULT_POLICY.DISPLAY_MODE), DEFAULT_POLICY.DISPLAY_MODE);
    const customDisplayByView = getSettingsBoolean(settings, SETTINGS.ENABLE_CUSTOM_DISPLAY_MODE, DEFAULT_POLICY.CUSTOM_DISPLAY_BY_VIEW);

    let listDisplayMode = normalizeDisplayMode(getSettingsString(settings, SETTINGS.LIST_DISPLAY_MODE, displayMode), displayMode);
    let gridDisplayMode = normalizeDisplayMode(getSettingsString(settings, SETTINGS.GRID_DISPLAY_MODE, displayMode), displayMode);

    if (!customDisplayByView) {
        listDisplayMode = displayMode;
        gridDisplayMode = displayMode;
    }

    const defaultLimitMode = normalizeLimitMode(getSettingsString(settings, SETTINGS.DEFAULT_LIMIT_MODE, DEFAULT_POLICY.DEFAULT_LIMIT_MODE), DEFAULT_POLICY.DEFAULT_LIMIT_MODE);
    const customLimitByContext = getSettingsBoolean(settings, SETTINGS.ENABLE_CUSTOM_LIMIT_POLICY, DEFAULT_POLICY.CUSTOM_LIMIT_BY_CONTEXT);
    let historyLimitMode = normalizeLimitMode(getSettingsString(settings, SETTINGS.HISTORY_LIMIT_MODE, DEFAULT_POLICY.HISTORY_LIMIT_MODE), DEFAULT_POLICY.HISTORY_LIMIT_MODE);
    let searchLimitMode = normalizeLimitMode(getSettingsString(settings, SETTINGS.SEARCH_LIMIT_MODE, DEFAULT_POLICY.SEARCH_LIMIT_MODE), DEFAULT_POLICY.SEARCH_LIMIT_MODE);

    if (!customLimitByContext) {
        historyLimitMode = defaultLimitMode;
        searchLimitMode = defaultLimitMode;
    }
    const unlimitedSafetyCap = normalizePositiveInteger(getSettingsInt(settings, SETTINGS.UNLIMITED_SAFETY_CAP, DEFAULT_POLICY.UNLIMITED_SAFETY_CAP), DEFAULT_POLICY.UNLIMITED_SAFETY_CAP);

    return {
        globalVisibleItems,
        listVisibleItems,
        gridVisibleItems,
        globalWindowRows,
        listWindowRows,
        gridWindowRows,
        gridWindowColumns,
        defaultLimitMode,
        historyLimitMode,
        searchLimitMode,
        displayMode,
        listDisplayMode,
        gridDisplayMode,
        customDisplayByView,
        customLimitByContext,
        customVisibleByView,
        customWindowByView,
        unlimitedSafetyCap,
    };
}

/**
 * Resolves the effective limit mode for the active context.
 *
 * @param {string} contextMode Either 'history' or 'search'.
 * @param {object} resolvedPolicy Resolved display policy model.
 * @returns {string} Effective limit mode.
 */
function resolveContextLimitMode(contextMode, resolvedPolicy) {
    if (contextMode === 'search') {
        return resolvedPolicy.searchLimitMode;
    }

    return resolvedPolicy.historyLimitMode;
}

/**
 * Resolves configured cap values by layout family.
 *
 * @param {string} layoutFamily Normalized layout family.
 * @param {object} resolvedPolicy Resolved display policy model.
 * @returns {number} Effective configured cap for the layout family.
 */
function resolveConfiguredCap(layoutFamily, resolvedPolicy) {
    const listCap = resolvedPolicy.listVisibleItems;
    const gridVisibleCap = resolvedPolicy.gridVisibleItems;

    if (layoutFamily === 'grid') {
        return gridVisibleCap;
    }

    return listCap;
}

/**
 * Resolves the window limit for a given layout family based on the resolved policy, applying appropriate calculations.
 *
 * @param {string} layoutFamily The normalized layout family.
 * @param {object} resolvedPolicy The resolved policy model containing window limit settings.
 * @returns {number} The effective window limit for the layout family.
 */
function resolveWindowLimit(layoutFamily, resolvedPolicy) {
    if (layoutFamily === 'grid') {
        return resolvedPolicy.gridWindowRows * resolvedPolicy.gridWindowColumns;
    }

    return resolvedPolicy.listWindowRows;
}

// ========================================================================
// Public API
// ========================================================================

/**
 * Resolves Recently Used display policy for a section and context.
 *
 * @param {object} options Resolver options.
 * @param {Gio.Settings} options.settings Extension settings object.
 * @param {string} options.sectionId Recently Used feature id.
 * @param {object} [options.sectionConfig] Section definition.
 * @param {string} [options.effectiveLayout] Effective layout string from runtime.
 * @param {string} [options.contextMode] Either 'history' or 'search'.
 * @returns {object} Resolved policy model.
 */
export function resolveRecentlyUsedSectionPolicy({ settings, sectionId, sectionConfig = null, effectiveLayout = null, contextMode = 'history' } = {}) {
    const normalizedContextMode = contextMode === 'search' ? 'search' : 'history';
    const layoutFamily = normalizeLayoutFamily(effectiveLayout, sectionConfig);

    const effectivePolicy = readGlobalPolicy(settings);
    const gridWindowSize = effectivePolicy.gridWindowRows * effectivePolicy.gridWindowColumns;
    const windowLimit = resolveWindowLimit(layoutFamily, effectivePolicy);
    const displayMode = resolveLayoutDisplayMode(layoutFamily, effectivePolicy);

    const configuredCap = resolveConfiguredCap(layoutFamily, effectivePolicy);
    const effectiveLimitMode = resolveContextLimitMode(normalizedContextMode, effectivePolicy);
    const effectiveCap = effectiveLimitMode === LIMIT_MODE.UNLIMITED ? effectivePolicy.unlimitedSafetyCap : normalizePositiveInteger(configuredCap, windowLimit);

    return {
        sectionId: sectionId || sectionConfig?.id || null,
        contextMode: normalizedContextMode,
        layoutFamily,
        displayMode,
        historyLimitMode: effectivePolicy.historyLimitMode,
        searchLimitMode: effectivePolicy.searchLimitMode,
        effectiveLimitMode,
        limits: {
            globalVisibleItems: effectivePolicy.globalVisibleItems,
            listVisibleItems: effectivePolicy.listVisibleItems,
            gridVisibleItems: effectivePolicy.gridVisibleItems,
            globalWindowRows: effectivePolicy.globalWindowRows,
            listWindowRows: effectivePolicy.listWindowRows,
            gridWindowRows: effectivePolicy.gridWindowRows,
            gridWindowColumns: effectivePolicy.gridWindowColumns,
            listVisibleLimit: effectivePolicy.listVisibleItems,
            gridColumns: effectivePolicy.gridWindowColumns,
            gridVisibleRows: effectivePolicy.gridWindowRows,
            gridWindowSize,
            windowLimit,
            configuredCap,
            unlimitedSafetyCap: effectivePolicy.unlimitedSafetyCap,
            effectiveCap,
        },
    };
}
