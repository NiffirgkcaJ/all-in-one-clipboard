import { GlobalActionService } from '../../../shared/services/serviceAction.js';
import { searchViaProvider } from '../../../shared/services/serviceSearchHub.js';

import { RecentlyUsedDefaultPolicy } from '../constants/recentlyUsedPolicyConstants.js';
import { RecentlyUsedSectionDefinition } from '../registry/recentlyUsedSectionDefinition.js';
import { renderRecentlyUsedClipboardListContent } from '../integrations/recentlyUsedIntegrationClipboard.js';

import { ClipboardProvider } from '../../Clipboard/constants/clipboardConstants.js';
import { ClipboardSearchUtils } from '../../Clipboard/utilities/clipboardSearchUtils.js';
import { ensureClipboardSearchProviderRegistered } from '../../Clipboard/integrations/clipboardSearchProvider.js';

/**
 * Creates a runtime-scoped clipboard history section definition.
 *
 * @returns {object} Clipboard history section definition instance.
 */
function createRecentlyUsedDefinitionClipboardHistoryInstance() {
    const definition = new RecentlyUsedSectionDefinition({
        id: 'clipboard-history',
        targetTab: 'Clipboard',
        layoutType: 'list',
        source: {
            maxItems: RecentlyUsedDefaultPolicy.GLOBAL_VISIBLE_ITEMS,
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
    });

    /**
     * Initializes the clipboard history section.
     */
    definition.initialize = () => {
        ensureClipboardSearchProviderRegistered();
    };

    /**
     * Cleans up clipboard history section resources.
     */
    definition.destroy = () => {};

    /**
     * Returns signals that trigger clipboard history section updates.
     *
     * @param {object} params Context object.
     * @param {object} params.extension Extension instance.
     * @param {Function} params.onRender Re-render callback.
     * @returns {Array<object>} Signal descriptors.
     */
    definition.getSignals = ({ extension, onRender }) => {
        const clipboardManager = extension?._clipboardManager;
        if (!clipboardManager) return [];
        return [{ obj: clipboardManager, id: clipboardManager.connect('history-changed', onRender) }];
    };

    /**
     * Indicates whether the clipboard history section is enabled.
     *
     * @param {object} params Context object.
     * @param {object} params.settings Extension settings object.
     * @returns {boolean} True when enabled.
     */
    definition.isEnabled = ({ settings }) => {
        return settings.get_boolean(definition.settings.enabledSettingKey);
    };

    /**
     * Returns clipboard history items.
     *
     * @param {object} params Context object.
     * @param {object} params.extension Extension instance.
     * @returns {Array<object>} Clipboard history items.
     */
    definition.getItems = ({ extension }) => {
        const clipboardManager = extension?._clipboardManager;
        return clipboardManager ? clipboardManager.getHistoryItems() : [];
    };

    /**
     * Searches clipboard history items through the shared Search Hub provider.
     *
     * @param {object} params Search context.
     * @param {string} params.query Normalized search query.
     * @param {object} params.runtimeContext Runtime context.
     * @returns {Promise<Array<object>>} Matching clipboard history items.
     */
    definition.searchItems = async ({ query, runtimeContext }) => {
        if (!query) {
            return [];
        }

        const extension = runtimeContext?.extension;
        const clipboardManager = extension?._clipboardManager;
        const historyIds = new Set((clipboardManager ? clipboardManager.getHistoryItems() : []).map((item) => item?.id));
        const providerItems = await searchViaProvider(ClipboardProvider.SEARCH_PROVIDER_ID, {
            query,
            context: { extension },
        });

        return providerItems.filter((item) => historyIds.has(item?.id));
    };

    /**
     * Maps a source item into the shared section payload format.
     *
     * @param {object|string} sourceItem Source entry.
     * @returns {object} Normalized payload.
     */
    definition.mapItem = (sourceItem) => {
        return {
            ...(sourceItem && typeof sourceItem === 'object' ? sourceItem : { value: sourceItem }),
            __recentlyUsedListPresentation: definition.listPresentation,
            __recentlyUsedGridPresentation: null,
            __recentlyUsedClickPayload: sourceItem,
        };
    };

    /**
     * Matches clipboard history items using Clipboard tab search behavior.
     *
     * @param {object} params Search context.
     * @param {object} params.item Candidate item.
     * @param {string} params.query Normalized search query.
     * @param {Function} params.fallbackMatch Generic fallback matcher.
     * @returns {boolean} True when the clipboard history item matches search.
     */
    definition.matchesSearch = ({ item, query, fallbackMatch }) => {
        if (!query) {
            return true;
        }

        const fallback = fallbackMatch(item);
        return ClipboardSearchUtils.isMatch(item, query) || fallback;
    };

    /**
     * Renders clipboard content for list rows.
     *
     * @param {object} params Render parameters.
     * @returns {boolean} True when custom rendering succeeds.
     */
    definition.renderListContent = ({ button, box, itemData, styleClass, runtimeContext }) => {
        return renderRecentlyUsedClipboardListContent({
            button,
            box,
            itemData,
            styleClass,
            runtimeContext,
            imagePreviewSizeSettingKey: definition.settings.imagePreviewSizeSettingKey,
        });
    };

    /**
     * Handles clicks by copying and promoting clipboard history items.
     *
     * @param {object} params Click context.
     * @returns {Promise<boolean>} True when copy succeeds.
     */
    definition.onClick = async ({ itemData, extension, settings }) => {
        const clipboardManager = extension?._clipboardManager;
        if (!clipboardManager) return false;

        return await GlobalActionService.executeCopyAction({
            onCopy: async () => await clipboardManager.copyToSystemClipboard(itemData),
            onPostCopy: () => clipboardManager.promoteItemToTop(itemData.id),
            settings,
            autoPasteKey: definition.settings.autoPasteSettingKey,
            menu: extension?._indicator?.menu,
        });
    };

    definition.createInstance = () => createRecentlyUsedDefinitionClipboardHistoryInstance();

    return definition;
}

/**
 * Section definition template for clipboard history items.
 */
export const RecentlyUsedDefinitionClipboardHistory = () => createRecentlyUsedDefinitionClipboardHistoryInstance();
