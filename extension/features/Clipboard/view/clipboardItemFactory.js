import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { ClipboardType, ClipboardStyling } from '../constants/clipboardConstants.js';

export class ClipboardItemFactory {
    /**
     * Maps an item's data to a standardized view configuration.
     *
     * @param {Object} item - The raw item data
     * @param {string} imagesDir - Directory where images are stored
     * @param {string} linkPreviewsDir - Directory where link previews are stored
     * @returns {Object} { layoutMode, icon, title, subtitle, text, gicon, cssColor, rawLines }
     */
    static getItemViewConfig(item, imagesDir, linkPreviewsDir) {
        // Get default styling from map
        const style = ClipboardStyling[item.type] || ClipboardStyling[ClipboardType.TEXT];

        const config = {
            layoutMode: style.layout,
            icon: style.icon,
            text: '', // Initialize text to prevent undefined errors
        };

        // Hydrate specific fields based on type
        switch (item.type) {
            case ClipboardType.FILE:
                config.title = item.preview || 'Unknown File';
                config.subtitle = item.file_uri;
                break;
            case ClipboardType.URL:
                config.title = item.title || item.url;
                config.subtitle = item.url;
                if (item.icon_filename && linkPreviewsDir) {
                    const iconPath = GLib.build_filenamev([linkPreviewsDir, item.icon_filename]);
                    config.gicon = new Gio.FileIcon({ file: Gio.File.new_for_path(iconPath) });
                }
                break;
            case ClipboardType.COLOR:
                config.title = item.color_value;
                config.subtitle = item.format_type;
                config.cssColor = item.color_value;
                break;
            case ClipboardType.CODE:
                config.text = item.preview || '';
                config.rawLines = item.raw_lines || 0;
                break;
            case ClipboardType.TEXT:
            default:
                // If item.preview is missing, use item.text or empty string.
                config.text = item.preview || item.text || '';
                break;
        }

        return config;
    }

    /**
     * Create a content widget for a clipboard item based on its configuration.
     *
     * @param {Object} config - The view configuration from getItemViewConfig
     * @param {Object} itemData - The raw item data
     * @param {Object} options - Display options
     * @param {string} options.imagesDir - Directory where images are stored
     * @param {number} options.imagePreviewSize - Size of image preview
     * @returns {St.Widget} The content widget
     */
    static createContentWidget(config, itemData, options) {
        let contentWidget;

        if (config.layoutMode === 'image') {
            // Image Layout
            const imagePath = GLib.build_filenamev([options.imagesDir, itemData.image_filename]);

            // Use wrapper bin for proper sizing
            const imageWrapper = new St.Bin({
                x_expand: true,
                y_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });

            const imageActor = new St.Icon({
                gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(imagePath) }),
                icon_size: options.imagePreviewSize,
            });

            imageWrapper.set_style(`min-height: ${options.imagePreviewSize}px;`);
            imageWrapper.set_child(imageActor);

            contentWidget = imageWrapper;
        } else if (config.layoutMode === 'code') {
            // Code Layout
            contentWidget = new St.BoxLayout({
                vertical: false,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'clipboard-item-code-container',
            });

            // Icon
            const iconParams = { icon_size: 24, style_class: 'clipboard-item-icon' };
            iconParams.icon_name = config.icon;
            contentWidget.add_child(new St.Icon(iconParams));

            // Code Body
            const codeBox = new St.BoxLayout({ vertical: false, x_expand: true });

            // Generate Line Numbers String dynamically
            const lineCount = config.rawLines || 0;
            const lineNumbersString = Array.from({ length: lineCount }, (_unused, i) => (i + 1).toString()).join('\n');

            const numLabel = new St.Label({
                text: lineNumbersString,
                style_class: 'clipboard-item-code-numbers',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            codeBox.add_child(numLabel);

            // Safety check for text
            const safeText = config.text || '';
            const codeLabel = new St.Label({
                text: safeText,
                style_class: 'clipboard-item-code-content',
                x_expand: true,
                x_align: Clutter.ActorAlign.START,
                y_align: Clutter.ActorAlign.CENTER,
            });
            codeLabel.get_clutter_text().set_use_markup(true);
            codeLabel.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);

            codeBox.add_child(codeLabel);
            contentWidget.add_child(codeBox);

            contentWidget.x_expand = true;
        } else if (config.layoutMode === 'rich') {
            // Rich Layout
            contentWidget = new St.BoxLayout({
                vertical: false,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'clipboard-item-rich-container',
            });
            const iconParams = { icon_size: 24, style_class: 'clipboard-item-icon' };
            if (config.gicon) iconParams.gicon = config.gicon;
            else iconParams.icon_name = config.icon;
            contentWidget.add_child(new St.Icon(iconParams));

            if (config.cssColor) {
                const swatchContainer = new St.Bin({
                    style_class: 'clipboard-item-color-container',
                    y_align: Clutter.ActorAlign.CENTER,
                    x_align: Clutter.ActorAlign.CENTER,
                });
                const swatch = new St.Bin({
                    style_class: 'clipboard-item-color-swatch',
                    style: `background-color: ${config.cssColor};`,
                });
                swatchContainer.set_child(swatch);
                contentWidget.add_child(swatchContainer);
            }

            const textCol = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            const titleLabel = new St.Label({
                text: config.title || '',
                style_class: 'clipboard-item-title',
                x_expand: true,
            });
            titleLabel.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
            textCol.add_child(titleLabel);
            const subLabel = new St.Label({
                text: config.subtitle || '',
                style_class: 'clipboard-item-subtitle',
                x_expand: true,
            });
            subLabel.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.MIDDLE);
            textCol.add_child(subLabel);

            contentWidget.add_child(textCol);
            contentWidget.x_expand = true;
        } else {
            // Text Layout
            const safeText = config.text || '';
            contentWidget = new St.Label({
                text: safeText,
                style_class: 'clipboard-item-text-label',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            contentWidget.get_clutter_text().set_line_wrap(false);
            contentWidget.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
        }

        return contentWidget;
    }
}
