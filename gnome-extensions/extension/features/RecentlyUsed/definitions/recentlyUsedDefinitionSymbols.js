import { RecentlyUsedUI } from '../constants/recentlyUsedConstants.js';
import { createRecentlyUsedRecentsManager, resolveRecentlyUsedRecentFilePath } from '../integrations/recentlyUsedIntegrationRecents.js';
import { setRecentlyUsedClipboardText, shouldRecentlyUsedAutoPaste, triggerRecentlyUsedAutoPaste } from '../integrations/recentlyUsedIntegrationClipboard.js';

let _recentManager = null;

/**
 * Section definition for recently used symbol items.
 */
export const RecentlyUsedDefinitionSymbols = {
    id: 'symbols',
    targetTab: 'Symbols',
    layoutType: 'grid',
    source: {
        maxItems: RecentlyUsedUI.MAX_SECTION_DISPLAY_COUNT,
    },
    settings: {
        enabledSettingKey: 'enable-symbols-tab',
        autoPasteSettingKey: 'auto-paste-symbols',
    },
    gridPresentation: {
        contentMode: 'char-or-value-text',
        tooltipMode: 'name-or-value',
        icon: null,
    },
    listPresentation: null,

    /**
     * Initializes the symbols recents manager.
     *
     * @param {object} params Initialization context.
     * @param {string} params.extensionUuid Extension UUID.
     * @param {object} params.settings Extension settings object.
     */
    initialize: ({ extensionUuid, settings }) => {
        const absolutePath = resolveRecentlyUsedRecentFilePath('RECENT_SYMBOLS');
        _recentManager = createRecentlyUsedRecentsManager(extensionUuid, settings, absolutePath, 'symbols-recents-max-items');
    },

    /**
     * Cleans up symbols recents resources.
     */
    destroy: () => {
        _recentManager?.destroy();
        _recentManager = null;
    },

    /**
     * Returns signals that trigger symbols section updates.
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
     * Indicates whether the symbols section is enabled.
     *
     * @param {object} params Context object.
     * @param {object} params.settings Extension settings object.
     * @returns {boolean} True when enabled.
     */
    isEnabled: ({ settings }) => {
        return settings?.get_boolean(RecentlyUsedDefinitionSymbols.settings.enabledSettingKey) ?? true;
    },

    /**
     * Returns symbols recents.
     *
     * @returns {Array<object>} Symbol items.
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
        return {
            ...(sourceItem && typeof sourceItem === 'object' ? sourceItem : { value: sourceItem }),
            __recentlyUsedListPresentation: RecentlyUsedDefinitionSymbols.listPresentation,
            __recentlyUsedGridPresentation: RecentlyUsedDefinitionSymbols.gridPresentation,
            __recentlyUsedClickPayload: sourceItem,
        };
    },

    /**
     * Handles clicks by copying symbol content and updating recents.
     *
     * @param {object} params Click context.
     * @returns {Promise<boolean>} True when copy succeeds.
     */
    onClick: async ({ itemData, settings }) => {
        const contentToCopy = itemData?.char || itemData?.value || '';
        if (!contentToCopy) return false;

        setRecentlyUsedClipboardText(contentToCopy);
        _recentManager?.addItem(itemData);

        if (shouldRecentlyUsedAutoPaste(settings, RecentlyUsedDefinitionSymbols.settings.autoPasteSettingKey)) {
            await triggerRecentlyUsedAutoPaste();
        }

        return true;
    },
};
