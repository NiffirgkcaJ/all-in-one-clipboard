import { registerSearchProvider } from '../../../shared/services/serviceSearchHub.js';
import { ServiceJson } from '../../../shared/services/serviceJson.js';
import { IOResource, ResourceItem } from '../../../shared/constants/storagePaths.js';

import { SymbolsJsonParser } from '../parsers/symbolsJsonParser.js';
import { SymbolsProvider } from '../constants/symbolsConstants.js';
import { SymbolsViewRenderer } from '../view/symbolsViewRenderer.js';

const _symbolsSearchRenderer = new SymbolsViewRenderer();
let _symbolsCatalogItems = [];
let _symbolsCatalogPromise = null;
let _symbolsExtensionUuid = 'SymbolsSearchProvider';
let _isProviderRegistered = false;

/**
 * Loads the symbols catalog from the extension's resources, parsing it into searchable items.
 *
 * @returns {Promise<Array>} A promise that resolves to an array of symbols catalog items.
 */
async function loadSymbolsCatalog() {
    if (_symbolsCatalogItems.length > 0) {
        return _symbolsCatalogItems;
    }

    if (_symbolsCatalogPromise) {
        return _symbolsCatalogPromise;
    }

    _symbolsCatalogPromise = (async () => {
        const resourceContents = await IOResource.read(ResourceItem.SYMBOLS);
        const rawJsonData = ServiceJson.parse(resourceContents);
        const parser = new SymbolsJsonParser(_symbolsExtensionUuid);
        const parsedItems = parser.parse(rawJsonData || {});
        _symbolsCatalogItems = Array.isArray(parsedItems) ? parsedItems : [];
        return _symbolsCatalogItems;
    })()
        .catch(() => [])
        .finally(() => {
            _symbolsCatalogPromise = null;
        });

    return _symbolsCatalogPromise;
}

/**
 * Registers the Symbols search provider in the shared Search Hub.
 *
 * @param {object} params Provider configuration.
 * @param {string} params.extensionUuid Extension UUID.
 * @returns {string} Provider id.
 */
export function ensureSymbolsSearchProviderRegistered({ extensionUuid } = {}) {
    if (typeof extensionUuid === 'string' && extensionUuid.length > 0) {
        _symbolsExtensionUuid = extensionUuid;
    }

    if (_isProviderRegistered) {
        return SymbolsProvider.SEARCH_PROVIDER_ID;
    }

    registerSearchProvider({
        id: SymbolsProvider.SEARCH_PROVIDER_ID,
        targetTabs: ['Symbols'],
        search: async ({ query }) => {
            if (!query) {
                return [];
            }

            const catalogItems = await loadSymbolsCatalog();
            return catalogItems.filter((item) => _symbolsSearchRenderer.searchFilter(item || {}, query));
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
    return SymbolsProvider.SEARCH_PROVIDER_ID;
}
