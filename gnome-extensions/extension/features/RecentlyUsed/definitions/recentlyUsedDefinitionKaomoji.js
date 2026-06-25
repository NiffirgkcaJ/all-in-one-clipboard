import { GlobalActionService } from '../../../shared/services/serviceAction.js';
import { searchViaProvider } from '../../../shared/services/serviceSearchHub.js';

import { RecentlyUsedDefaultPolicy } from '../constants/recentlyUsedPolicyConstants.js';
import { RecentlyUsedSectionDefinition } from '../registry/recentlyUsedSectionDefinition.js';
import { setRecentlyUsedClipboardText } from '../integrations/recentlyUsedIntegrationClipboard.js';
import { createRecentlyUsedRecentsManager, resolveRecentlyUsedRecentFilePath } from '../integrations/recentlyUsedIntegrationRecents.js';

import { ensureKaomojiSearchProviderRegistered } from '../../Kaomoji/integrations/kaomojiSearchProvider.js';
import { KaomojiProvider } from '../../Kaomoji/constants/kaomojiConstants.js';
import { KaomojiViewRenderer } from '../../Kaomoji/view/kaomojiViewRenderer.js';

/**
 * Creates a runtime-scoped kaomoji section definition.
 *
 * @returns {object} Kaomoji section definition instance.
 */
function createRecentlyUsedDefinitionKaomojiInstance() {
    let recentManager = null;
    let kaomojiSearchRenderer = null;

    const definition = new RecentlyUsedSectionDefinition({
        id: 'kaomoji',
        targetTab: 'Kaomoji',
        layoutType: 'list',
        source: {
            maxItems: RecentlyUsedDefaultPolicy.GLOBAL_VISIBLE_ITEMS,
        },
        settings: {
            enabledSettingKey: 'enable-kaomoji-tab',
            autoPasteSettingKey: 'auto-paste-kaomoji',
        },
        listPresentation: {
            variant: 'default',
            contentMode: 'text',
            text: {
                weight: 'bold',
                style: 'normal',
                size: 'default',
                align: 'center',
                truncate: 'none',
            },
        },
        gridPresentation: null,
    });

    /**
     * Initializes the kaomoji recents manager.
     *
     * @param {object} params Initialization context.
     * @param {string} params.extensionUuid Extension UUID.
     * @param {object} params.settings Extension settings object.
     */
    definition.initialize = ({ extensionUuid, settings }) => {
        ensureKaomojiSearchProviderRegistered({ extensionUuid });

        if (recentManager) {
            recentManager.destroy();
            recentManager = null;
        }

        const absolutePath = resolveRecentlyUsedRecentFilePath('RECENT_KAOMOJI');
        recentManager = createRecentlyUsedRecentsManager(extensionUuid, settings, absolutePath, 'kaomoji-recents-max-items');
    };

    /**
     * Cleans up kaomoji recents resources.
     */
    definition.destroy = () => {
        recentManager?.destroy();
        recentManager = null;
    };

    /**
     * Returns signals that trigger kaomoji section updates.
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
     * Indicates whether the kaomoji section is enabled.
     *
     * @param {object} params Context object.
     * @param {object} params.settings Extension settings object.
     * @returns {boolean} True when enabled.
     */
    definition.isEnabled = ({ settings }) => {
        return settings?.get_boolean(definition.settings.enabledSettingKey) ?? true;
    };

    /**
     * Returns kaomoji recents.
     *
     * @returns {Array<object>} Kaomoji items.
     */
    definition.getItems = () => {
        return recentManager ? recentManager.getRecents() : [];
    };

    /**
     * Searches the kaomoji catalog using the same filter behavior as the Kaomoji tab.
     *
     * @param {object} params Search context.
     * @param {string} params.query Normalized search query.
     * @returns {Promise<Array<object>>} Matching kaomoji entries.
     */
    definition.searchItems = async ({ query }) => {
        return searchViaProvider(KaomojiProvider.SEARCH_PROVIDER_ID, { query });
    };

    /**
     * Maps a source item into the shared section payload format.
     *
     * @param {object|string} sourceItem Source entry.
     * @returns {object} Normalized payload.
     */
    definition.mapItem = (sourceItem) => {
        const mapped = {
            ...(sourceItem && typeof sourceItem === 'object' ? sourceItem : { value: sourceItem }),
            __recentlyUsedListPresentation: definition.listPresentation,
            __recentlyUsedGridPresentation: null,
            __recentlyUsedClickPayload: sourceItem,
        };
        const normalizedValue = mapped.value || mapped.char || mapped.kaomoji || '';
        mapped.value = typeof normalizedValue === 'string' ? normalizedValue : '';
        if (!mapped.char && typeof mapped.kaomoji === 'string') {
            mapped.char = mapped.kaomoji;
        }
        // resolve preview from field 'value'
        mapped.preview = mapped.value || '';
        return mapped;
    };

    /**
     * Matches kaomoji entries using Kaomoji tab search behavior.
     *
     * @param {object} params Search context.
     * @param {object} params.item Candidate item.
     * @param {string} params.query Normalized search query.
     * @param {Function} params.fallbackMatch Generic fallback matcher.
     * @returns {boolean} True when the kaomoji matches search.
     */
    definition.matchesSearch = ({ item, query, fallbackMatch }) => {
        if (!query) {
            return true;
        }

        if (!kaomojiSearchRenderer) {
            kaomojiSearchRenderer = new KaomojiViewRenderer();
        }

        const fallback = fallbackMatch(item);
        return kaomojiSearchRenderer.searchFilter(item || {}, query) || fallback;
    };

    /**
     * Handles clicks by copying kaomoji content and updating recents.
     *
     * @param {object} params Click context.
     * @returns {Promise<boolean>} True when copy succeeds.
     */
    definition.onClick = async ({ itemData, settings, extension }) => {
        const contentToCopy = itemData?.value || itemData?.char || itemData?.kaomoji || '';
        if (!contentToCopy) return false;

        return await GlobalActionService.executeCopyAction({
            onCopy: async () => {
                setRecentlyUsedClipboardText(contentToCopy);
                return true;
            },
            onPostCopy: () => recentManager?.addItem({ ...itemData, value: contentToCopy, char: itemData?.char || itemData?.kaomoji || contentToCopy }),
            settings,
            autoPasteKey: definition.settings.autoPasteSettingKey,
            menu: extension?._indicator?.menu,
        });
    };

    definition.createInstance = () => createRecentlyUsedDefinitionKaomojiInstance();

    return definition;
}

/**
 * Section definition template for recently used kaomoji items.
 */
export const RecentlyUsedDefinitionKaomoji = () => createRecentlyUsedDefinitionKaomojiInstance();
