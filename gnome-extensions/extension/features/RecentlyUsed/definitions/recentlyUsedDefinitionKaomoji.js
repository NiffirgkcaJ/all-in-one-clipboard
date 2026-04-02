import { RecentlyUsedUI } from '../constants/recentlyUsedConstants.js';
import { createRecentlyUsedRecentsManager, resolveRecentlyUsedRecentFilePath } from '../integrations/recentlyUsedIntegrationRecents.js';
import { setRecentlyUsedClipboardText, shouldRecentlyUsedAutoPaste, triggerRecentlyUsedAutoPaste } from '../integrations/recentlyUsedIntegrationClipboard.js';

let _recentManager = null;

/**
 * Section definition for recently used kaomoji items.
 */
export const RecentlyUsedDefinitionKaomoji = {
    id: 'kaomoji',
    targetTab: 'Kaomoji',
    layoutType: 'list',
    source: {
        maxItems: RecentlyUsedUI.MAX_SECTION_DISPLAY_COUNT,
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

    /**
     * Initializes the kaomoji recents manager.
     *
     * @param {object} params Initialization context.
     * @param {string} params.extensionUuid Extension UUID.
     * @param {object} params.settings Extension settings object.
     */
    initialize: ({ extensionUuid, settings }) => {
        const absolutePath = resolveRecentlyUsedRecentFilePath('RECENT_KAOMOJI');
        _recentManager = createRecentlyUsedRecentsManager(extensionUuid, settings, absolutePath, 'kaomoji-recents-max-items');
    },

    /**
     * Cleans up kaomoji recents resources.
     */
    destroy: () => {
        _recentManager?.destroy();
        _recentManager = null;
    },

    /**
     * Returns signals that trigger kaomoji section updates.
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
     * Indicates whether the kaomoji section is enabled.
     *
     * @param {object} params Context object.
     * @param {object} params.settings Extension settings object.
     * @returns {boolean} True when enabled.
     */
    isEnabled: ({ settings }) => {
        return settings?.get_boolean(RecentlyUsedDefinitionKaomoji.settings.enabledSettingKey) ?? true;
    },

    /**
     * Returns kaomoji recents.
     *
     * @returns {Array<object>} Kaomoji items.
     */
    getItems: () => {
        return _recentManager?.getRecents?.() || [];
    },

    /**
     * Maps a source item into the shared section payload format.
     *
     * @param {object|string} sourceItem Source entry.
     * @returns {object} Normalized payload.
     */
    mapItem: (sourceItem) => {
        const mapped = {
            ...(sourceItem && typeof sourceItem === 'object' ? sourceItem : { value: sourceItem }),
            __recentlyUsedListPresentation: RecentlyUsedDefinitionKaomoji.listPresentation,
            __recentlyUsedGridPresentation: null,
            __recentlyUsedClickPayload: sourceItem,
        };
        // resolve preview from field 'value'
        mapped.preview = sourceItem?.value || '';
        return mapped;
    },

    /**
     * Handles clicks by copying kaomoji content and updating recents.
     *
     * @param {object} params Click context.
     * @returns {Promise<boolean>} True when copy succeeds.
     */
    onClick: async ({ itemData, settings }) => {
        const contentToCopy = itemData?.value || itemData?.char || '';
        if (!contentToCopy) return false;

        setRecentlyUsedClipboardText(contentToCopy);
        _recentManager?.addItem(itemData);

        if (shouldRecentlyUsedAutoPaste(settings, RecentlyUsedDefinitionKaomoji.settings.autoPasteSettingKey)) {
            await triggerRecentlyUsedAutoPaste();
        }

        return true;
    },
};
