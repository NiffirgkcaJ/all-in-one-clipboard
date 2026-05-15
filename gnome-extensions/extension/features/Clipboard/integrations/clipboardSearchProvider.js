import { ServiceJson } from '../../../shared/services/serviceJson.js';
import { registerSearchProvider } from '../../../shared/services/serviceSearchHub.js';

import { ClipboardProvider } from '../constants/clipboardConstants.js';
import { ClipboardSearchUtils } from '../utilities/clipboardSearchUtils.js';

// ========================================================================
// State
// ========================================================================

let _isProviderRegistered = false;

// ========================================================================
// Internal Helpers
// ========================================================================

/**
 * Collect clipboard items from the extension's clipboard manager and ensure uniqueness.
 *
 * @param {Object} extension The extension instance containing the clipboard manager.
 * @returns {Array} An array of unique clipboard items.
 */
function collectClipboardItems(extension) {
    const clipboardManager = extension?._clipboardManager;
    if (!clipboardManager) {
        return [];
    }

    const historyItems = clipboardManager.getHistoryItems?.() || [];
    const pinnedItems = clipboardManager.getPinnedItems?.() || [];
    const combinedItems = [...pinnedItems, ...historyItems];
    const uniqueItems = [];
    const seenItemIds = new Set();

    combinedItems.forEach((item) => {
        const fallbackKey = ServiceJson.stringifyText(item || {}) || '{}';
        const key = item?.id || item?.value || fallbackKey;
        if (seenItemIds.has(key)) {
            return;
        }

        seenItemIds.add(key);
        uniqueItems.push(item);
    });

    return uniqueItems;
}

// ========================================================================
// Public API
// ========================================================================

/**
 * Register the Clipboard search provider in the shared search hub.
 *
 * @returns {string} Provider ID.
 */
export function ensureClipboardSearchProviderRegistered() {
    if (_isProviderRegistered) {
        return ClipboardProvider.SEARCH_PROVIDER_ID;
    }

    registerSearchProvider({
        id: ClipboardProvider.SEARCH_PROVIDER_ID,
        targetTabs: ['Clipboard'],
        search: async ({ query, context }) => {
            if (!query) {
                return [];
            }

            const items = collectClipboardItems(context?.extension);
            return items.filter((item) => ClipboardSearchUtils.isMatch(item, query));
        },
        applyToTab: async ({ tabActor, query }) => {
            if (!tabActor || typeof tabActor.applyExternalSearch !== 'function') {
                return false;
            }

            await tabActor.applyExternalSearch(query);
            return true;
        },
        clearOnTab: async ({ tabActor }) => {
            if (!tabActor || typeof tabActor.clearExternalSearch !== 'function') {
                return false;
            }

            await tabActor.clearExternalSearch();
            return true;
        },
    });

    _isProviderRegistered = true;
    return ClipboardProvider.SEARCH_PROVIDER_ID;
}
