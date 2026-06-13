import { IOResource, ResourceItem } from '../../../shared/constants/storagePaths.js';
import { registerSearchProvider, unregisterSearchProvider } from '../../../shared/services/serviceSearchHub.js';

import { KaomojiJsonParser } from '../parsers/kaomojiJsonParser.js';
import { KaomojiProvider } from '../constants/kaomojiConstants.js';
import { KaomojiViewRenderer } from '../view/kaomojiViewRenderer.js';

// ========================================================================
// State
// ========================================================================

let _kaomojiCatalogItems = null;
let _kaomojiCatalogPromise = null;
let _kaomojiExtensionUuid = 'KaomojiSearchProvider';
let _isProviderRegistered = false;

// ========================================================================
// Internal Helpers
// ========================================================================

/**
 * Loads the kaomoji catalog from the extension's resources, parsing it into searchable items.
 *
 * @returns {Promise<Array>} A promise that resolves to an array of kaomoji catalog items.
 */
async function loadKaomojiCatalog() {
    if (Array.isArray(_kaomojiCatalogItems)) {
        return _kaomojiCatalogItems;
    }

    if (_kaomojiCatalogPromise) {
        return _kaomojiCatalogPromise;
    }

    _kaomojiCatalogPromise = (async () => {
        const rawJsonData = await IOResource.readJson(ResourceItem.KAOMOJI);
        const parser = new KaomojiJsonParser(_kaomojiExtensionUuid);
        const parsedItems = parser.parse(rawJsonData || {});
        _kaomojiCatalogItems = Array.isArray(parsedItems) ? parsedItems : [];
        return _kaomojiCatalogItems;
    })()
        .catch(() => [])
        .finally(() => {
            _kaomojiCatalogPromise = null;
        });

    return _kaomojiCatalogPromise;
}

// ========================================================================
// Public API
// ========================================================================

/**
 * Registers the Kaomoji search provider in the shared Search Hub.
 *
 * @param {object} params Provider configuration.
 * @param {string} params.extensionUuid Extension UUID.
 * @returns {string} Provider id.
 */
export function ensureKaomojiSearchProviderRegistered({ extensionUuid } = {}) {
    if (typeof extensionUuid === 'string' && extensionUuid.length > 0) {
        _kaomojiExtensionUuid = extensionUuid;
    }

    if (_isProviderRegistered) {
        return KaomojiProvider.SEARCH_PROVIDER_ID;
    }

    let kaomojiSearchRenderer = null;

    registerSearchProvider({
        id: KaomojiProvider.SEARCH_PROVIDER_ID,
        targetTabs: ['Kaomoji'],
        search: async ({ query }) => {
            if (!query) {
                return [];
            }

            if (!kaomojiSearchRenderer) {
                kaomojiSearchRenderer = new KaomojiViewRenderer();
            }

            const catalogItems = await loadKaomojiCatalog();
            return catalogItems.filter((item) => kaomojiSearchRenderer.searchFilter(item || {}, query));
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
    return KaomojiProvider.SEARCH_PROVIDER_ID;
}

/**
 * Unregisters the Kaomoji provider and clears cached module state.
 *
 * @returns {void}
 */
export function resetKaomojiSearchProvider() {
    unregisterSearchProvider(KaomojiProvider.SEARCH_PROVIDER_ID);
    _kaomojiCatalogItems = null;
    _kaomojiCatalogPromise = null;
    _kaomojiExtensionUuid = 'KaomojiSearchProvider';
    _isProviderRegistered = false;
}
