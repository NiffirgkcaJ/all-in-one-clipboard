import GObject from 'gi://GObject';

import { Debouncer } from '../../../shared/utilities/utilityDebouncer.js';

import { GifUI } from '../constants/gifConstants.js';

/**
 * GifSearchService
 *
 * A self-contained service that manages the search lifecycle.
 * It connects directly to the Search Bar UI and the Fetch Service, and handles the rendering of search results.
 */
export const GifSearchService = GObject.registerClass(
    class GifSearchService extends GObject.Object {
        // ========================================================================
        // Initialization
        // ========================================================================

        /**
         * @param {object} options Options for initialization.
         * @param {SearchComponent} options.searchComponent The UI search component.
         * @param {GifFetchService} options.fetchService The data fetch service.
         * @param {GifContentView} options.contentView The main grid view.
         */
        constructor({ searchComponent, fetchService, contentView }) {
            super();
            this._searchComponent = searchComponent;
            this._fetchService = fetchService;
            this._contentView = contentView;

            this._currentSearchQuery = null;
            this._isClearingForCategoryChange = false;
            this._suppressSearchInput = false;

            this._searchDebouncer = new Debouncer((query) => {
                const sessionId = this._fetchService.startNewSession();
                this._fetchService.fetchSearch(query, sessionId);
            }, GifUI.SEARCH_DEBOUNCE_TIME_MS);

            this._setupConnections();
        }

        // ========================================================================
        // External API
        // ========================================================================

        /**
         * Applies an externally provided search query.
         * @param {string} query The search query.
         * @returns {Promise<boolean>} True if successful.
         */
        async applyExternalSearch(query) {
            const searchWidget = this._searchComponent?.getWidget();
            if (!searchWidget?.visible) return false;

            const normalizedQuery = typeof query === 'string' ? query.trim() : '';
            this._searchComponent.setSearchText(normalizedQuery, { focus: false });
            await this.performExternalSearch(normalizedQuery);

            return true;
        }

        /**
         * Clears the active search state.
         * @returns {boolean} True if search was cleared.
         */
        clearExternalSearch() {
            const searchWidget = this._searchComponent?.getWidget();
            if (!searchWidget?.visible) return false;

            this._searchComponent.setSearchText('', { focus: false });
            this.clearSearch();
            return true;
        }

        /**
         * Handles the menu closing event.
         */
        onMenuClosed() {
            if (this.isActive()) {
                this._searchComponent?.clearSearch();
            }
        }

        // ========================================================================
        // Connections
        // ========================================================================

        /**
         * Connect to UI and Data signals.
         * @private
         */
        _setupConnections() {
            // User Input
            this._searchComponent.connect('search-changed', (emitter, searchText) => {
                this._onSearchInputChanged(searchText);
            });

            // Search Results
            this._fetchService.connect('results-loaded', (emitter, data) => {
                if (this.isActive() && data.queryText === this.getQuery()) {
                    this._onSearchResultsLoaded(data);
                }
            });
        }

        // ========================================================================
        // Input Handlers
        // ========================================================================

        /**
         * Processes search text changes.
         * @param {string} searchText The raw search text.
         * @private
         */
        _onSearchInputChanged(searchText) {
            if (this._isClearingForCategoryChange || this._suppressSearchInput) {
                return;
            }

            const query = searchText.trim();

            if (query.length >= 1) {
                this._currentSearchQuery = query;
                this._searchDebouncer.trigger(query);
            } else if (query.length === 0) {
                this.clearSearch();
            }
        }

        /**
         * Handles data results specifically for searches.
         * @param {object} data The search result data.
         * @private
         */
        _onSearchResultsLoaded({ results, isAppend, queryText }) {
            if (results.length > 0) {
                this._contentView.renderGrid(results, !isAppend);
            } else if (!isAppend) {
                this._contentView.showInfoState(`No results found for '${queryText}'.`);
            }
        }

        // ========================================================================
        // Search State
        // ========================================================================

        /**
         * Triggers a search bypass for external queries.
         * @param {string} query The search query.
         */
        async performExternalSearch(query) {
            this.clearSearch();
            this._suppressSearchInput = true;

            if (query && query.length >= 1) {
                this._currentSearchQuery = query;
                const sessionId = this._fetchService.startNewSession();
                await this._fetchService.fetchSearch(query, sessionId);
            }

            this._suppressSearchInput = false;
        }

        /**
         * Clears the search state and updates the UI.
         */
        clearSearch() {
            this._currentSearchQuery = null;
            this._searchDebouncer.cancel();

            // Bypass our own input handler while clearing the UI.
            this._suppressSearchInput = true;
            if (this._searchComponent.getSearchText() !== '') {
                this._searchComponent.setSearchText('', { focus: false });
            }
            this._suppressSearchInput = false;
        }

        /**
         * Checks if search is currently active.
         * @returns {boolean} True if search is active.
         */
        isActive() {
            return !!this._currentSearchQuery;
        }

        /**
         * Gets the active search query string.
         * @returns {string|null} The active query or null.
         */
        getQuery() {
            return this._currentSearchQuery;
        }

        /**
         * Sets the clearing-for-category flag to suppress search input during category switches.
         * @param {boolean} isClearing Whether a category change is in progress.
         */
        setClearingForCategory(isClearing) {
            this._isClearingForCategoryChange = !!isClearing;
        }

        // ========================================================================
        // Lifecycle
        // ========================================================================

        /**
         * Clean up resources.
         */
        destroy() {
            if (this._searchDebouncer) {
                this._searchDebouncer.destroy();
                this._searchDebouncer = null;
            }
        }
    },
);
