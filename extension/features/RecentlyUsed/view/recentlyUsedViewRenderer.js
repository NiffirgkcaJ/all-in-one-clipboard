import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import Soup from 'gi://Soup';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { ClipboardItemFactory } from '../../Clipboard/view/clipboardItemFactory.js';
import { ClipboardType } from '../../Clipboard/constants/clipboardConstants.js';
import { createStaticIcon } from '../../../shared/utilities/utilityIcon.js';
import { RecentlyUsedStyles, RecentlyUsedIcons, RecentlyUsedMessages } from '../constants/recentlyUsedConstants.js';

// ============================================================================
// Widget Creation Functions
// ============================================================================

/**
 * Create a full-width list item button for clipboard/kaomoji content
 *
 * @param {object} itemData - Item data containing type, preview, etc.
 * @param {boolean} isPinned - Whether item is pinned, which affects click behavior
 * @param {string} feature - Feature type like 'clipboard', 'kaomoji', etc.
 * @param {object} context - Context object containing necessary dependencies
 * @param {object} context.clipboardManager - Clipboard manager instance
 * @param {number} context.imagePreviewSize - Image preview size setting
 * @returns {St.Button} The created button widget
 */
export function createFullWidthListItem(itemData, isPinned, feature, context) {
    const isKaomoji = itemData.type === 'kaomoji';
    const isClipboardItem = feature === 'clipboard';

    let styleClass = RecentlyUsedStyles.LIST_ITEM;

    if (isKaomoji) {
        styleClass += ' ' + RecentlyUsedStyles.BOLD_ITEM;
    } else if (isClipboardItem && itemData.type === ClipboardType.IMAGE) {
        styleClass += ' ' + RecentlyUsedStyles.NORMAL_ITEM;
    }

    const button = new St.Button({
        style_class: styleClass,
        can_focus: true,
        x_expand: true,
    });

    const box = new St.BoxLayout({
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        x_align: isKaomoji || itemData.type === ClipboardType.IMAGE ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.FILL,
    });
    box.spacing = 8;
    button.set_child(box);

    if (isKaomoji) {
        box.add_child(
            new St.Label({
                text: itemData.preview || '',
                y_align: Clutter.ActorAlign.CENTER,
                x_align: Clutter.ActorAlign.CENTER,
            }),
        );
    } else if (isClipboardItem) {
        const config = ClipboardItemFactory.getItemViewConfig(itemData, context.clipboardManager._imagesDir, context.clipboardManager._linkPreviewsDir);
        const contentWidget = ClipboardItemFactory.createContentWidget(config, itemData, {
            imagesDir: context.clipboardManager._imagesDir,
            imagePreviewSize: context.imagePreviewSize,
        });

        if (itemData.type === ClipboardType.IMAGE) {
            const minHeight = Math.max(context.imagePreviewSize);
            button.set_style(`min-height: ${minHeight}px;`);
            box.y_expand = true;
            box.y_align = Clutter.ActorAlign.FILL;
        }

        box.add_child(contentWidget);
    } else {
        const label = new St.Label({
            text: itemData.preview || '',
            x_expand: true,
        });
        label.get_clutter_text().set_line_wrap(false);
        label.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
        box.add_child(label);
    }

    return button;
}

/**
 * Create a grid item button for emoji/GIF/symbol content
 *
 * @param {object} itemData - Item data
 * @param {string} feature - Feature type ('emoji', 'gif', 'symbols')
 * @returns {St.Button} The created button widget
 */
export function createGridItem(itemData, feature) {
    const button = new St.Button({
        style_class: RecentlyUsedStyles.GRID_ITEM,
        can_focus: true,
    });

    if (feature === 'gif') {
        // Placeholder icon gets replaced with actual GIF after async load
        const icon = createStaticIcon(RecentlyUsedIcons.GIF_PLACEHOLDER, { styleClass: RecentlyUsedStyles.GIF_ICON });
        button.set_child(icon);
        button.tooltip_text = String(itemData.description || RecentlyUsedMessages.GIF_TOOLTIP_FALLBACK());
    } else {
        const labelText = String(itemData.char || itemData.value || '');
        button.label = labelText;
        button.tooltip_text = String(itemData.name || labelText);
    }

    return button;
}

/**
 * Create a section header with title and "Show All" button
 *
 * @param {string} title - Display title for the section
 * @returns {object} Object containing header box and showAllBtn reference
 */
export function createSectionHeader(title) {
    const header = new St.BoxLayout({
        style_class: RecentlyUsedStyles.HEADER,
        x_expand: true,
    });

    const showAllBtn = new St.Button({
        label: RecentlyUsedMessages.SHOW_ALL(),
        style_class: RecentlyUsedStyles.SHOW_ALL_BUTTON,
        can_focus: true,
    });

    header.add_child(
        new St.Label({
            text: title,
            style_class: RecentlyUsedStyles.TITLE,
            x_expand: true,
        }),
    );
    header.add_child(showAllBtn);

    return { header, showAllBtn };
}

