import Gio from 'gi://Gio';
import St from 'gi://St';

import { searchViaProvider } from '../../../shared/services/serviceSearchHub.js';

import { matchesRecentlyUsedSearch } from '../utilities/recentlyUsedSearch.js';
import { RecentlyUsedDefaultPolicy } from '../constants/recentlyUsedPolicyConstants.js';
import { createRecentlyUsedRecentsManager, resolveRecentlyUsedRecentFilePath } from '../integrations/recentlyUsedIntegrationRecents.js';
import { shouldRecentlyUsedAutoPaste, triggerRecentlyUsedAutoPaste } from '../integrations/recentlyUsedIntegrationClipboard.js';
import { getRecentlyUsedGifRuntime, destroyRecentlyUsedGifRuntime, copyRecentlyUsedGifToClipboard } from '../integrations/recentlyUsedIntegrationGif.js';

import { ensureGifSearchProviderRegistered } from '../../GIF/integrations/gifSearchProvider.js';
import { GifProvider } from '../../GIF/constants/gifConstants.js';

const GIF_PLACEHOLDER = {
    icon: 'gif-missing-symbolic.svg',
    iconSize: 64,
};

let _recentManager = null;

/**
 * Section definition for recently used GIF items.
 */
export const RecentlyUsedDefinitionGif = {
    id: 'gif',
    targetTab: 'GIF',
    layoutType: 'grid',
    source: {
        maxItems: RecentlyUsedDefaultPolicy.GLOBAL_VISIBLE_ITEMS,
    },
    settings: {
        enabledSettingKey: 'enable-gif-tab',
        autoPasteSettingKey: 'auto-paste-gif',
    },
    gridPresentation: {
        contentMode: 'icon',
        tooltipMode: 'description-or-fallback',
        icon: {
            kind: 'gif-placeholder',
        },
    },
    listPresentation: null,

    /**
     * Initializes GIF recents and runtime services.
     *
     * @param {object} params Initialization context.
     * @param {string} params.extensionUuid Extension UUID.
     * @param {object} params.settings Extension settings object.
     */
    initialize: ({ extensionUuid, extensionPath, settings }) => {
        if (_recentManager) {
            try {
                _recentManager.destroy();
            } catch {
                // Ignore stale manager teardown errors before re-init.
            }
            _recentManager = null;
        }

        const absolutePath = resolveRecentlyUsedRecentFilePath('RECENT_GIFS');
        _recentManager = createRecentlyUsedRecentsManager(extensionUuid, settings, absolutePath, 'gif-recents-max-items');
        getRecentlyUsedGifRuntime(); // Start HTTP session if needed
        ensureGifSearchProviderRegistered({ settings, extensionUuid, extensionPath });
    },

    /**
     * Cleans up GIF recents and runtime services.
     */
    destroy: () => {
        _recentManager?.destroy();
        _recentManager = null;

        destroyRecentlyUsedGifRuntime();
    },

    /**
     * Returns signals that trigger GIF section updates.
     *
     * @param {object} params Context object.
     * @param {Function} params.onRender Re-render callback.
     * @returns {Array<object>} Signal descriptors.
     */
    getSignals: ({ settings, onRender }) => {
        const signals = [];

        if (_recentManager) {
            signals.push({ obj: _recentManager, id: _recentManager.connect('recents-changed', onRender) });
        }

        if (settings && typeof settings.connect === 'function') {
            signals.push({ obj: settings, id: settings.connect('changed::gif-provider', onRender) });
        }

        return signals;
    },

    /**
     * Indicates whether the GIF section is enabled.
     *
     * @param {object} params Context object.
     * @param {object} params.settings Extension settings object.
     * @returns {boolean} True when enabled.
     */
    isEnabled: ({ settings }) => {
        return settings?.get_boolean(RecentlyUsedDefinitionGif.settings.enabledSettingKey) ?? true;
    },

    /**
     * Returns GIF recents.
     *
     * @returns {Array<object>} GIF items.
     */
    getItems: () => {
        return _recentManager?.getRecents?.() || [];
    },

    /**
     * Executes provider-level GIF search when a query is present.
     *
     * @param {object} params Search context.
     * @param {string} params.query Normalized search query.
     * @returns {Promise<Array<object>>} Provider search results.
     */
    searchItems: async ({ query }) => {
        return searchViaProvider(GifProvider.SEARCH_PROVIDER_ID, { query });
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
            normalizedItem.value = normalizedItem.full_url || '';
        }

        return {
            ...normalizedItem,
            __recentlyUsedListPresentation: RecentlyUsedDefinitionGif.listPresentation,
            __recentlyUsedGridPresentation: RecentlyUsedDefinitionGif.gridPresentation,
            __recentlyUsedClickPayload: sourceItem,
        };
    },

    /**
     * Matches GIF entries against global search query with GIF-specific priorities.
     *
     * @param {object} params Search context.
     * @param {object} params.item Candidate item.
     * @param {string} params.query Normalized search query.
     * @param {Function} params.fallbackMatch Generic fallback matcher.
     * @returns {boolean} True when the GIF matches search.
     */
    matchesSearch: ({ item, query, fallbackMatch }) => {
        if (!query) {
            return true;
        }

        try {
            return matchesRecentlyUsedSearch({
                item,
                query,
                preferredKeys: ['search_query', 'description', 'title', 'name', 'provider', 'id', 'value', 'full_url', 'preview_url'],
                extraValues: [item?.search_query, item?.provider],
            });
        } catch {
            return typeof fallbackMatch === 'function' ? fallbackMatch(item) : false;
        }
    },

    /**
     * Resolves a grid icon definition for the given icon kind.
     *
     * @param {string} iconKind Requested icon kind.
     * @returns {object|null} Icon definition or null.
     */
    resolveGridIcon: (iconKind) => {
        if (iconKind === 'gif-placeholder') {
            return GIF_PLACEHOLDER;
        }

        return null;
    },

    /**
     * Loads a cached preview icon for a grid item.
     *
     * @param {object} params Grid item creation context.
     */
    onGridItemCreated: ({ widget, item, renderSession, currentRenderSession }) => {
        const previewUrl = item?.preview_url;
        if (!previewUrl) return;

        const runtime = getRecentlyUsedGifRuntime();
        const context = {
            gifDownloadService: runtime.gifDownloadService,
            gifCacheDir: runtime.gifCacheDir,
            getGifCacheManager: runtime.getGifCacheManager,
            currentRenderSession,
        };

        const updatePreview = async () => {
            try {
                const filePath = await context.gifDownloadService.downloadPreviewCached(previewUrl, context.gifCacheDir);
                context.getGifCacheManager().triggerDebouncedCleanup();

                if (typeof context.currentRenderSession === 'function' && renderSession !== context.currentRenderSession()) {
                    return;
                }

                const file = Gio.File.new_for_path(filePath);
                const icon = widget.get_child();
                if (icon instanceof St.Icon) {
                    icon.set_gicon(new Gio.FileIcon({ file }));
                }
            } catch (e) {
                const message = e?.message ?? String(e);
                if (!message.startsWith('Recently Used Tab')) {
                    console.warn(`[AIO-Clipboard] Failed to load recent GIF preview: ${message}`);
                }
            }
        };

        updatePreview();
    },

    /**
     * Handles clicks by copying GIF content and updating recents.
     *
     * @param {object} params Click context.
     * @returns {Promise<boolean>} True when copy succeeds.
     */
    onClick: async ({ itemData, extension, settings }) => {
        const copySuccess = await copyRecentlyUsedGifToClipboard(itemData, settings, extension);
        if (!copySuccess) return false;

        _recentManager?.addItem(itemData);

        if (shouldRecentlyUsedAutoPaste(settings, RecentlyUsedDefinitionGif.settings.autoPasteSettingKey)) {
            await triggerRecentlyUsedAutoPaste();
        }

        return true;
    },
};
