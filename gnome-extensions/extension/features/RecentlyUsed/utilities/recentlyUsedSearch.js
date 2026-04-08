import { RecentlyUsedSearchDefaults, RecentlyUsedSearchTuning } from '../constants/recentlyUsedSearchConstants.js';

// ========================================================================
// Normalization
// ========================================================================

/**
 * Normalizes user-entered search query text.
 *
 * @param {string} rawQuery Raw query value.
 * @returns {string} Normalized lowercase query.
 */
export function normalizeRecentlyUsedSearchQuery(rawQuery) {
    return typeof rawQuery === 'string' ? rawQuery.trim().toLowerCase() : '';
}

/**
 * Normalizes text used for search indexing.
 *
 * @param {string} rawText Raw candidate text.
 * @returns {string} Search-normalized text.
 */
export function normalizeRecentlyUsedSearchText(rawText) {
    if (typeof rawText !== 'string') {
        return '';
    }

    return rawText
        .toLowerCase()
        .trim()
        .replace(/[_./-]+/g, ' ')
        .replace(/\s+/g, ' ');
}

// ========================================================================
// Matching
// ========================================================================

/**
 * Tests whether an item matches the query.
 *
 * @param {object} args Search arguments.
 * @param {object|string|number|null|undefined} args.item Candidate item.
 * @param {string} args.query Query string, expected to be normalized already.
 * @param {Array<string>} [args.preferredKeys] Candidate top-level keys to prioritize.
 * @param {Array<string|number|boolean>} [args.extraValues] Extra values added to the searchable text index.
 * @returns {boolean} True when all query tokens are found.
 */
export function matchesRecentlyUsedSearch({ item, query, preferredKeys = [], extraValues = [] }) {
    if (!query) {
        return true;
    }

    const queryTokens = query.split(/\s+/).filter(Boolean);
    if (queryTokens.length === 0) {
        return true;
    }

    const valuesToSearch = [];
    const appendPrimitiveValue = (value) => {
        if (value === null || value === undefined) {
            return;
        }

        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            valuesToSearch.push(String(value));
        }
    };

    [...RecentlyUsedSearchDefaults.PREFERRED_KEYS, ...preferredKeys].forEach((key) => {
        if (!item || typeof item !== 'object') {
            return;
        }

        appendPrimitiveValue(item[key]);
    });

    extraValues.forEach((value) => appendPrimitiveValue(value));

    collectRecentlyUsedSearchValues(item, valuesToSearch);

    if (valuesToSearch.length === 0) {
        return false;
    }

    const haystack = normalizeRecentlyUsedSearchText(valuesToSearch.join(' '));
    if (!haystack) {
        return false;
    }

    return queryTokens.every((token) => haystack.includes(token));
}

// ========================================================================
// Deep Value Collection
// ========================================================================

/**
 * Recursively collects primitive searchable values from an item.
 *
 * @param {any} source Source value.
 * @param {Array<string>} output Collector array.
 * @param {number} [depth=0] Current recursion depth.
 * @param {Set<object>} [seen] Set of visited objects.
 */
export function collectRecentlyUsedSearchValues(source, output, depth = 0, seen = new Set()) {
    if (source === null || source === undefined || depth > RecentlyUsedSearchTuning.MAX_VALUE_COLLECTION_DEPTH) {
        return;
    }

    if (typeof source === 'string' || typeof source === 'number' || typeof source === 'boolean') {
        output.push(String(source));
        return;
    }

    if (Array.isArray(source)) {
        source.slice(0, RecentlyUsedSearchTuning.MAX_ARRAY_ENTRIES_PER_LEVEL).forEach((entry) => {
            collectRecentlyUsedSearchValues(entry, output, depth + 1, seen);
        });
        return;
    }

    if (typeof source !== 'object') {
        return;
    }

    if (seen.has(source)) {
        return;
    }
    seen.add(source);

    Object.entries(source).forEach(([key, value]) => {
        if (key.startsWith('__recentlyUsed')) {
            return;
        }

        collectRecentlyUsedSearchValues(value, output, depth + 1, seen);
    });
}
