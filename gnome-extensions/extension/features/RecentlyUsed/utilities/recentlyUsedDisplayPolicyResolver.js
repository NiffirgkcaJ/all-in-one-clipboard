import { RecentlyUsedLimitMode, RecentlyUsedDisplayMode, RecentlyUsedDefaultPolicy, RecentlyUsedPolicySettings } from '../constants/recentlyUsedPolicyConstants.js';

const LIMIT_MODE = RecentlyUsedLimitMode;
const DISPLAY_MODE = RecentlyUsedDisplayMode;
const DEFAULT_POLICY = RecentlyUsedDefaultPolicy;
const SETTINGS = RecentlyUsedPolicySettings;
const DEFAULT_RESOLVED_POLICY = {
    globalVisibleItems: DEFAULT_POLICY.GLOBAL_VISIBLE_ITEMS,
    listVisibleItems: DEFAULT_POLICY.LIST_VISIBLE_ITEMS,
    gridVisibleItems: DEFAULT_POLICY.GRID_VISIBLE_ITEMS,
    globalWindowRows: DEFAULT_POLICY.GLOBAL_WINDOW_ROWS,
    listWindowRows: DEFAULT_POLICY.LIST_WINDOW_ROWS,
    gridWindowRows: DEFAULT_POLICY.GRID_WINDOW_ROWS,
    gridWindowColumns: DEFAULT_POLICY.GRID_WINDOW_COLUMNS,
    defaultLimitMode: DEFAULT_POLICY.DEFAULT_LIMIT_MODE,
    historyLimitMode: DEFAULT_POLICY.HISTORY_LIMIT_MODE,
    searchLimitMode: DEFAULT_POLICY.SEARCH_LIMIT_MODE,
    displayMode: DEFAULT_POLICY.DISPLAY_MODE,
    listDisplayMode: DEFAULT_POLICY.LIST_DISPLAY_MODE,
    gridDisplayMode: DEFAULT_POLICY.GRID_DISPLAY_MODE,
    customDisplayByView: DEFAULT_POLICY.CUSTOM_DISPLAY_BY_VIEW,
    customLimitByContext: DEFAULT_POLICY.CUSTOM_LIMIT_BY_CONTEXT,
    customVisibleByView: DEFAULT_POLICY.CUSTOM_VISIBLE_BY_VIEW,
    customWindowByView: DEFAULT_POLICY.CUSTOM_WINDOW_BY_VIEW,
    unlimitedSafetyCap: DEFAULT_POLICY.UNLIMITED_SAFETY_CAP,
};

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

/**
 * Safely retrieves a parsed JSON object from GSettings.
 *
 * @param {Gio.Settings} settings GSettings object.
 * @param {string} key Key containing serialized JSON.
 * @returns {object|null} Parsed object or null.
 */
function getSettingsJsonObject(settings, key) {
    const rawValue = getSettingsString(settings, key, '{}');
    if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
        return null;
    }

    try {
        const parsed = JSON.parse(rawValue);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return null;
        }

        return parsed;
    } catch {
        return null;
    }
}

/**
 * Safely writes a JSON object into a string GSettings key.
 *
 * @param {Gio.Settings} settings GSettings object.
 * @param {string} key Key containing serialized JSON.
 * @param {object} value JSON-serializable object.
 */
function setSettingsJsonObject(settings, key, value) {
    if (!settings || typeof settings.set_string !== 'function') {
        return;
    }

    try {
        settings.set_string(key, JSON.stringify(value));
    } catch {
        // Keep runtime resilient on write failures.
    }
}

/**
 * Reads advanced section override root from settings using normalized shape.
 *
 * @param {Gio.Settings} settings GSettings object.
 * @returns {object} Normalized root object with version and sections map.
 */
