import { registerSearchProvider, unregisterSearchProvider } from '../../../shared/services/serviceSearchHub.js';

import { GifManager } from '../managers/gifManager.js';
import { GifProvider } from '../constants/gifConstants.js';

// ========================================================================
// State
// ========================================================================

let _isProviderRegistered = false;
let _gifManager = null;
let _ownsGifManager = false;

// ========================================================================
// Internal Helpers
// ========================================================================

/**
 * Ensures the GIF manager is initialized.
 *
 * @param {object} params Initialization parameters.
 * @param {Gio.Settings} params.settings Extension settings object.
 * @param {string} params.extensionUuid Extension UUID.
 * @param {string} params.extensionPath Extension absolute path.
 * @returns {GifManager|null} The GIF manager instance or null.
 */
function ensureGifManager({ settings, extensionUuid, extensionPath } = {}) {
    if (_gifManager || !settings || !extensionUuid || !extensionPath) {
        return _gifManager;
    }

    _gifManager = new GifManager(settings, extensionUuid, extensionPath);
    _ownsGifManager = true;
    return _gifManager;
}

// ========================================================================
// Public API
// ========================================================================

/**
 * Registers the GIF search provider in the shared Search Hub.
 *
 * @param {object} params Provider configuration.
 * @param {object} params.settings Extension settings object.
 * @param {string} params.extensionUuid Extension UUID.
 * @param {string} params.extensionPath Extension absolute path.
 * @param {GifManager} [params.gifManager] Optional existing GifManager to reuse.
 * @returns {string} Provider id.
 */
export function ensureGifSearchProviderRegistered({ settings, extensionUuid, extensionPath, gifManager } = {}) {
    if (gifManager) {
        if (_ownsGifManager && _gifManager && _gifManager !== gifManager) {
            _gifManager.destroy();
        }
        _gifManager = gifManager;
        _ownsGifManager = false;
    } else {
        ensureGifManager({ settings, extensionUuid, extensionPath });
    }

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
            if (!tabActor) {
                return false;
            }

            await tabActor.applyExternalSearch(query);
            return true;
        },
        clearOnTab: async ({ tabActor }) => {
            if (!tabActor) {
                return false;
            }

            await tabActor.clearExternalSearch();
            return true;
        },
    });

    _isProviderRegistered = true;
    return GifProvider.SEARCH_PROVIDER_ID;
}

/**
 * Unregisters the GIF provider and destroys any manager owned by this module.
 *
 * @returns {void}
 */
export function resetGifSearchProvider() {
    unregisterSearchProvider(GifProvider.SEARCH_PROVIDER_ID);

    if (_ownsGifManager && _gifManager) {
        _gifManager.destroy();
    }

    _gifManager = null;
    _ownsGifManager = false;
    _isProviderRegistered = false;
}