/**
 * Create the empty state view
 *
 * @returns {St.Bin} The empty view widget
 */
export function createEmptyView() {
    const emptyView = new St.Bin({
        x_expand: true,
        y_expand: true,
        visible: false,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    emptyView.set_child(new St.Label({ text: RecentlyUsedMessages.EMPTY_STATE() }));
    return emptyView;
}

/**
 * Create the floating settings button
 *
 * @returns {St.Button} The settings button widget
 */
export function createSettingsButton() {
    const icon = createStaticIcon(RecentlyUsedIcons.SETTINGS);

    const settingsBtn = new St.Button({
        style_class: RecentlyUsedStyles.SETTINGS_BUTTON,
        child: icon,
        can_focus: false,
        reactive: true,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.END,
    });
    return settingsBtn;
}

/**
 * Create a section separator widget
 *
 * @returns {St.Widget} The separator widget
 */
export function createSectionSeparator() {
    return new St.Widget({
        style_class: RecentlyUsedStyles.SEPARATOR,
        visible: false,
    });
}

/**
 * Update a GIF button with its preview image asynchronously
 * This function handles fetching, caching, and displaying GIF previews
 *
 * @param {St.Button} button - Button to update with GIF icon
 * @param {string} url - URL of the GIF preview image
 * @param {object} renderSession - The session token for this render pass
 * @param {object} context - Context object containing necessary dependencies
 * @param {Soup.Session} context.httpSession - HTTP session for fetching
 * @param {string} context.gifCacheDir - Directory for caching GIFs
 * @param {boolean} context.isDestroyed - Flag to check if parent is destroyed
 * @param {Function} context.getGifCacheManager - Function to get GIF cache manager
 * @returns {Promise<void>}
 */
export async function updateGifButtonWithPreview(button, url, renderSession, context) {
    if (!url) return;

    try {
        const hash = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, url, -1);
        const filename = `${hash}.gif`;
        const file = Gio.File.new_for_path(GLib.build_filenamev([context.gifCacheDir, filename]));

        if (!file.query_exists(null)) {
            const bytes = await fetchImageBytes(url, context.httpSession, context.isDestroyed);
            await saveBytesToFile(file, bytes);
            context.getGifCacheManager().triggerDebouncedCleanup();
        }

        if (context.isDestroyed() || renderSession !== context.currentRenderSession()) {
            return;
        }

        const icon = button.get_child();
        if (icon instanceof St.Icon) {
            icon.set_gicon(new Gio.FileIcon({ file }));
        }
    } catch (e) {
        if (!e.message.startsWith('Recently Used Tab')) {
            console.warn(`[AIO-Clipboard] Failed to load recent GIF preview: ${e.message}`);
        }
    }
}

// ============================================================================
// Private Helper Functions
// ============================================================================

/**
 * Fetch image bytes from a URL
 *
 * @param {string} url - The image URL
 * @param {Soup.Session} httpSession - HTTP session for request
 * @param {Function} isDestroyed - Function to check if parent is destroyed
 * @returns {Promise<GLib.Bytes>} The image bytes
 * @private
 */
async function fetchImageBytes(url, httpSession, isDestroyed) {
    const message = new Soup.Message({
        method: 'GET',
        uri: GLib.Uri.parse(url, GLib.UriFlags.NONE),
    });

    return new Promise((resolve, reject) => {
        httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, res) => {
            if (isDestroyed()) {
                reject(new Error('Recently Used Tab was destroyed.'));
                return;
            }
            if (message.get_status() >= 300) {
                reject(new Error(`HTTP Error ${message.get_status()}`));
                return;
            }
            try {
                resolve(session.send_and_read_finish(res));
            } catch (e) {
                reject(e);
            }
        });
    });
}

/**
 * Saves a GLib.Bytes object to a file
 *
 * @param {Gio.File} file - Target file
 * @param {GLib.Bytes} bytes - Bytes to save
 * @returns {Promise<void>}
 * @private
 */
async function saveBytesToFile(file, bytes) {
    return new Promise((resolve, reject) => {
        file.replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.NONE, null, (source, res) => {
            try {
                source.replace_contents_finish(res);
                resolve();
            } catch (e) {
                reject(e);
            }
        });
    });
}

// ============================================================================
// Exports
// ============================================================================

export const RecentlyUsedViewRenderer = {
    createFullWidthListItem,
    createGridItem,
    createSectionHeader,
    createEmptyView,
    createSettingsButton,
    createSectionSeparator,
    updateGifButtonWithPreview,
};
