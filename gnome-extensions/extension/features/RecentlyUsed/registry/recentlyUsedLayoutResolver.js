import { RecentlyUsedUI } from '../constants/recentlyUsedConstants.js';
import { RecentlyUsedDefaultPolicy, RecentlyUsedDisplayMode } from '../constants/recentlyUsedPolicyConstants.js';

// ========================================================================
// Internal Helpers
// ========================================================================

/**
 * Resolves a positive integer from policy and config values with fallback.
 *
 * @param {number} policyValue Value from display policy.
 * @param {number} configValue Value from section configuration.
 * @param {number} fallback Default value if both inputs are invalid.
 * @returns {number} Resolved positive integer.
 */
function resolvePositiveInt(value, fallback) {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/**
 * Resolves layout integer values with precedence: policy > config > default.
 *
 * @param {number} policyValue Value from display policy limits.
 * @param {number} configValue Value from section layout policy.
 * @param {number} fallback Default value if both inputs are invalid.
 * @returns {number} Resolved positive integer for layout configuration.
 */
function resolveLayoutInt(policyValue, configValue, fallback) {
    return resolvePositiveInt(policyValue ?? configValue, fallback);
}

/**
 * Normalizes layout type strings, defaulting to 'list' for invalid inputs.
 *
 * @param {string} layoutType Raw layout type from section configuration.
 * @returns {string} Normalized layout type.
 */
function normalizeLayoutType(layoutType) {
    return layoutType || 'list';
}

// ========================================================================
// Public Layout Resolution
// ========================================================================

/**
 * Resolves the base layout type for a recently used section based on configuration.
 *
 * @param {object} sectionConfig Section configuration object.
 * @returns {string} Resolved base layout type.
 */
export function resolveRecentlyUsedBaseLayout(sectionConfig) {
    const rawLayout = normalizeLayoutType(sectionConfig?.layoutType || 'list');
    if (rawLayout === 'grid' || rawLayout === 'nested-grid') {
        return 'grid';
    }

    return 'list';
}

/**
 * Resolves the effective display layout for a recently used section based on policy and configuration.
 *
 * @param {object} sectionConfig Section configuration object.
 * @param {string} baseLayout Resolved base layout type.
 * @param {object} resolvedPolicy Resolved display policy model.
 * @returns {string} Resolved effective layout type for rendering.
 */
export function resolveRecentlyUsedDisplayLayout(sectionConfig, baseLayout, resolvedPolicy) {
    const safeBaseLayout = baseLayout || resolveRecentlyUsedBaseLayout(sectionConfig);
    const displayMode = resolvedPolicy?.displayMode || RecentlyUsedDisplayMode.SCROLL_WINDOW;

    if (displayMode === RecentlyUsedDisplayMode.FIXED_WINDOW) {
        return safeBaseLayout;
    }

    return safeBaseLayout === 'grid' ? 'nested-grid' : 'nested-list';
}

/**
 * Resolves the nested list layout configuration for a recently used section based on policy and configuration.
 *
 * @param {object} nestedLayoutConfig Section layout configuration object for nested list.
 * @param {object} resolvedPolicy Resolved display policy model.
 * @returns {object} Resolved nested list layout configuration.
 */
export function resolveRecentlyUsedListLayout(sectionConfig, resolvedPolicy = null) {
    const policyLimits = resolvedPolicy?.limits || null;
    const layoutPolicy = sectionConfig?.layoutPolicy;

    return {
        maxVisible: resolveLayoutInt(policyLimits?.listWindowRows ?? policyLimits?.listVisibleLimit, layoutPolicy?.maxVisible, RecentlyUsedDefaultPolicy.LIST_VISIBLE_ITEMS),
        itemHeight: layoutPolicy?.itemHeight ?? RecentlyUsedUI.NESTED_ITEM_HEIGHT,
    };
}

/**
 * Resolves the grid layout configuration for a recently used section based on policy and configuration.
 *
 * @param {object} sectionConfig Section configuration object for grid layout.
 * @param {object} resolvedPolicy Resolved display policy model.
 * @returns {object} Resolved grid layout configuration.
 */
export function resolveRecentlyUsedGridLayout(sectionConfig, resolvedPolicy = null) {
    const policyLimits = resolvedPolicy?.limits || null;
    const layoutPolicy = sectionConfig?.layoutPolicy;

    return {
        columnCount: resolveLayoutInt(policyLimits?.gridColumns, layoutPolicy?.columnCount ?? layoutPolicy?.columns, RecentlyUsedDefaultPolicy.GRID_WINDOW_COLUMNS),
    };
}

/**
 * Resolves the nested grid layout configuration for a recently used section based on policy and configuration.
 *
 * @param {object} sectionConfig Section configuration object for nested grid layout.
 * @param {object} resolvedPolicy Resolved display policy model.
 * @returns {object} Resolved nested grid layout configuration.
 */
export function resolveRecentlyUsedNestedLayout(sectionConfig, resolvedPolicy = null) {
    const policyLimits = resolvedPolicy?.limits || null;
    const layoutPolicy = sectionConfig?.layoutPolicy;

    return {
        ...resolveRecentlyUsedListLayout(sectionConfig, resolvedPolicy),
        ...resolveRecentlyUsedGridLayout(sectionConfig, resolvedPolicy),
        maxVisibleRows: resolveLayoutInt(policyLimits?.gridVisibleRows, layoutPolicy?.maxVisibleRows ?? layoutPolicy?.maxRows, RecentlyUsedDefaultPolicy.GRID_WINDOW_ROWS),
    };
}

/**
 * Resolves all relevant layout configurations for a recently used section based on policy and configuration.
 *
 * @param {object} sectionConfig Section configuration object.
 * @param {object} resolvedPolicy Resolved display policy model.
 * @returns {object} Object containing resolved list, grid, and nested layout configurations.
 */
export function resolveRecentlyUsedSectionLayouts(sectionConfig, resolvedPolicy = null) {
    return {
        listLayout: resolveRecentlyUsedListLayout(sectionConfig, resolvedPolicy),
        gridLayout: resolveRecentlyUsedGridLayout(sectionConfig, resolvedPolicy),
        nestedLayout: resolveRecentlyUsedNestedLayout(sectionConfig, resolvedPolicy),
    };
}
