import { searchViaProvider } from '../../../shared/services/serviceSearchHub.js';

import { RecentlyUsedDefaultPolicy } from '../constants/recentlyUsedPolicyConstants.js';
import { createRecentlyUsedRecentsManager, resolveRecentlyUsedRecentFilePath } from '../integrations/recentlyUsedIntegrationRecents.js';
import { setRecentlyUsedClipboardText, shouldRecentlyUsedAutoPaste, triggerRecentlyUsedAutoPaste } from '../integrations/recentlyUsedIntegrationClipboard.js';

import { ensureSymbolsSearchProviderRegistered } from '../../Symbols/integrations/symbolsSearchProvider.js';
import { SymbolsProvider } from '../../Symbols/constants/symbolsConstants.js';
import { SymbolsViewRenderer } from '../../Symbols/view/symbolsViewRenderer.js';

let _recentManager = null;
const _symbolsSearchRenderer = new SymbolsViewRenderer();

/**
 * Section definition for recently used symbol items.
 */
export const RecentlyUsedDefinitionSymbols = {
    id: 'symbols',
    targetTab: 'Symbols',
    layoutType: 'grid',
    source: {
        maxItems: RecentlyUsedDefaultPolicy.GLOBAL_VISIBLE_ITEMS,
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
        ensureSymbolsSearchProviderRegistered({ extensionUuid });

        if (_recentManager) {
            try {
                _recentManager.destroy();
            } catch {
                // Ignore stale manager teardown errors before re-init.
            }
            _recentManager = null;
        }

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
     * Searches the symbols catalog using the same filter behavior as the Symbols tab.
     *
     * @param {object} params Search context.
     * @param {string} params.query Normalized search query.
     * @returns {Promise<Array<object>>} Matching symbol entries.
     */
    searchItems: async ({ query }) => {
        return searchViaProvider(SymbolsProvider.SEARCH_PROVIDER_ID, { query });
    },

    /**
     * Maps a source item into the shared section payload format.
     *
     * @param {object|string} sourceItem Source entry.
     * @returns {object} Normalized payload.
     */
    mapItem: (sourceItem) => {
        const normalizedItem = sourceItem && typeof sourceItem === 'object' ? { ...sourceItem } : { value: sourceItem };
        const normalizedValue = normalizedItem.value || normalizedItem.char || normalizedItem.symbol || '';
        normalizedItem.value = typeof normalizedValue === 'string' ? normalizedValue : '';
        if (!normalizedItem.char && typeof normalizedItem.symbol === 'string') {
            normalizedItem.char = normalizedItem.symbol;
        }

        return {
            ...normalizedItem,
            __recentlyUsedListPresentation: RecentlyUsedDefinitionSymbols.listPresentation,
            __recentlyUsedGridPresentation: RecentlyUsedDefinitionSymbols.gridPresentation,
            __recentlyUsedClickPayload: sourceItem,
        };
    },

    /**
     * Matches symbol entries using Symbols tab search behavior.
     *
     * @param {object} params Search context.
     * @param {object} params.item Candidate item.
     * @param {string} params.query Normalized search query.
     * @param {Function} params.fallbackMatch Generic fallback matcher.
     * @returns {boolean} True when the symbol matches search.
     */
    matchesSearch: ({ item, query, fallbackMatch }) => {
        if (!query) {
            return true;
        }

        try {
            return _symbolsSearchRenderer.searchFilter(item || {}, query);
        } catch {
            return typeof fallbackMatch === 'function' ? fallbackMatch(item) : false;
        }
    },

    /**
     * Handles clicks by copying symbol content and updating recents.
     *
     * @param {object} params Click context.
     * @returns {Promise<boolean>} True when copy succeeds.
     */
    onClick: async ({ itemData, settings }) => {
        const contentToCopy = itemData?.char || itemData?.value || itemData?.symbol || '';
        if (!contentToCopy) return false;

        setRecentlyUsedClipboardText(contentToCopy);
        _recentManager?.addItem({ ...itemData, value: contentToCopy, char: itemData?.char || itemData?.symbol || contentToCopy });

        if (shouldRecentlyUsedAutoPaste(settings, RecentlyUsedDefinitionSymbols.settings.autoPasteSettingKey)) {
            await triggerRecentlyUsedAutoPaste();
        }

        return true;
    },
};
