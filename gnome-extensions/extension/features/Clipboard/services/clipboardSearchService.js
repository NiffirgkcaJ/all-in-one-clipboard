import { Debouncer } from '../../../shared/utilities/utilityDebouncer.js';

import { ClipboardConfig } from '../constants/clipboardConstants.js';
import { ClipboardSearchUtils } from '../utilities/clipboardSearchUtils.js';

/**
 * ClipboardSearchService
 *
 * Manages search state, debouncing, and filtering for clipboard items.
 * Mirrors the GifSearchService pattern for consistent module architecture.
 */
export class ClipboardSearchService {
    // ========================================================================
    // Initialization
    // ========================================================================

    /**
     * Initialize the search service.
     *
     * @param {Object} options Configuration options.
     * @param {Function} options.onSearchChanged Callback invoked when search results should update.
     */
    constructor({ onSearchChanged }) {
        this._onSearchChanged = onSearchChanged;

        this._currentSearchText = '';
        this._suppressSearchEffects = false;
        this._pendingReset = false;

        this._searchDebouncer = new Debouncer(() => this._onSearchChanged(), ClipboardConfig.SEARCH_DEBOUNCE_MS);
    }

    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Handle raw search input from the SearchComponent.
     *
     * @param {string} text The raw search text.
     */
    handleSearchInput(text) {
        this._currentSearchText = text.toLowerCase().trim();
        if (this._suppressSearchEffects) return;
        this._searchDebouncer.trigger();
    }

    /**
     * Get the current search text.
     *
     * @returns {string} The current search query.
     */
    get currentSearchText() {
        return this._currentSearchText;
    }

    /**
     * Check if a search is currently active.
     *
     * @returns {boolean} True if searching.
     */
    get isSearching() {
        return this._currentSearchText.length > 0;
    }

    /**
     * Check if a reset is pending from a previous menu close.
     *
     * @returns {boolean} True if a reset is pending.
     */
    get pendingReset() {
        return this._pendingReset;
    }

    /**
     * Filter items by the current search text.
     *
     * @param {Array} items Items to filter.
     * @returns {Array} Filtered items.
     */
    filterItems(items) {
        if (!this.isSearching) return items;
        return items.filter((i) => ClipboardSearchUtils.isMatch(i, this._currentSearchText));
    }

    /**
     * Apply an external search query.
     *
     * @param {SearchComponent} searchComponent The search UI component.
     * @param {string} query Search query string.
     * @returns {boolean} True if the search was applied successfully.
     */
    applyExternalSearch(searchComponent, query) {
        const q = typeof query === 'string' ? query.trim() : '';

        this._pendingReset = false;
        this._searchDebouncer.cancel();

        this._suppressSearchEffects = true;
        searchComponent.setSearchText(q, { focus: false });
        this._suppressSearchEffects = false;

        this._currentSearchText = q.toLowerCase();
        this._onSearchChanged();

        return true;
    }

    /**
     * Clear any active external search query.
     *
     * @param {SearchComponent} searchComponent The search UI component.
     * @returns {boolean} True if the search was cleared successfully.
     */
    clearExternalSearch(searchComponent) {
        return this.applyExternalSearch(searchComponent, '');
    }

    /**
     * Handle the tab being selected.
     *
     * @param {SearchComponent} searchComponent The search UI component.
     */
    onTabSelected(searchComponent) {
        if (this._pendingReset) {
            this._suppressSearchEffects = true;
            searchComponent.clearSearch();
            this._suppressSearchEffects = false;
            this._pendingReset = false;
            this._currentSearchText = '';
        }
    }

    /**
     * Handle the extension menu being closed.
     */
    onMenuClosed() {
        this._searchDebouncer.cancel();
        this._pendingReset = this._currentSearchText.length > 0;
        if (!this._pendingReset) this._currentSearchText = '';
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    /**
     * Clean up resources.
     */
    destroy() {
        this._searchDebouncer.destroy();
    }
}
