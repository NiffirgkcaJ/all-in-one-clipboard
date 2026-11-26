import Clutter from 'gi://Clutter';

import { clipboardSetText } from '../../../shared/utilities/utilityClipboard.js';
import { AutoPaster, getAutoPaster } from '../../../shared/utilities/utilityAutoPaste.js';

import { ClipboardListItemFactory } from '../../Clipboard/view/clipboardListItemFactory.js';
import { ClipboardType } from '../../Clipboard/constants/clipboardPluginConstants.js';

import { RecentlyUsedBaseWidgetFactory } from '../view/recentlyUsedBaseWidgetFactory.js';
import { RecentlyUsedStyles, RecentlyUsedUI } from '../constants/recentlyUsedConstants.js';

// ========================================================================
// Clipboard and Auto-Paste Operations
// ========================================================================

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

// ========================================================================
// Clipboard Item Rendering
// ========================================================================

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
    const clipboardManager = runtimeContext && runtimeContext.extension ? runtimeContext.extension._clipboardManager : null;
    if (!clipboardManager) {
        return false;
    }

    const configuredPreviewSize = imagePreviewSizeSettingKey ? runtimeContext.settings.get_int(imagePreviewSizeSettingKey) : RecentlyUsedUI.NESTED_ITEM_HEIGHT;
    const extensionWidth = runtimeContext.settings?.get_int('extension-width') || 0;
    const cardGeometry = RecentlyUsedBaseWidgetFactory.calculateCardGeometry({ width: extensionWidth, height: null });
    const renderContext = {
        previewWidth: configuredPreviewSize,
        previewHeight: configuredPreviewSize,
        registry: clipboardManager._clipboardRegistry,
        storage: clipboardManager.storage,
        settings: runtimeContext.settings,
        cardGeometry,
        availableWidth: cardGeometry.availableWidth,
        availableHeight: cardGeometry.availableHeight,
    };
    const { contentWidget, config } = ClipboardListItemFactory.createCardContent(itemData, renderContext);

    if (itemData?.type === ClipboardType.IMAGE) {
        button.style_class = styleClass + ' ' + RecentlyUsedStyles.NORMAL_ITEM;
        const resolvedHeight = config.contentHeight || configuredPreviewSize;
        button.set_style(`min-height: ${Math.max(resolvedHeight, RecentlyUsedUI.NESTED_ITEM_HEIGHT)}px;`);
        box.y_expand = true;
        box.y_align = Clutter.ActorAlign.FILL;
    }

    box.add_child(contentWidget);
    return true;
}
