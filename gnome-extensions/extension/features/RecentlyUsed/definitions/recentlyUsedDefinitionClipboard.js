import { RecentlyUsedUI } from '../constants/recentlyUsedConstants.js';
import { shouldRecentlyUsedAutoPaste, triggerRecentlyUsedAutoPaste, renderRecentlyUsedClipboardListContent } from '../integrations/recentlyUsedIntegrationClipboard.js';

/**
 * Section definition for clipboard history items.
 */
export const RecentlyUsedDefinitionClipboard = {
    id: 'clipboard',
    targetTab: 'Clipboard',
    layoutType: 'list',
    source: {
        maxItems: RecentlyUsedUI.MAX_SECTION_DISPLAY_COUNT,
    },
    settings: {
        enabledSettingKey: 'enable-clipboard-tab',
        autoPasteSettingKey: 'auto-paste-clipboard',
        imagePreviewSizeSettingKey: 'clipboard-image-preview-size',
    },
    listPresentation: {
        variant: 'default',
        text: {
            weight: 'normal',
            style: 'normal',
            size: 'default',
            align: 'fill',
            truncate: 'end',
        },
    },
    gridPresentation: null,

    /**
     * Initializes the clipboard section.
     */
    initialize: () => {},

    /**
     * Cleans up clipboard section resources.
     */
    destroy: () => {},

    /**
     * Returns signals that trigger clipboard section updates.
     *
     * @param {object} params Context object.
     * @param {object} params.extension Extension instance.
     * @param {Function} params.onRender Re-render callback.
     * @returns {Array<object>} Signal descriptors.
     */
    getSignals: ({ extension, onRender }) => {
        const clipboardManager = extension?._clipboardManager;
        if (!clipboardManager) return [];
        return [{ obj: clipboardManager, id: clipboardManager.connect('history-changed', onRender) }];
    },

    /**
     * Indicates whether the clipboard section is enabled.
     *
     * @param {object} params Context object.
     * @param {object} params.settings Extension settings object.
     * @returns {boolean} True when enabled.
     */
    isEnabled: ({ settings }) => {
        return settings?.get_boolean(RecentlyUsedDefinitionClipboard.settings.enabledSettingKey) ?? true;
    },

    /**
     * Returns clipboard history items.
     *
     * @param {object} params Context object.
     * @param {object} params.extension Extension instance.
     * @returns {Array<object>} Clipboard items.
     */
    getItems: ({ extension }) => {
        const clipboardManager = extension?._clipboardManager;
        return clipboardManager?.getHistoryItems?.() || [];
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
            __recentlyUsedListPresentation: RecentlyUsedDefinitionClipboard.listPresentation,
            __recentlyUsedGridPresentation: null,
            __recentlyUsedClickPayload: sourceItem,
        };
    },

    /**
     * Renders clipboard content for list rows.
     *
     * @param {object} params Render parameters.
     * @returns {boolean} True when custom rendering succeeds.
     */
    renderListContent: ({ button, box, itemData, styleClass, runtimeContext }) => {
        return renderRecentlyUsedClipboardListContent({
            button,
            box,
            itemData,
            styleClass,
            runtimeContext,
            imagePreviewSizeSettingKey: RecentlyUsedDefinitionClipboard.settings.imagePreviewSizeSettingKey,
        });
    },

    /**
     * Handles clicks by copying and promoting clipboard items.
     *
     * @param {object} params Click context.
     * @returns {Promise<boolean>} True when copy succeeds.
     */
    onClick: async ({ itemData, extension, settings }) => {
        const clipboardManager = extension?._clipboardManager;
        if (!clipboardManager) return false;

        const copySuccess = await clipboardManager.copyToSystemClipboard(itemData);
        if (!copySuccess) return false;

        clipboardManager.promoteItemToTop(itemData.id);

        if (shouldRecentlyUsedAutoPaste(settings, RecentlyUsedDefinitionClipboard.settings.autoPasteSettingKey)) {
            await triggerRecentlyUsedAutoPaste();
        }

        return true;
    },
};
