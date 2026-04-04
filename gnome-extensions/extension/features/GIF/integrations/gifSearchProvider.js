import { GifManager } from '../logic/gifManager.js';
import { GifProvider } from '../constants/gifConstants.js';
import { registerSearchProvider } from '../../../shared/services/serviceSearchHub.js';

let _isProviderRegistered = false;
let _gifManager = null;

function ensureGifManager({ settings, extensionUuid, extensionPath } = {}) {
    if (_gifManager || !settings || !extensionUuid || !extensionPath) {
        return _gifManager;
    }

    _gifManager = new GifManager(settings, extensionUuid, extensionPath);
    return _gifManager;
}

/**
 * Registers the GIF search provider in the shared Search Hub.
 *
 * @param {object} params Provider configuration.
 * @param {object} params.settings Extension settings object.
 * @param {string} params.extensionUuid Extension UUID.
 * @param {string} params.extensionPath Extension absolute path.
 * @returns {string} Provider id.
 */
export function ensureGifSearchProviderRegistered({ settings, extensionUuid, extensionPath } = {}) {
    ensureGifManager({ settings, extensionUuid, extensionPath });

    if (_isProviderRegistered) {
        return GifProvider.SEARCH_PROVIDER_ID;
    }

    registerSearchProvider({
        id: GifProvider.SEARCH_PROVIDER_ID,
        targetTabs: ['GIF'],
        search: async ({ query }) => {
            if (!_gifManager || !query) {
                return [];
            }

            try {
                const { results } = await _gifManager.search(query, null, null);
                if (!Array.isArray(results)) {
                    return [];
                }

                return results
                    .map((item) => ({
                        ...item,
                        value: typeof item?.value === 'string' && item.value.length > 0 ? item.value : item?.full_url || '',
                    }))
                    .filter((item) => typeof item.value === 'string' && item.value.length > 0);
            } catch {
                return [];
            }
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
    return GifProvider.SEARCH_PROVIDER_ID;
}
