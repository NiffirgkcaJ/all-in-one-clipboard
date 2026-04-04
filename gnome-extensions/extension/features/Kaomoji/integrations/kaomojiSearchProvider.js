import { registerSearchProvider } from '../../../shared/services/serviceSearchHub.js';
import { ServiceJson } from '../../../shared/services/serviceJson.js';
import { IOResource, ResourceItem } from '../../../shared/constants/storagePaths.js';

import { KaomojiJsonParser } from '../parsers/kaomojiJsonParser.js';
import { KaomojiProvider } from '../constants/kaomojiConstants.js';
import { KaomojiViewRenderer } from '../view/kaomojiViewRenderer.js';

const _kaomojiSearchRenderer = new KaomojiViewRenderer();
let _kaomojiCatalogItems = [];
let _kaomojiCatalogPromise = null;
let _kaomojiExtensionUuid = 'KaomojiSearchProvider';
let _isProviderRegistered = false;

/**
 * Loads the kaomoji catalog from the extension's resources, parsing it into searchable items.
 *
 * @returns {Promise<Array>} A promise that resolves to an array of kaomoji catalog items.
 */
async function loadKaomojiCatalog() {
    if (_kaomojiCatalogItems.length > 0) {
        return _kaomojiCatalogItems;
    }

    if (_kaomojiCatalogPromise) {
        return _kaomojiCatalogPromise;
    }

    _kaomojiCatalogPromise = (async () => {
        const resourceContents = await IOResource.read(ResourceItem.KAOMOJI);
        const rawJsonData = ServiceJson.parse(resourceContents);
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

    registerSearchProvider({
        id: KaomojiProvider.SEARCH_PROVIDER_ID,
        targetTabs: ['Kaomoji'],
        search: async ({ query }) => {
            if (!query) {
                return [];
            }

            const catalogItems = await loadKaomojiCatalog();
            return catalogItems.filter((item) => _kaomojiSearchRenderer.searchFilter(item || {}, query));
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
    return KaomojiProvider.SEARCH_PROVIDER_ID;
}
