import Clutter from 'gi://Clutter';
import St from 'gi://St';

import { getGifCacheManager } from '../../GIF/logic/gifCacheManager.js';
import { RecentlyUsedViewRenderer } from '../view/recentlyUsedViewRenderer.js';
import { RecentlyUsedSettings, RecentlyUsedUI } from '../constants/recentlyUsedConstants.js';

/**
 * Render a list-style section (kaomoji or clipboard).
 *
 * @param {object} params
 * @param {string} params.id Section identifier
 * @param {object} params.sections Section map
 * @param {object} params.settings Extension settings
 * @param {object} params.recentManagers Feature-id keyed managers
 * @param {object} params.clipboardManager Clipboard manager
 * @param {Array<Array<object>>} params.focusGrid Focus matrix
 * @param {Function} params.createFullWidthClipboardItem Widget builder callback
 */
export function renderListSection({ id, sections, settings, recentManagers, clipboardManager, focusGrid, createFullWidthClipboardItem }) {
    const sectionData = sections[id];
    const settingKeyMap = {
        kaomoji: RecentlyUsedSettings.ENABLE_KAOMOJI_TAB,
        clipboard: RecentlyUsedSettings.ENABLE_CLIPBOARD_TAB,
    };

    const settingKey = settingKeyMap[id];
    if (settingKey && !settings.get_boolean(settingKey)) {
        sectionData.section.hide();
        return;
    }

    if (id === 'kaomoji' && !recentManagers.kaomoji) {
        sectionData.section.hide();
        return;
    }

    const items = id === 'kaomoji' ? recentManagers.kaomoji.getRecents().slice(0, 5) : clipboardManager.getHistoryItems().slice(0, 5);

    if (items.length === 0) {
        sectionData.section.hide();
        return;
    }

    sectionData.section.show();
    focusGrid.push([sectionData.showAllBtn]);

    const container = new St.BoxLayout({ vertical: true, x_expand: true });

    items.forEach((item) => {
        const itemData = id === 'kaomoji' ? { type: 'kaomoji', preview: item.value, rawItem: item } : item;
        const widget = createFullWidthClipboardItem(itemData, false, id);
        container.add_child(widget);
        focusGrid.push([widget]);
    });

    sectionData.bodyContainer.set_child(container);
}

/**
 * Render a grid-style section (emoji, GIF, or symbols).
 *
 * @param {object} params
 * @param {string} params.id Section identifier
 * @param {object} params.sections Section map
 * @param {object} params.settings Extension settings
 * @param {object} params.recentManagers Feature-id keyed managers
 * @param {Array<Array<object>>} params.focusGrid Focus matrix
 * @param {Function} params.createGridItem Widget builder callback
 * @param {object} params.renderSession Render session token
 * @param {object} params.gifDownloadService GIF download service
 * @param {string} params.gifCacheDir GIF cache directory path
 * @param {Function} params.currentRenderSession Returns current render session token
 */
export function renderGridSection({ id, sections, settings, recentManagers, focusGrid, createGridItem, renderSession, gifDownloadService, gifCacheDir, currentRenderSession }) {
    const sectionData = sections[id];
    const manager = recentManagers[id];
    const settingKeyMap = {
        emoji: RecentlyUsedSettings.ENABLE_EMOJI_TAB,
        gif: RecentlyUsedSettings.ENABLE_GIF_TAB,
        symbols: RecentlyUsedSettings.ENABLE_SYMBOLS_TAB,
    };

    const settingKey = settingKeyMap[id];
    if (settingKey && !settings.get_boolean(settingKey)) {
        sectionData.section.hide();
        return;
    }

    if (!manager) {
        sectionData.section.hide();
        return;
    }

    const items = manager.getRecents().slice(0, 5);

    if (items.length === 0) {
        sectionData.section.hide();
        return;
    }

    sectionData.section.show();
    focusGrid.push([sectionData.showAllBtn]);

    const grid = new St.Widget({
        layout_manager: new Clutter.GridLayout({
            column_homogeneous: true,
            column_spacing: RecentlyUsedUI.GRID_COLUMN_SPACING,
        }),
        x_expand: true,
    });

    const layout = grid.get_layout_manager();
    const sectionFocusables = [];

    items.forEach((item, index) => {
        const widget = createGridItem(item, id);
        layout.attach(widget, index, 0, 1, 1);
        sectionFocusables.push(widget);

        if (id === 'gif' && item.preview_url) {
            const context = {
                gifDownloadService,
                gifCacheDir,
                currentRenderSession,
                getGifCacheManager,
            };

            RecentlyUsedViewRenderer.updateGifButtonWithPreview(widget, item.preview_url, renderSession, context).catch((e) => {
                if (!e?.message?.startsWith('Recently Used Tab')) {
                    const message = e?.message ?? String(e);
                    console.warn(`[AIO-Clipboard] Failed to load GIF preview: ${message}`);
                }
            });
        }
    });

    focusGrid.push(sectionFocusables);
    sectionData.bodyContainer.set_child(grid);
}
