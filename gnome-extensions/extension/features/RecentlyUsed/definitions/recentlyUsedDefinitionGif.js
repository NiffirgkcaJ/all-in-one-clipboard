import Gio from 'gi://Gio';
import St from 'gi://St';

import { RecentlyUsedUI } from '../constants/recentlyUsedConstants.js';
import { createRecentlyUsedRecentsManager, resolveRecentlyUsedRecentFilePath } from '../integrations/recentlyUsedIntegrationRecents.js';
import { shouldRecentlyUsedAutoPaste, triggerRecentlyUsedAutoPaste } from '../integrations/recentlyUsedIntegrationClipboard.js';
import { getRecentlyUsedGifRuntime, destroyRecentlyUsedGifRuntime, copyRecentlyUsedGifToClipboard } from '../integrations/recentlyUsedIntegrationGif.js';

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
        maxItems: RecentlyUsedUI.MAX_SECTION_DISPLAY_COUNT,
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
    initialize: ({ extensionUuid, settings }) => {
        const absolutePath = resolveRecentlyUsedRecentFilePath('RECENT_GIFS');
        _recentManager = createRecentlyUsedRecentsManager(extensionUuid, settings, absolutePath, 'gif-recents-max-items');
        getRecentlyUsedGifRuntime(); // Start HTTP session if needed
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
    getSignals: ({ onRender }) => {
        if (!_recentManager) return [];
        return [{ obj: _recentManager, id: _recentManager.connect('recents-changed', onRender) }];
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
     * Maps a source item into the shared section payload format.
     *
     * @param {object|string} sourceItem Source entry.
     * @returns {object} Normalized payload.
     */
    mapItem: (sourceItem) => {
        return {
            ...(sourceItem && typeof sourceItem === 'object' ? sourceItem : { value: sourceItem }),
            __recentlyUsedListPresentation: RecentlyUsedDefinitionGif.listPresentation,
            __recentlyUsedGridPresentation: RecentlyUsedDefinitionGif.gridPresentation,
            __recentlyUsedClickPayload: sourceItem,
        };
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
