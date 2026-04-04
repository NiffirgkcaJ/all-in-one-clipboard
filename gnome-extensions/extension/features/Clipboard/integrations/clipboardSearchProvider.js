import { registerSearchProvider } from '../../../shared/services/serviceSearchHub.js';

import { ClipboardProvider } from '../constants/clipboardConstants.js';
import { ClipboardSearchUtils } from '../utilities/clipboardSearchUtils.js';

let _isProviderRegistered = false;

/**
 * Collects clipboard items from the extension's clipboard manager, ensuring uniqueness.
 *
 * @param {object} extension The extension instance containing the clipboard manager.
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
        const key = item?.id || item?.value || JSON.stringify(item || {});
        if (seenItemIds.has(key)) {
            return;
        }

        seenItemIds.add(key);
        uniqueItems.push(item);
    });

    return uniqueItems;
}

/**
 * Registers the Clipboard search provider in the shared Search Hub.
 *
 * @returns {string} Provider id.
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
