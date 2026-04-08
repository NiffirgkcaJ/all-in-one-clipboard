import { searchViaProvider } from '../../../shared/services/serviceSearchHub.js';

import { RecentlyUsedDefaultPolicy } from '../constants/recentlyUsedPolicyConstants.js';
import { createRecentlyUsedRecentsManager, resolveRecentlyUsedRecentFilePath } from '../integrations/recentlyUsedIntegrationRecents.js';
import { setRecentlyUsedClipboardText, shouldRecentlyUsedAutoPaste, triggerRecentlyUsedAutoPaste } from '../integrations/recentlyUsedIntegrationClipboard.js';

import { EmojiProvider } from '../../Emoji/constants/emojiConstants.js';
import { EmojiViewRenderer } from '../../Emoji/view/emojiViewRenderer.js';
import { ensureEmojiSearchProviderRegistered } from '../../Emoji/integrations/emojiSearchProvider.js';

const _emojiSearchRenderer = new EmojiViewRenderer(null);

/**
 * Creates a runtime-scoped emoji section definition.
 *
 * @returns {object} Emoji section definition instance.
 */
function createRecentlyUsedDefinitionEmojiInstance() {
    let recentManager = null;

    const definition = {
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
    };

    /**
     * Initializes the emoji recents manager.
     *
     * @param {object} params Initialization context.
     * @param {string} params.extensionUuid Extension UUID.
     * @param {object} params.settings Extension settings object.
     */
    definition.initialize = ({ extensionUuid, settings }) => {
        ensureEmojiSearchProviderRegistered({ extensionUuid });

        if (recentManager) {
            try {
                recentManager.destroy();
            } catch {
                // Ignore stale manager teardown errors before re-init.
            }
            recentManager = null;
        }

        const absolutePath = resolveRecentlyUsedRecentFilePath('RECENT_EMOJI');
        recentManager = createRecentlyUsedRecentsManager(extensionUuid, settings, absolutePath, 'emoji-recents-max-items');
    };

    /**
     * Cleans up emoji recents resources.
     */
    definition.destroy = () => {
        recentManager?.destroy();
        recentManager = null;
    };

    /**
     * Returns signals that trigger emoji section updates.
     *
     * @param {object} params Context object.
     * @param {Function} params.onRender Re-render callback.
     * @returns {Array<object>} Signal descriptors.
     */
    definition.getSignals = ({ onRender }) => {
        if (!recentManager) return [];
        return [{ obj: recentManager, id: recentManager.connect('recents-changed', onRender) }];
    };

    /**
     * Indicates whether the emoji section is enabled.
     *
     * @param {object} params Context object.
     * @param {object} params.settings Extension settings object.
     * @returns {boolean} True when enabled.
     */
    definition.isEnabled = ({ settings }) => {
        return settings?.get_boolean(definition.settings.enabledSettingKey) ?? true;
    };

    /**
     * Returns emoji recents.
     *
     * @returns {Array<object>} Emoji items.
     */
    definition.getItems = () => {
        return recentManager?.getRecents?.() || [];
    };

    /**
     * Searches the emoji catalog using the same filter behavior as the Emoji tab.
     *
     * @param {object} params Search context.
     * @param {string} params.query Normalized search query.
     * @returns {Promise<Array<object>>} Matching emoji entries.
     */
    definition.searchItems = async ({ query }) => {
        return searchViaProvider(EmojiProvider.SEARCH_PROVIDER_ID, { query });
    };

    /**
     * Maps a source item into the shared section payload format.
     *
     * @param {object|string} sourceItem Source entry.
     * @returns {object} Normalized payload.
     */
    definition.mapItem = (sourceItem) => {
        const normalizedItem = sourceItem && typeof sourceItem === 'object' ? { ...sourceItem } : { value: sourceItem };
        if (typeof normalizedItem.value !== 'string' || normalizedItem.value.length === 0) {
            normalizedItem.value = normalizedItem.char || '';
        }

        return {
            ...normalizedItem,
            __recentlyUsedListPresentation: definition.listPresentation,
            __recentlyUsedGridPresentation: definition.gridPresentation,
            __recentlyUsedClickPayload: sourceItem,
        };
    };

    /**
     * Matches emoji entries using Emoji tab search behavior.
     *
     * @param {object} params Search context.
     * @param {object} params.item Candidate item.
     * @param {string} params.query Normalized search query.
     * @param {Function} params.fallbackMatch Generic fallback matcher.
     * @returns {boolean} True when the emoji matches search.
     */
    definition.matchesSearch = ({ item, query, fallbackMatch }) => {
        if (!query) {
            return true;
        }

        try {
            return _emojiSearchRenderer.searchFilter(item || {}, query);
        } catch {
            return typeof fallbackMatch === 'function' ? fallbackMatch(item) : false;
        }
    };

    /**
     * Handles clicks by copying emoji content and updating recents.
     *
     * @param {object} params Click context.
     * @returns {Promise<boolean>} True when copy succeeds.
     */
    definition.onClick = async ({ itemData, settings }) => {
        const contentToCopy = itemData?.char || itemData?.value || '';
        if (!contentToCopy) return false;

        setRecentlyUsedClipboardText(contentToCopy);
        recentManager?.addItem({ ...itemData, value: contentToCopy });

        if (shouldRecentlyUsedAutoPaste(settings, definition.settings.autoPasteSettingKey)) {
            await triggerRecentlyUsedAutoPaste();
        }

        return true;
    };

    definition.createInstance = () => createRecentlyUsedDefinitionEmojiInstance();

    return definition;
}

/**
 * Section definition template for recently used emoji items.
 */
export const RecentlyUsedDefinitionEmoji = createRecentlyUsedDefinitionEmojiInstance();
