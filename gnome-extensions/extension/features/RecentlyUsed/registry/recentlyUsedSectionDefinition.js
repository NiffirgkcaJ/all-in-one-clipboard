import { matchesRecentlyUsedSearch } from '../utilities/recentlyUsedSearch.js';

/**
 * Base contract for Recently Used section definitions.
 */
export class RecentlyUsedSectionDefinition {
    // ========================================================================
    // Initialization
    // ========================================================================

    /**
     * Creates a section definition with default hook implementations.
     *
     * @param {object} config Section configuration.
     */
    constructor(config = {}) {
        Object.assign(this, config);
    }

    /**
     * Initialize section runtime resources.
     *
     * @returns {Promise<void>|void}
     */
    initialize() {}

    // ========================================================================
    // Factory
    // ========================================================================

    /**
     * Creates a runtime-scoped section instance.
     *
     * @returns {RecentlyUsedSectionDefinition} Section instance.
     */
    createInstance() {
        return this;
    }

    // ========================================================================
    // Signals
    // ========================================================================

    /**
     * Returns signals that should trigger section updates.
     *
     * @returns {Array<object>} Signal descriptors.
     */
    getSignals() {
        return [];
    }

    // ========================================================================
    // State
    // ========================================================================

    /**
     * Indicates whether the section is enabled.
     *
     * @returns {boolean} True when enabled.
     */
    isEnabled() {
        return true;
    }

    // ========================================================================
    // Data
    // ========================================================================

    /**
     * Returns section source items.
     *
     * @returns {Array<object>} Section items.
     */
    getItems() {
        return [];
    }

    /**
     * Maps a source item into the shared section payload format.
     *
     * @param {object|string} sourceItem Source entry.
     * @returns {object|string} Mapped entry.
     */
    mapItem(sourceItem) {
        return sourceItem;
    }

    // ========================================================================
    // Search
    // ========================================================================

    /**
     * Searches section items.
     *
     * @returns {Promise<Array<object>>|Array<object>} Matching items.
     */
    searchItems() {
        return [];
    }

    /**
     * Matches a section item against a search query.
     *
     * @param {object} params Search parameters.
     * @param {object|string|number|null|undefined} params.item Candidate item.
     * @param {string} params.query Normalized query string.
     * @param {Function} params.fallbackMatch Generic fallback matcher.
     * @returns {boolean} True when the item matches.
     */
    matchesSearch({ item, query, fallbackMatch }) {
        return fallbackMatch ? fallbackMatch(item) : matchesRecentlyUsedSearch({ item, query });
    }

    // ========================================================================
    // Rendering
    // ========================================================================

    /**
     * Renders custom list content.
     *
     * @returns {boolean} True when custom rendering succeeds.
     */
    renderListContent() {
        return false;
    }

    /**
     * Resolves a grid icon definition.
     *
     * @returns {object|null} Icon definition or null.
     */
    resolveGridIcon() {
        return null;
    }

    /**
     * Handles post-creation grid item updates.
     */
    onGridItemCreated() {}

    // ========================================================================
    // Actions
    // ========================================================================

    /**
     * Handles section item activation.
     *
     * @returns {Promise<boolean>|boolean} True when the click was handled.
     */
    onClick() {
        return false;
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    /**
     * Clean up section runtime resources.
     */
    destroy() {}
}

// ============================================================================
// Normalization
// ============================================================================

/**
 * Ensures a section definition has the base section contract.
 *
 * @param {object} sectionDefinition Section definition object.
 * @returns {RecentlyUsedSectionDefinition|null} Normalized section definition or null.
 */
export function ensureRecentlyUsedSectionDefinition(sectionDefinition) {
    if (!sectionDefinition || typeof sectionDefinition !== 'object') {
        return null;
    }

    return sectionDefinition instanceof RecentlyUsedSectionDefinition ? sectionDefinition : new RecentlyUsedSectionDefinition(sectionDefinition);
}
