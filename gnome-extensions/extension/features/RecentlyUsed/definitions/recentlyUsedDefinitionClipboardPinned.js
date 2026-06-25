import { GlobalActionService } from '../../../shared/services/serviceAction.js';
import { searchViaProvider } from '../../../shared/services/serviceSearchHub.js';

import { RecentlyUsedSectionDefinition } from '../registry/recentlyUsedSectionDefinition.js';
import { RecentlyUsedUI } from '../constants/recentlyUsedConstants.js';
import { renderRecentlyUsedClipboardListContent } from '../integrations/recentlyUsedIntegrationClipboard.js';
import { RecentlyUsedDefaultPolicy, RecentlyUsedLimitMode } from '../constants/recentlyUsedPolicyConstants.js';

import { ClipboardProvider } from '../../Clipboard/constants/clipboardConstants.js';
import { ClipboardSearchUtils } from '../../Clipboard/utilities/clipboardSearchUtils.js';
import { ensureClipboardSearchProviderRegistered } from '../../Clipboard/integrations/clipboardSearchProvider.js';

/**
 * Creates a runtime-scoped clipboard pinned section definition.
 *
 * @returns {object} Clipboard pinned section definition instance.
 */
function createRecentlyUsedDefinitionClipboardPinnedInstance() {
    const definition = new RecentlyUsedSectionDefinition({
        id: 'clipboard-pinned',
        targetTab: 'Clipboard',
        layoutType: 'list',
        defaultPolicy: {
            defaultLimitMode: RecentlyUsedLimitMode.UNLIMITED,
            customLimitByContext: false,
            customDisplayByView: false,
            customVisibleByView: false,
            customWindowByView: false,
        },
        source: {
            maxItems: RecentlyUsedDefaultPolicy.GLOBAL_VISIBLE_ITEMS,
        },
        layoutTransition: {
            threshold: 5,
            above: 'nested-list',
        },
        layoutPolicy: {
            maxVisible: RecentlyUsedDefaultPolicy.LIST_VISIBLE_ITEMS,
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
    });

    /**
     * Initializes the clipboard pinned section.
     */
    definition.initialize = () => {
        ensureClipboardSearchProviderRegistered();
    };

    /**
     * Cleans up clipboard pinned section resources.
     */
    definition.destroy = () => {};

    /**
     * Returns signals that should trigger section re-rendering.
     *
     * @param {object} params Context object.
     * @param {object} params.extension Extension instance.
     * @param {Function} params.onRender Re-render callback.
     * @returns {Array<object>} Signal descriptors.
     */
    definition.getSignals = ({ extension, onRender }) => {
        const clipboardManager = extension?._clipboardManager;
        if (!clipboardManager) return [];
        return [{ obj: clipboardManager, id: clipboardManager.connect('pinned-changed', onRender) }];
    };

    /**
     * Indicates whether the clipboard pinned section is enabled.
     *
     * @returns {boolean} Always true for clipboard pinned items.
     */
    definition.isEnabled = () => true;

    /**
     * Returns clipboard pinned items.
     *
     * @param {object} params Context object.
     * @param {object} params.extension Extension instance.
     * @returns {Array<object>} Clipboard pinned items.
     */
    definition.getItems = ({ extension }) => {
        const clipboardManager = extension?._clipboardManager;
        return clipboardManager?.getPinnedItems?.() || [];
    };

    /**
     * Searches clipboard pinned items through the shared Search Hub provider.
     *
     * @param {object} params Search context.
     * @param {string} params.query Normalized search query.
     * @param {object} params.runtimeContext Runtime context.
     * @returns {Promise<Array<object>>} Matching clipboard pinned items.
     */
    definition.searchItems = async ({ query, runtimeContext }) => {
        if (!query) {
            return [];
        }

        const extension = runtimeContext?.extension;
        const pinnedIds = new Set((extension?._clipboardManager?.getPinnedItems?.() || []).map((item) => item?.id));
        const providerItems = await searchViaProvider(ClipboardProvider.SEARCH_PROVIDER_ID, {
            query,
            context: { extension },
        });

        return providerItems.filter((item) => pinnedIds.has(item?.id));
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
     * Matches clipboard pinned items using Clipboard tab search behavior.
     *
     * @param {object} params Search context.
     * @param {object} params.item Candidate item.
     * @param {string} params.query Normalized search query.
     * @param {Function} params.fallbackMatch Generic fallback matcher.
     * @returns {boolean} True when the clipboard pinned item matches search.
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
     * Handles clicks by copying and promoting clipboard pinned items.
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

    definition.createInstance = () => createRecentlyUsedDefinitionClipboardPinnedInstance();

    return definition;
}

/**
 * Section definition template for clipboard pinned items.
 */
export const RecentlyUsedDefinitionClipboardPinned = () => createRecentlyUsedDefinitionClipboardPinnedInstance();