function readAdvancedOverridesRoot(settings) {
    const parsed = getSettingsJsonObject(settings, SETTINGS.ADVANCED_SECTION_OVERRIDES);
    if (!parsed) {
        return { version: 1, sections: {} };
    }

    if (parsed.sections && typeof parsed.sections === 'object' && !Array.isArray(parsed.sections)) {
        return {
            version: Number.isInteger(parsed.version) ? parsed.version : 1,
            sections: { ...parsed.sections },
        };
    }

    return {
        version: 1,
        sections: { ...parsed },
    };
}

/**
 * Writes advanced section override root to settings.
 *
 * @param {Gio.Settings} settings GSettings object.
 * @param {object} root Normalized root object.
 */
function writeAdvancedOverridesRoot(settings, root) {
    const safeRoot = {
        version: Number.isInteger(root?.version) ? root.version : 1,
        sections: root?.sections && typeof root.sections === 'object' && !Array.isArray(root.sections) ? root.sections : {},
    };

    setSettingsJsonObject(settings, SETTINGS.ADVANCED_SECTION_OVERRIDES, safeRoot);
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

/**
 * Resolves a boolean candidate with fallback.
 *
 * @param {any} value Candidate boolean value.
 * @param {boolean} fallbackValue Fallback when candidate is not boolean.
 * @returns {boolean} Normalized boolean.
 */
function normalizeBooleanWithFallback(value, fallbackValue) {
    return typeof value === 'boolean' ? value : fallbackValue;
}

/**
 * Resolves visible-item policy fields.
 *
 * @param {object} candidate Raw candidate policy.
 * @param {object} safeFallback Resolved fallback policy.
 * @returns {object} Visible-item related fields.
 */
function normalizeVisibleItemsPolicy(candidate, safeFallback) {
    const globalVisibleItems = normalizePositiveInteger(candidate?.globalVisibleItems, safeFallback.globalVisibleItems);
    const customVisibleByView = normalizeBooleanWithFallback(candidate?.customVisibleByView, safeFallback.customVisibleByView);

    if (!customVisibleByView) {
        return {
            globalVisibleItems,
            listVisibleItems: globalVisibleItems,
            gridVisibleItems: globalVisibleItems,
            customVisibleByView,
        };
    }

    return {
        globalVisibleItems,
        listVisibleItems: normalizePositiveInteger(candidate?.listVisibleItems, globalVisibleItems),
        gridVisibleItems: normalizePositiveInteger(candidate?.gridVisibleItems, globalVisibleItems),
        customVisibleByView,
    };
}

/**
 * Resolves window-limit policy fields.
 *
 * @param {object} candidate Raw candidate policy.
 * @param {object} safeFallback Resolved fallback policy.
 * @returns {object} Window-limit related fields.
 */
function normalizeWindowLimitPolicy(candidate, safeFallback) {
    const globalWindowRows = normalizePositiveInteger(candidate?.globalWindowRows, safeFallback.globalWindowRows);
    const customWindowByView = normalizeBooleanWithFallback(candidate?.customWindowByView, safeFallback.customWindowByView);

    if (!customWindowByView) {
        return {
            globalWindowRows,
            listWindowRows: globalWindowRows,
            gridWindowRows: globalWindowRows,
            gridWindowColumns: safeFallback.gridWindowColumns,
            customWindowByView,
        };
    }

    return {
        globalWindowRows,
        listWindowRows: normalizePositiveInteger(candidate?.listWindowRows, globalWindowRows),
        gridWindowRows: normalizePositiveInteger(candidate?.gridWindowRows, globalWindowRows),
        gridWindowColumns: normalizePositiveInteger(candidate?.gridWindowColumns, safeFallback.gridWindowColumns),
        customWindowByView,
    };
}

/**
 * Resolves display policy fields.
 *
 * @param {object} candidate Raw candidate policy.
 * @param {object} safeFallback Resolved fallback policy.
 * @returns {object} Display related fields.
 */
function normalizeDisplayPolicy(candidate, safeFallback) {
    const displayMode = normalizeDisplayMode(candidate?.displayMode, safeFallback.displayMode);
    const customDisplayByView = normalizeBooleanWithFallback(candidate?.customDisplayByView, safeFallback.customDisplayByView);

    if (!customDisplayByView) {
        return {
            displayMode,
            listDisplayMode: displayMode,
            gridDisplayMode: displayMode,
            customDisplayByView,
        };
    }

    return {
        displayMode,
        listDisplayMode: normalizeDisplayMode(candidate?.listDisplayMode, displayMode),
        gridDisplayMode: normalizeDisplayMode(candidate?.gridDisplayMode, displayMode),
        customDisplayByView,
    };
}

/**
 * Resolves limit policy fields.
 *
 * @param {object} candidate Raw candidate policy.
 * @param {object} safeFallback Resolved fallback policy.
 * @returns {object} Limit related fields.
 */
function normalizeLimitPolicy(candidate, safeFallback) {
    const defaultLimitMode = normalizeLimitMode(candidate?.defaultLimitMode, safeFallback.defaultLimitMode);
    const customLimitByContext = normalizeBooleanWithFallback(candidate?.customLimitByContext, safeFallback.customLimitByContext);

    if (!customLimitByContext) {
        return {
            defaultLimitMode,
            historyLimitMode: defaultLimitMode,
            searchLimitMode: defaultLimitMode,
            customLimitByContext,
        };
    }

    return {
        defaultLimitMode,
        historyLimitMode: normalizeLimitMode(candidate?.historyLimitMode, safeFallback.historyLimitMode),
        searchLimitMode: normalizeLimitMode(candidate?.searchLimitMode, safeFallback.searchLimitMode),
        customLimitByContext,
    };
}

/**
 * Normalizes a raw policy candidate into a complete policy model.
 *
 * @param {object} candidate Raw policy values.
 * @param {object} fallbackPolicy Fallback policy values.
 * @returns {object} Normalized policy model.
 */
function normalizeResolvedPolicy(candidate = {}, fallbackPolicy = DEFAULT_RESOLVED_POLICY) {
    const safeFallback = fallbackPolicy || DEFAULT_RESOLVED_POLICY;
    const visibleItems = normalizeVisibleItemsPolicy(candidate, safeFallback);
    const windowLimits = normalizeWindowLimitPolicy(candidate, safeFallback);
    const displayPolicy = normalizeDisplayPolicy(candidate, safeFallback);
    const limitPolicy = normalizeLimitPolicy(candidate, safeFallback);
    const unlimitedSafetyCap = normalizePositiveInteger(candidate?.unlimitedSafetyCap, safeFallback.unlimitedSafetyCap);

    return {
        globalVisibleItems: visibleItems.globalVisibleItems,
        listVisibleItems: visibleItems.listVisibleItems,
        gridVisibleItems: visibleItems.gridVisibleItems,
        globalWindowRows: windowLimits.globalWindowRows,
        listWindowRows: windowLimits.listWindowRows,
        gridWindowRows: windowLimits.gridWindowRows,
        gridWindowColumns: windowLimits.gridWindowColumns,
        defaultLimitMode: limitPolicy.defaultLimitMode,
        historyLimitMode: limitPolicy.historyLimitMode,
        searchLimitMode: limitPolicy.searchLimitMode,
        displayMode: displayPolicy.displayMode,
        listDisplayMode: displayPolicy.listDisplayMode,
        gridDisplayMode: displayPolicy.gridDisplayMode,
        customDisplayByView: displayPolicy.customDisplayByView,
        customLimitByContext: limitPolicy.customLimitByContext,
        customVisibleByView: visibleItems.customVisibleByView,
        customWindowByView: windowLimits.customWindowByView,
        unlimitedSafetyCap,
    };
}

/**
 * Resolves a section-specific policy override from the advanced overrides setting.
 *
 * @param {Gio.Settings} settings GSettings object.
 * @param {string} sectionId Recently Used section id.
 * @param {object|null} sectionConfig Section definition object.
 * @param {object} globalPolicy Resolved global policy used for default materialization.
 * @returns {object|null} Partial override policy or null when missing/disabled.
 */
function resolveSectionPolicyOverride(settings, sectionId, sectionConfig = null, globalPolicy = DEFAULT_RESOLVED_POLICY) {
    if (typeof sectionId !== 'string' || sectionId.length === 0) {
        return null;
    }

    const root = readAdvancedOverridesRoot(settings);
    const sectionOverride = root.sections?.[sectionId];
    const hasValidEntry = sectionOverride && typeof sectionOverride === 'object' && !Array.isArray(sectionOverride);
    const isEnabled = hasValidEntry && sectionOverride.enabled === true;

    if (hasValidEntry && !isEnabled) {
        return null;
    }

    if (isEnabled) {
        const policy = sectionOverride.policy;
        if (policy && typeof policy === 'object' && !Array.isArray(policy)) {
            return policy;
        }
    }

    const defaultPolicy = sectionConfig?.defaultPolicy;
    if (!defaultPolicy || typeof defaultPolicy !== 'object' || Array.isArray(defaultPolicy)) {
        return null;
    }

    const materializedPolicy = normalizeResolvedPolicy({ ...globalPolicy, ...defaultPolicy }, globalPolicy);
    root.sections[sectionId] = {
        enabled: true,
        policy: materializedPolicy,
    };
    writeAdvancedOverridesRoot(settings, root);

    return materializedPolicy;
}

/**
 * Applies section-local defaults for custom-by-* toggles when section override JSON omits them.
 * This keeps section overrides independent from global toggle booleans unless explicitly set.
 *
 * @param {object} basePolicy The policy to merge into.
 * @param {object} sectionPolicyOverride Raw section override policy object.
 * @returns {object} Merged candidate policy with section-local toggle defaults.
 */
function mergeSectionOverrideWithLocalToggleDefaults(basePolicy, sectionPolicyOverride) {
    if (!sectionPolicyOverride || typeof sectionPolicyOverride !== 'object' || Array.isArray(sectionPolicyOverride)) {
        return { ...basePolicy };
    }

    const mergedPolicy = { ...basePolicy, ...sectionPolicyOverride };
    const hasOwn = (key) => Object.prototype.hasOwnProperty.call(sectionPolicyOverride, key);

    if (!hasOwn('customLimitByContext')) {
        mergedPolicy.customLimitByContext = false;
    }
    if (!hasOwn('customDisplayByView')) {
        mergedPolicy.customDisplayByView = false;
    }
    if (!hasOwn('customVisibleByView')) {
        mergedPolicy.customVisibleByView = false;
    }
    if (!hasOwn('customWindowByView')) {
        mergedPolicy.customWindowByView = false;
    }

    return mergedPolicy;
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
    const rawPolicy = {
        globalVisibleItems: getSettingsInt(settings, SETTINGS.GLOBAL_VISIBLE_ITEMS, DEFAULT_RESOLVED_POLICY.globalVisibleItems),
        listVisibleItems: getSettingsInt(settings, SETTINGS.LIST_VISIBLE_ITEMS, DEFAULT_RESOLVED_POLICY.listVisibleItems),
        gridVisibleItems: getSettingsInt(settings, SETTINGS.GRID_VISIBLE_ITEMS, DEFAULT_RESOLVED_POLICY.gridVisibleItems),
        globalWindowRows: getSettingsInt(settings, SETTINGS.GLOBAL_WINDOW_ROWS, DEFAULT_RESOLVED_POLICY.globalWindowRows),
        listWindowRows: getSettingsInt(settings, SETTINGS.LIST_WINDOW_ROWS, DEFAULT_RESOLVED_POLICY.listWindowRows),
        gridWindowRows: getSettingsInt(settings, SETTINGS.GRID_WINDOW_ROWS, DEFAULT_RESOLVED_POLICY.gridWindowRows),
        gridWindowColumns: getSettingsInt(settings, SETTINGS.GRID_WINDOW_COLUMNS, DEFAULT_RESOLVED_POLICY.gridWindowColumns),
        defaultLimitMode: getSettingsString(settings, SETTINGS.DEFAULT_LIMIT_MODE, DEFAULT_RESOLVED_POLICY.defaultLimitMode),
        historyLimitMode: getSettingsString(settings, SETTINGS.HISTORY_LIMIT_MODE, DEFAULT_RESOLVED_POLICY.historyLimitMode),
        searchLimitMode: getSettingsString(settings, SETTINGS.SEARCH_LIMIT_MODE, DEFAULT_RESOLVED_POLICY.searchLimitMode),
        displayMode: getSettingsString(settings, SETTINGS.DEFAULT_DISPLAY_MODE, DEFAULT_RESOLVED_POLICY.displayMode),
        listDisplayMode: getSettingsString(settings, SETTINGS.LIST_DISPLAY_MODE, DEFAULT_RESOLVED_POLICY.listDisplayMode),
        gridDisplayMode: getSettingsString(settings, SETTINGS.GRID_DISPLAY_MODE, DEFAULT_RESOLVED_POLICY.gridDisplayMode),
        customDisplayByView: getSettingsBoolean(settings, SETTINGS.ENABLE_CUSTOM_DISPLAY_MODE, DEFAULT_RESOLVED_POLICY.customDisplayByView),
        customLimitByContext: getSettingsBoolean(settings, SETTINGS.ENABLE_CUSTOM_LIMIT_POLICY, DEFAULT_RESOLVED_POLICY.customLimitByContext),
        customVisibleByView: getSettingsBoolean(settings, SETTINGS.ENABLE_CUSTOM_VISIBLE_ITEMS, DEFAULT_RESOLVED_POLICY.customVisibleByView),
        customWindowByView: getSettingsBoolean(settings, SETTINGS.ENABLE_CUSTOM_WINDOW_LIMITS, DEFAULT_RESOLVED_POLICY.customWindowByView),
        unlimitedSafetyCap: getSettingsInt(settings, SETTINGS.UNLIMITED_SAFETY_CAP, DEFAULT_RESOLVED_POLICY.unlimitedSafetyCap),
    };

    return normalizeResolvedPolicy(rawPolicy, DEFAULT_RESOLVED_POLICY);
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
    const normalizedSectionId = sectionId || sectionConfig?.id || null;

    const globalPolicy = readGlobalPolicy(settings);
    const sectionPolicyOverride = resolveSectionPolicyOverride(settings, normalizedSectionId, sectionConfig, globalPolicy);

    // Global policy serves as the baseline before applying advanced section overrides materialized from definition defaults.
    const sectionOverrideCandidate = mergeSectionOverrideWithLocalToggleDefaults(globalPolicy, sectionPolicyOverride);
    const effectivePolicy = sectionPolicyOverride ? normalizeResolvedPolicy(sectionOverrideCandidate, globalPolicy) : globalPolicy;
    const gridWindowSize = effectivePolicy.gridWindowRows * effectivePolicy.gridWindowColumns;
    const windowLimit = resolveWindowLimit(layoutFamily, effectivePolicy);
    const displayMode = resolveLayoutDisplayMode(layoutFamily, effectivePolicy);

    const configuredCap = resolveConfiguredCap(layoutFamily, effectivePolicy);
    const effectiveLimitMode = resolveContextLimitMode(normalizedContextMode, effectivePolicy);
    const effectiveCap = effectiveLimitMode === LIMIT_MODE.UNLIMITED ? effectivePolicy.unlimitedSafetyCap : normalizePositiveInteger(configuredCap, windowLimit);

    return {
        sectionId: normalizedSectionId,
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
