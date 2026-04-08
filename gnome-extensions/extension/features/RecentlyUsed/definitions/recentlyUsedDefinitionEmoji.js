import { searchViaProvider } from '../../../shared/services/serviceSearchHub.js';

import { RecentlyUsedDefaultPolicy } from '../constants/recentlyUsedPolicyConstants.js';
import { createRecentlyUsedRecentsManager, resolveRecentlyUsedRecentFilePath } from '../integrations/recentlyUsedIntegrationRecents.js';
import { setRecentlyUsedClipboardText, shouldRecentlyUsedAutoPaste, triggerRecentlyUsedAutoPaste } from '../integrations/recentlyUsedIntegrationClipboard.js';

import { EmojiProvider } from '../../Emoji/constants/emojiConstants.js';
import { EmojiViewRenderer } from '../../Emoji/view/emojiViewRenderer.js';
import { ensureEmojiSearchProviderRegistered } from '../../Emoji/integrations/emojiSearchProvider.js';

let _recentManager = null;
const _emojiSearchRenderer = new EmojiViewRenderer(null);

/**
 * Section definition for recently used emoji items.
 */
export const RecentlyUsedDefinitionEmoji = {
    id: 'emoji',
    targetTab: 'Emoji',
    layoutType: 'grid',
    source: {
        maxItems: RecentlyUsedDefaultPolicy.GLOBAL_VISIBLE_ITEMS,
    },
    settings: {
        enabledSettingKey: 'enable-emoji-tab',
        autoPasteSettingKey: 'auto-paste-emoji',
    },
    gridPresentation: {
        contentMode: 'char-or-value-text',
        tooltipMode: 'name-or-value',
        icon: null,
    },
    listPresentation: null,

    /**
     * Initializes the emoji recents manager.
     *
     * @param {object} params Initialization context.
     * @param {string} params.extensionUuid Extension UUID.
     * @param {object} params.settings Extension settings object.
     */
    initialize: ({ extensionUuid, settings }) => {
        ensureEmojiSearchProviderRegistered({ extensionUuid });

        if (_recentManager) {
            try {
                _recentManager.destroy();
            } catch {
                // Ignore stale manager teardown errors before re-init.
            }
            _recentManager = null;
        }

        const absolutePath = resolveRecentlyUsedRecentFilePath('RECENT_EMOJI');
        _recentManager = createRecentlyUsedRecentsManager(extensionUuid, settings, absolutePath, 'emoji-recents-max-items');
    },

    /**
     * Cleans up emoji recents resources.
     */
    destroy: () => {
        _recentManager?.destroy();
        _recentManager = null;
    },

    /**
     * Returns signals that trigger emoji section updates.
     *
     * @param {object} params Context object.
     * @param {Function} params.onRender Re-render callback.
     * @returns {Array<object>} Signal descriptors.
     */
    getSignals: ({ onRender }) => {
        if (!_recentManager) return [];
        return [{ obj: _recentManager, id: _recentManager.connect('recents-changed', onRender) }];
    },

    /**
     * Indicates whether the emoji section is enabled.
     *
     * @param {object} params Context object.
     * @param {object} params.settings Extension settings object.
     * @returns {boolean} True when enabled.
     */
    isEnabled: ({ settings }) => {
        return settings?.get_boolean(RecentlyUsedDefinitionEmoji.settings.enabledSettingKey) ?? true;
    },

    /**
     * Returns emoji recents.
     *
     * @returns {Array<object>} Emoji items.
     */
    getItems: () => {
        return _recentManager?.getRecents?.() || [];
    },

    /**
     * Searches the emoji catalog using the same filter behavior as the Emoji tab.
     *
     * @param {object} params Search context.
     * @param {string} params.query Normalized search query.
     * @returns {Promise<Array<object>>} Matching emoji entries.
     */
    searchItems: async ({ query }) => {
        return searchViaProvider(EmojiProvider.SEARCH_PROVIDER_ID, { query });
    },

    /**
     * Maps a source item into the shared section payload format.
     *
     * @param {object|string} sourceItem Source entry.
     * @returns {object} Normalized payload.
     */
    mapItem: (sourceItem) => {
        const normalizedItem = sourceItem && typeof sourceItem === 'object' ? { ...sourceItem } : { value: sourceItem };
        if (typeof normalizedItem.value !== 'string' || normalizedItem.value.length === 0) {
            normalizedItem.value = normalizedItem.char || '';
        }

        return {
            ...normalizedItem,
            __recentlyUsedListPresentation: RecentlyUsedDefinitionEmoji.listPresentation,
            __recentlyUsedGridPresentation: RecentlyUsedDefinitionEmoji.gridPresentation,
            __recentlyUsedClickPayload: sourceItem,
        };
    },

    /**
     * Matches emoji entries using Emoji tab search behavior.
     *
     * @param {object} params Search context.
     * @param {object} params.item Candidate item.
     * @param {string} params.query Normalized search query.
     * @param {Function} params.fallbackMatch Generic fallback matcher.
     * @returns {boolean} True when the emoji matches search.
     */
    matchesSearch: ({ item, query, fallbackMatch }) => {
        if (!query) {
            return true;
        }

        try {
            return _emojiSearchRenderer.searchFilter(item || {}, query);
        } catch {
            return typeof fallbackMatch === 'function' ? fallbackMatch(item) : false;
        }
    },

    /**
     * Handles clicks by copying emoji content and updating recents.
     *
     * @param {object} params Click context.
     * @returns {Promise<boolean>} True when copy succeeds.
     */
    onClick: async ({ itemData, settings }) => {
        const contentToCopy = itemData?.char || itemData?.value || '';
        if (!contentToCopy) return false;

        setRecentlyUsedClipboardText(contentToCopy);
        _recentManager?.addItem({ ...itemData, value: contentToCopy });

        if (shouldRecentlyUsedAutoPaste(settings, RecentlyUsedDefinitionEmoji.settings.autoPasteSettingKey)) {
            await triggerRecentlyUsedAutoPaste();
        }

        return true;
    },
};
