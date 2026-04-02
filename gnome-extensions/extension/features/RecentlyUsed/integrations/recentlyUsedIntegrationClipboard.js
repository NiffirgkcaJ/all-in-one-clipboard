import Clutter from 'gi://Clutter';

import { clipboardSetText } from '../../../shared/utilities/utilityClipboard.js';
import { AutoPaster, getAutoPaster } from '../../../shared/utilities/utilityAutoPaste.js';

import { ClipboardListItemFactory } from '../../Clipboard/view/clipboardListItemFactory.js';
import { ClipboardType } from '../../Clipboard/constants/clipboardConstants.js';

import { RecentlyUsedStyles, RecentlyUsedUI } from '../constants/recentlyUsedConstants.js';

/**
 * Writes text content to the system clipboard.
 *
 * @param {string} content Clipboard text.
 */
export function setRecentlyUsedClipboardText(content) {
    clipboardSetText(content);
}

/**
 * Checks whether auto-paste is enabled for a setting key.
 *
 * @param {Gio.Settings} settings Settings object.
 * @param {string} autoPasteKey Auto-paste setting key.
 * @returns {boolean} True when auto-paste is enabled.
 */
export function shouldRecentlyUsedAutoPaste(settings, autoPasteKey) {
    return AutoPaster.shouldAutoPaste(settings, autoPasteKey);
}

/**
 * Triggers auto-paste behavior.
 *
 * @returns {Promise<void>} Resolves when auto-paste finishes.
 */
export async function triggerRecentlyUsedAutoPaste() {
    await getAutoPaster().trigger();
}

/**
 * Renders rich clipboard list content when clipboard services are available.
 *
 * @param {object} params Render parameters.
 * @param {Clutter.Actor} params.button Item button.
 * @param {St.BoxLayout} params.box Item content container.
 * @param {object} params.itemData Clipboard item payload.
 * @param {string} params.styleClass Base style class.
 * @param {object} params.runtimeContext Extension runtime context.
 * @param {string} params.imagePreviewSizeSettingKey Preview size setting key.
 * @returns {boolean} True when custom rendering succeeds.
 */
export function renderRecentlyUsedClipboardListContent({ button, box, itemData, styleClass, runtimeContext, imagePreviewSizeSettingKey }) {
    const clipboardManager = runtimeContext?.extension?._clipboardManager;
    if (!clipboardManager) {
        return false;
    }

    const imagePreviewSize = imagePreviewSizeSettingKey ? runtimeContext?.settings?.get_int?.(imagePreviewSizeSettingKey) : RecentlyUsedUI.NESTED_ITEM_HEIGHT;
    const config = ClipboardListItemFactory.getItemViewConfig(itemData, clipboardManager._imagesDir, clipboardManager._linkPreviewsDir);
    const contentWidget = ClipboardListItemFactory.createListContent(config, itemData, {
        imagesDir: clipboardManager._imagesDir,
        imagePreviewsDir: clipboardManager._imagePreviewsDir,
        imagePreviewSize,
    });

    if (itemData?.type === ClipboardType.IMAGE) {
        button.style_class = styleClass + ' ' + RecentlyUsedStyles.NORMAL_ITEM;
        button.set_style(`min-height: ${Math.max(Number(imagePreviewSize) || RecentlyUsedUI.NESTED_ITEM_HEIGHT)}px;`);
        box.y_expand = true;
        box.y_align = Clutter.ActorAlign.FILL;
    }

    box.add_child(contentWidget);
    return true;
}
