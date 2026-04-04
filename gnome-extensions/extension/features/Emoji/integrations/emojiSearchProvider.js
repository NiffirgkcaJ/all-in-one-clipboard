import { registerSearchProvider } from '../../../shared/services/serviceSearchHub.js';
import { ServiceJson } from '../../../shared/services/serviceJson.js';
import { IOResource, ResourceItem } from '../../../shared/constants/storagePaths.js';

import { EmojiJsonParser } from '../parsers/emojiJsonParser.js';
import { EmojiProvider } from '../constants/emojiConstants.js';
import { EmojiViewRenderer } from '../view/emojiViewRenderer.js';

const _emojiSearchRenderer = new EmojiViewRenderer(null);
let _emojiCatalogItems = [];
let _emojiCatalogPromise = null;
let _emojiExtensionUuid = 'EmojiSearchProvider';
let _isProviderRegistered = false;

/**
 * Loads the emoji catalog from the extension's resources, parsing it into searchable items.
 *
 * @returns {Promise<Array>} A promise that resolves to an array of emoji catalog items.
 */
async function loadEmojiCatalog() {
    if (_emojiCatalogItems.length > 0) {
        return _emojiCatalogItems;
    }

    if (_emojiCatalogPromise) {
        return _emojiCatalogPromise;
    }

    _emojiCatalogPromise = (async () => {
        const resourceContents = await IOResource.read(ResourceItem.EMOJI);
        const rawJsonData = ServiceJson.parse(resourceContents);
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

    registerSearchProvider({
        id: EmojiProvider.SEARCH_PROVIDER_ID,
        targetTabs: ['Emoji'],
        search: async ({ query }) => {
            if (!query) {
                return [];
            }

            const catalogItems = await loadEmojiCatalog();
            return catalogItems.filter((item) => _emojiSearchRenderer.searchFilter(item || {}, query));
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
    return EmojiProvider.SEARCH_PROVIDER_ID;
}
