import GLib from 'gi://GLib';

import { matchesRecentlyUsedSearch } from '../utilities/recentlyUsedSearch.js';
import { RecentlyUsedSearchTuning } from '../constants/recentlyUsedSearchConstants.js';

/**
 * Coordinates section search state, async search requests, and fallback behavior.
 */
export class RecentlyUsedSearchStateManager {
    // ========================================================================
    // Lifecycle
    // ========================================================================

    /**
     * @param {object} options
     * @param {Function|null} options.onRender Callback to request re-render.
     */
    constructor({ onRender = null } = {}) {
        this._onRender = onRender || null;
        this._searchRequestSeq = 0;
        this._sectionSearchState = new Map();
        this._renderSourceId = 0;
    }

    /**
     * Clear all tracked search state.
     */
    clear() {
        this._clearPendingSearchSources();
        this._clearPendingRenderSource();
        this._sectionSearchState.clear();
    }

    // ========================================================================
    // Search Resolution
    // ========================================================================

    /**
     * Resolve section source items with async search fallback support.
     *
     * @param {object} sectionConfig Section configuration.
     * @param {object} runtimeContext Runtime context.
     * @param {string} searchQuery Normalized query string.
     * @returns {Array<object>} Source items for current render pass.
     */
    resolveSectionSourceItems(sectionConfig, runtimeContext, searchQuery) {
        const localItemsRaw = sectionConfig.getItems(runtimeContext);
        const localItems = Array.isArray(localItemsRaw) ? localItemsRaw : [];
        const localItemsSignature = this._createSectionItemsSignature(localItems);

        if (!searchQuery || !sectionConfig.id) {
            if (sectionConfig?.id) {
                this._clearSectionSearchState(sectionConfig.id);
            }
            return localItems;
        }

        const sectionId = sectionConfig.id;
        const currentState = this._sectionSearchState.get(sectionId);

        if (currentState?.query === searchQuery) {
            if (currentState.status === 'ready' && currentState.fallbackSignature === localItemsSignature) {
                return currentState.items;
            }

            if (currentState.status === 'pending' && currentState.fallbackSignature === localItemsSignature) {
                return currentState.fallbackItems;
            }
        }

        this._clearSectionSearchState(sectionId);

        const requestId = ++this._searchRequestSeq;
        this._sectionSearchState.set(sectionId, {
            query: searchQuery,
            requestId,
            status: 'pending',
            fallbackItems: localItems,
            fallbackSignature: localItemsSignature,
            items: [],
            searchSourceId: this._queueSectionSearch({
                sectionConfig,
                runtimeContext,
                searchQuery,
                sectionId,
                requestId,
            }),
        });

        return localItems;
    }

    /**
     * Run section-specific matching with fallback generic matching.
     *
     * @param {object} sectionConfig Section configuration.
     * @param {object|string|number|null|undefined} item Candidate item.
     * @param {string} query Normalized query string.
     * @param {object} runtimeContext Runtime context.
     * @returns {boolean} True when the item matches.
     */
    matchesSectionSearch(sectionConfig, item, query, runtimeContext) {
        try {
            return Boolean(
                sectionConfig.matchesSearch({
                    item,
                    query,
                    runtimeContext,
                    fallbackMatch: (candidate) => matchesRecentlyUsedSearch({ item: candidate, query }),
                }),
            );
        } catch {
            // Fall back to generic matching when a custom matcher fails.
        }

        return matchesRecentlyUsedSearch({ item, query });
    }

    // ========================================================================
    // Internal Helpers
    // ========================================================================

