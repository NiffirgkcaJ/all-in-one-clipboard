import { IOResource, ResourceItem } from '../../../shared/constants/storagePaths.js';
import { registerSearchProvider, unregisterSearchProvider } from '../../../shared/services/serviceSearchHub.js';

import { EmojiJsonParser } from '../parsers/emojiJsonParser.js';
import { EmojiProvider } from '../constants/emojiConstants.js';
import { EmojiViewRenderer } from '../view/emojiViewRenderer.js';

// ========================================================================
// State
// ========================================================================

let _emojiCatalogItems = null;
let _emojiCatalogPromise = null;
let _emojiExtensionUuid = 'EmojiSearchProvider';
let _isProviderRegistered = false;

// ========================================================================
// Internal Helpers
// ========================================================================

/**
 * Loads the emoji catalog from the extension's resources, parsing it into searchable items.
 *
 * @returns {Promise<Array>} A promise that resolves to an array of emoji catalog items.
 */
async function loadEmojiCatalog() {
    if (Array.isArray(_emojiCatalogItems)) {
        return _emojiCatalogItems;
    }

    if (_emojiCatalogPromise) {
        return _emojiCatalogPromise;
    }

    _emojiCatalogPromise = (async () => {
        const rawJsonData = await IOResource.readJson(ResourceItem.EMOJI);
        const parser = new EmojiJsonParser(_emojiExtensionUuid);
        const parsedItems = parser.parse(rawJsonData || {});
        _emojiCatalogItems = Array.isArray(parsedItems) ? parsedItems : [];
        return _emojiCatalogItems;
    })()
        .catch(() => [])
        .finally(() => {
            _emojiCatalogPromise = null;
        });

    return _emojiCatalogPromise;
}

// ========================================================================
// Public API
// ========================================================================

/**
 * Registers the Emoji search provider in the shared Search Hub.
 *
 * @param {object} params Provider configuration.
 * @param {string} params.extensionUuid Extension UUID.
 * @returns {string} Provider id.
 */
export function ensureEmojiSearchProviderRegistered({ extensionUuid } = {}) {
    if (typeof extensionUuid === 'string' && extensionUuid.length > 0) {
        _emojiExtensionUuid = extensionUuid;
    }

    if (_isProviderRegistered) {
        return EmojiProvider.SEARCH_PROVIDER_ID;
    }

    let emojiSearchRenderer = null;

    registerSearchProvider({
        id: EmojiProvider.SEARCH_PROVIDER_ID,
        targetTabs: ['Emoji'],
        search: async ({ query }) => {
            if (!query) {
                return [];
            }

            if (!emojiSearchRenderer) {
                emojiSearchRenderer = new EmojiViewRenderer(null);
            }

            const catalogItems = await loadEmojiCatalog();
            return catalogItems.filter((item) => emojiSearchRenderer.searchFilter(item || {}, query));
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
    return EmojiProvider.SEARCH_PROVIDER_ID;
}

/**
 * Unregisters the Emoji provider and clears cached module state.
 *
 * @returns {void}
 */
export function resetEmojiSearchProvider() {
    unregisterSearchProvider(EmojiProvider.SEARCH_PROVIDER_ID);
    _emojiCatalogItems = null;
    _emojiCatalogPromise = null;
    _emojiExtensionUuid = 'EmojiSearchProvider';
    _isProviderRegistered = false;
}
