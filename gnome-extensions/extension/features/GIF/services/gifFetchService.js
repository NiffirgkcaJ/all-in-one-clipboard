import GObject from 'gi://GObject';
import Gio from 'gi://Gio';

import { Logger } from '../../../shared/utilities/utilityLogger.js';

/**
 * GifFetchService
 *
 * A signal-driven data service that executes asynchronous calls to the GifManager.
 * Emits signals when data is loaded, errors occur, or loading state changes.
 * Acts as the central traffic controller for pagination and race conditions.
 *
 * @fires results-loaded Emitted with results, append flag, query type, and query text.
 * @fires error-occurred Emitted with the error message.
 * @fires loading-state-changed Emitted when a request starts or stops.
 */
export const GifFetchService = GObject.registerClass(
    {
        Signals: {
            'results-loaded': { param_types: [GObject.TYPE_JSOBJECT] },
            'error-occurred': { param_types: [GObject.TYPE_STRING] },
            'loading-state-changed': { param_types: [GObject.TYPE_BOOLEAN, GObject.TYPE_BOOLEAN] },
        },
    },
    class GifFetchService extends GObject.Object {
        // ========================================================================
        // Initialization
        // ========================================================================

        /**
         * @param {GifManager} gifManager The GIF data manager.
         */
        constructor(gifManager) {
            super();
            this._gifManager = gifManager;
            this._currentLoadingSession = null;
            this._currentCancellable = null;

            // Pagination and Query State
            this._currentNextPos = null;
            this._currentQueryType = null; // 'trending' | 'search'
            this._currentQueryText = null;
        }

        // ========================================================================
        // Request Management
        // ========================================================================

        /**
         * Cancels any active HTTP requests.
         */
        cancelPendingRequests() {
            if (this._currentCancellable) {
                this._currentCancellable.cancel();
            }
            this._currentCancellable = new Gio.Cancellable();
        }

        /**
         * Creates a new loading session to prevent race conditions.
         * @returns {Symbol} The new session ID.
         */
        startNewSession() {
            this.cancelPendingRequests();
            const sessionId = Symbol('loading-session');
            this._currentLoadingSession = sessionId;
            return sessionId;
        }

        /**
         * Returns the current active loading session ID.
         * @returns {Symbol|null} The current session ID or null.
         */
        getCurrentSession() {
            return this._currentLoadingSession;
        }

        /**
         * Validates if a given session is still the active session.
         * @param {Symbol} sessionId The session ID to check.
         * @returns {boolean} True if the session is valid.
         */
        isSessionValid(sessionId) {
            return !sessionId || sessionId === this._currentLoadingSession;
        }

        // ========================================================================
        // Public Fetch API
        // ========================================================================

        /**
         * Fetches available categories from the provider.
         * @returns {Promise<Array|null>} The fetched categories or null.
         */
        async fetchCategories() {
            try {
                return await this._gifManager.getCategories();
            } catch (e) {
                Logger.warn(`Could not fetch GIF categories: ${e.message}`);
                return null;
            }
        }

        /**
         * Fetches trending GIFs from the beginning.
         * @param {Symbol|null} sessionId The session ID.
         * @returns {Promise<void>}
         */
        async fetchTrending(sessionId = null) {
            this._currentQueryType = 'trending';
            this._currentQueryText = null;
            this._currentNextPos = null;
            await this._performFetch(null, null, sessionId);
        }

        /**
         * Fetches GIFs based on a new search query.
         * @param {string} query The search query.
         * @param {Symbol|null} sessionId The session ID.
         * @returns {Promise<void>}
         */
        async fetchSearch(query, sessionId = null) {
            this._currentQueryType = 'search';
            this._currentQueryText = query;
            this._currentNextPos = null;
            await this._performFetch(query, null, sessionId);
        }

        /**
         * Fetches the next page of results for the current query type.
         * @param {Symbol|null} sessionId The session ID.
         * @returns {Promise<void>}
         */
        async fetchMore(sessionId = null) {
            if (!this._currentNextPos) return;

            if (this._currentQueryType === 'trending') {
                await this._performFetch(null, this._currentNextPos, sessionId);
            } else if (this._currentQueryType === 'search' && this._currentQueryText) {
                await this._performFetch(this._currentQueryText, this._currentNextPos, sessionId);
            }
        }

        // ========================================================================
        // Internal Fetch Execution
        // ========================================================================

        /**
         * Unified fetch execution for both trending and search.
         * @param {string|null} query Search query, or null for trending.
         * @param {string|null} nextPos Pagination offset.
         * @param {Symbol|null} sessionId The session ID.
         * @private
         */
        async _performFetch(query, nextPos, sessionId) {
            if (!this.isSessionValid(sessionId)) return;

            this.emit('loading-state-changed', true, !!nextPos);

            try {
                const apiCall = query ? this._gifManager.search(query, nextPos, this._currentCancellable) : this._gifManager.getTrending(nextPos, this._currentCancellable);

                const { results, nextPos: newNextPos } = await apiCall;

                if (!this.isSessionValid(sessionId)) return;

                this._currentNextPos = newNextPos;
                this.emit('results-loaded', {
                    results,
                    isAppend: !!nextPos,
                    queryType: this._currentQueryType,
                    queryText: query || null,
                });
            } catch (e) {
                if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) return;
                if (this.isSessionValid(sessionId)) {
                    this.emit('error-occurred', e.message);
                }
            } finally {
                if (this.isSessionValid(sessionId)) {
                    this.emit('loading-state-changed', false, !!nextPos);
                }
            }
        }

        // ========================================================================
        // Lifecycle
        // ========================================================================

        /**
         * Clean up resources.
         */
        destroy() {
            this.cancelPendingRequests();
        }
    },
);
