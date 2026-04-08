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
        this._onRender = typeof onRender === 'function' ? onRender : null;
        this._searchRequestSeq = 0;
        this._sectionSearchState = new Map();
    }

    /**
     * Clear all tracked search state.
     */
    clear() {
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
        const localItemsRaw = typeof sectionConfig.getItems === 'function' ? sectionConfig.getItems(runtimeContext) : [];
        const localItems = Array.isArray(localItemsRaw) ? localItemsRaw : [];
        const localItemsSignature = this._createSectionItemsSignature(localItems);

        if (!searchQuery || typeof sectionConfig.searchItems !== 'function' || !sectionConfig.id) {
            if (sectionConfig?.id) {
                this._sectionSearchState.delete(sectionConfig.id);
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

        const requestId = ++this._searchRequestSeq;
        this._sectionSearchState.set(sectionId, {
            query: searchQuery,
            requestId,
            status: 'pending',
            fallbackItems: localItems,
            fallbackSignature: localItemsSignature,
            items: [],
        });

        Promise.resolve(sectionConfig.searchItems({ query: searchQuery, runtimeContext }))
            .then((items) => {
                const latestState = this._sectionSearchState.get(sectionId);
                if (!latestState || latestState.requestId !== requestId) {
                    return;
                }

                this._sectionSearchState.set(sectionId, {
                    ...latestState,
                    status: 'ready',
                    items: Array.isArray(items) ? items : [],
                });

                this._onRender?.();
            })
            .catch(() => {
                const latestState = this._sectionSearchState.get(sectionId);
                if (!latestState || latestState.requestId !== requestId) {
                    return;
                }

                this._sectionSearchState.set(sectionId, {
                    ...latestState,
                    status: 'ready',
                    items: [],
                });

                this._onRender?.();
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
        if (typeof sectionConfig?.matchesSearch === 'function') {
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
        }

        return matchesRecentlyUsedSearch({ item, query });
    }

    // ========================================================================
    // Internal Helpers
    // ========================================================================

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
