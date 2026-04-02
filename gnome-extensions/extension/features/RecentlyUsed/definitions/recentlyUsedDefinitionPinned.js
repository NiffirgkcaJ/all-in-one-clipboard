import { RecentlyUsedUI } from '../constants/recentlyUsedConstants.js';
import { shouldRecentlyUsedAutoPaste, triggerRecentlyUsedAutoPaste, renderRecentlyUsedClipboardListContent } from '../integrations/recentlyUsedIntegrationClipboard.js';

/**
 * Section definition for clipboard pinned items.
 */
export const RecentlyUsedDefinitionPinned = {
    id: 'pinned',
    targetTab: 'Clipboard',
    layoutType: 'list',
    source: {
        maxItems: RecentlyUsedUI.MAX_SECTION_DISPLAY_COUNT,
    },
    layoutTransition: { threshold: 5, above: 'nested' },
    layoutPolicy: {
        maxVisible: RecentlyUsedUI.MAX_NESTED_DISPLAY_COUNT,
        itemHeight: RecentlyUsedUI.NESTED_ITEM_HEIGHT,
    },
    settings: {
        autoPasteSettingKey: 'auto-paste-clipboard',
        imagePreviewSizeSettingKey: 'clipboard-image-preview-size',
    },
    listPresentation: {
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
     * Initializes the pinned section.
     */
    initialize: () => {},

    /**
     * Cleans up pinned section resources.
     */
    destroy: () => {},

    /**
     * Returns signals that should trigger section re-rendering.
     *
     * @param {object} params Context object.
     * @param {object} params.extension Extension instance.
     * @param {Function} params.onRender Re-render callback.
     * @returns {Array<object>} Signal descriptors.
     */
    getSignals: ({ extension, onRender }) => {
        const clipboardManager = extension?._clipboardManager;
        if (!clipboardManager) return [];
        return [{ obj: clipboardManager, id: clipboardManager.connect('pinned-list-changed', onRender) }];
    },

    /**
     * Indicates whether this section is enabled.
     *
     * @returns {boolean} Always true for pinned items.
     */
    isEnabled: () => true,

    /**
     * Returns pinned clipboard items.
     *
     * @param {object} params Context object.
     * @param {object} params.extension Extension instance.
     * @returns {Array<object>} Pinned clipboard entries.
     */
    getItems: ({ extension }) => {
        const clipboardManager = extension?._clipboardManager;
        return clipboardManager?.getPinnedItems?.() || [];
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
            __recentlyUsedListPresentation: RecentlyUsedDefinitionPinned.listPresentation,
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
            imagePreviewSizeSettingKey: RecentlyUsedDefinitionPinned.settings.imagePreviewSizeSettingKey,
        });
    },

    /**
     * Handles clicks by copying and promoting pinned items.
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

        if (shouldRecentlyUsedAutoPaste(settings, RecentlyUsedDefinitionPinned.settings.autoPasteSettingKey)) {
            await triggerRecentlyUsedAutoPaste();
        }

        return true;
    },
};