    /**
     * Queue a low-priority section search outside the render pass.
     *
     * @param {object} params Search source parameters.
     * @param {object} params.sectionConfig Section configuration.
     * @param {object} params.runtimeContext Runtime context.
     * @param {string} params.searchQuery Normalized query string.
     * @param {string} params.sectionId Section id.
     * @param {number} params.requestId Search request id.
     * @returns {number} GLib source id.
     * @private
     */
    _queueSectionSearch({ sectionConfig, runtimeContext, searchQuery, sectionId, requestId }) {
        return GLib.idle_add(GLib.PRIORITY_LOW, () => {
            this._markSectionSearchSourceConsumed(sectionId, requestId);

            Promise.resolve()
                .then(() => sectionConfig.searchItems({ query: searchQuery, runtimeContext }))
                .then((items) => {
                    this._completeSectionSearch(sectionId, requestId, Array.isArray(items) ? items : []);
                })
                .catch(() => {
                    this._completeSectionSearch(sectionId, requestId, []);
                });

            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Marks a queued search source as already consumed by the main loop.
     *
     * @param {string} sectionId Section id.
     * @param {number} requestId Search request id.
     * @private
     */
    _markSectionSearchSourceConsumed(sectionId, requestId) {
        const latestState = this._sectionSearchState.get(sectionId);
        if (!latestState || latestState.requestId !== requestId) {
            return;
        }

        this._sectionSearchState.set(sectionId, {
            ...latestState,
            searchSourceId: 0,
        });
    }

    /**
     * Stores section search results and queues one coalesced render.
     *
     * @param {string} sectionId Section id.
     * @param {number} requestId Search request id.
     * @param {Array<object>} items Search result items.
     * @private
     */
    _completeSectionSearch(sectionId, requestId, items) {
        const latestState = this._sectionSearchState.get(sectionId);
        if (!latestState || latestState.requestId !== requestId) {
            return;
        }

        this._sectionSearchState.set(sectionId, {
            ...latestState,
            status: 'ready',
            items,
            searchSourceId: 0,
        });

        this._queueRender();
    }

    /**
     * Queues a single low-priority render for completed section searches.
     *
     * @private
     */
    _queueRender() {
        if (this._renderSourceId) {
            return;
        }

        this._renderSourceId = GLib.idle_add(GLib.PRIORITY_LOW, () => {
            this._renderSourceId = 0;
            this._onRender?.();
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Removes queued section search work for a section.
     *
     * @param {string} sectionId Section id.
     * @private
     */
    _clearSectionSearchState(sectionId) {
        const state = this._sectionSearchState.get(sectionId);
        if (state?.searchSourceId) {
            GLib.source_remove(state.searchSourceId);
        }

        this._sectionSearchState.delete(sectionId);
    }

    /**
     * Removes all queued section search sources.
     *
     * @private
     */
    _clearPendingSearchSources() {
        for (const state of this._sectionSearchState.values()) {
            if (state?.searchSourceId) {
                GLib.source_remove(state.searchSourceId);
            }
        }
    }

    /**
     * Removes the queued coalesced render source.
     *
     * @private
     */
    _clearPendingRenderSource() {
        if (!this._renderSourceId) {
            return;
        }

        GLib.source_remove(this._renderSourceId);
        this._renderSourceId = 0;
    }

    /**
     * Build a lightweight signature for section source items.
     *
     * @param {Array<object>} items Section source items.
     * @returns {string} Stable signature string for cache checks.
     * @private
     */
    _createSectionItemsSignature(items) {
        if (!Array.isArray(items) || items.length === 0) {
            return '0:';
        }

        const parts = [];
        const sampleSize = Math.min(items.length, RecentlyUsedSearchTuning.SECTION_SIGNATURE_MAX_SAMPLES);
        const sampledIndexes = new Set();

        if (sampleSize === 1) {
            sampledIndexes.add(0);
        } else {
            for (let i = 0; i < sampleSize; i++) {
                const index = Math.round((i * (items.length - 1)) / (sampleSize - 1));
                sampledIndexes.add(index);
            }
        }

        for (const index of sampledIndexes) {
            const item = items[index];

            if (!item || typeof item !== 'object') {
                parts.push(`${index}:${String(item)}`);
                continue;
            }

            const signatureFields = {
                id: item.id,
                timestamp: item.timestamp,
                updatedAt: item.updatedAt,
                value: item.value,
                char: item.char,
                symbol: item.symbol,
                kaomoji: item.kaomoji,
                full_url: item.full_url,
                preview_url: item.preview_url,
                name: item.name,
                description: item.description,
            };
            const value = Object.values(signatureFields)
                .filter((candidate) => candidate !== null && candidate !== undefined)
                .map((candidate) => String(candidate))
                .join('::');

            parts.push(`${index}:${String(value)}`);
        }

        return `${items.length}:${parts.join('|')}`;
    }
}
