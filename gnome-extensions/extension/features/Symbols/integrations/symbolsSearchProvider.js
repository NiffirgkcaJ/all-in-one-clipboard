import { IOResource, ResourceItem } from '../../../shared/constants/storagePaths.js';
import { registerSearchProvider, unregisterSearchProvider } from '../../../shared/services/serviceSearchHub.js';

import { SymbolsJsonParser } from '../parsers/symbolsJsonParser.js';
import { SymbolsProvider } from '../constants/symbolsConstants.js';
import { SymbolsViewRenderer } from '../view/symbolsViewRenderer.js';

// ========================================================================
// State
// ========================================================================

let _symbolsCatalogItems = null;
let _symbolsCatalogPromise = null;
let _symbolsExtensionUuid = 'SymbolsSearchProvider';
let _isProviderRegistered = false;

// ========================================================================
// Internal Helpers
// ========================================================================

/**
 * Loads the symbols catalog from the extension's resources, parsing it into searchable items.
 *
 * @returns {Promise<Array>} A promise that resolves to an array of symbols catalog items.
 */
async function loadSymbolsCatalog() {
    if (Array.isArray(_symbolsCatalogItems)) {
        return _symbolsCatalogItems;
    }

    if (_symbolsCatalogPromise) {
        return _symbolsCatalogPromise;
    }

    _symbolsCatalogPromise = (async () => {
        const rawJsonData = await IOResource.readJson(ResourceItem.SYMBOLS);
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

// ========================================================================
// Public API
// ========================================================================

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

    let symbolsSearchRenderer = null;

    registerSearchProvider({
        id: SymbolsProvider.SEARCH_PROVIDER_ID,
        targetTabs: ['Symbols'],
        search: async ({ query }) => {
            if (!query) {
                return [];
            }

            if (!symbolsSearchRenderer) {
                symbolsSearchRenderer = new SymbolsViewRenderer();
            }

            const catalogItems = await loadSymbolsCatalog();
            return catalogItems.filter((item) => symbolsSearchRenderer.searchFilter(item || {}, query));
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
    return SymbolsProvider.SEARCH_PROVIDER_ID;
}

/**
 * Unregisters the Symbols provider and clears cached module state.
 *
 * @returns {void}
 */
export function resetSymbolsSearchProvider() {
    unregisterSearchProvider(SymbolsProvider.SEARCH_PROVIDER_ID);
    _symbolsCatalogItems = null;
    _symbolsCatalogPromise = null;
    _symbolsExtensionUuid = 'SymbolsSearchProvider';
    _isProviderRegistered = false;
}
