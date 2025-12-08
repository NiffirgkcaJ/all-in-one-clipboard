import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { createStaticIcon } from '../../../shared/utilities/utilityIcon.js';
import { ResourcePaths } from '../../../shared/constants/storagePaths.js';
import { ClipboardType, ClipboardStyling, ClipboardIcons, IconSizes } from '../constants/clipboardConstants.js';

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
                ClipboardItemFactory._configureFileItem(config, item);
                break;
            case ClipboardType.URL:
                ClipboardItemFactory._configureUrlItem(config, item, linkPreviewsDir);
                break;
            case ClipboardType.CONTACT:
                ClipboardItemFactory._configureContactItem(config, item, style, linkPreviewsDir);
                break;
            case ClipboardType.COLOR:
                ClipboardItemFactory._configureColorItem(config, item, style);
                break;
            case ClipboardType.CODE:
                ClipboardItemFactory._configureCodeItem(config, item);
                break;
            case ClipboardType.TEXT:
            default:
                ClipboardItemFactory._configureTextItem(config, item);
                break;
        }

        // Handle corrupted state
        if (item.is_corrupted) {
            // Override icon to show warning with color
            config.icon = ClipboardIcons.ERROR_WARNING.icon;
            config.iconOptions = ClipboardIcons.ERROR_WARNING.iconOptions;

            // For image items without source, show in rich layout with warning
            if (config.layoutMode === 'image') {
                config.layoutMode = 'rich';
                config.title = 'Image (Data Lost)';
            }
            // For code items, keep code layout but update title info
            else if (config.layoutMode === 'code') {
                // Keep code layout, just add warning in config
                config.title = 'Code (Full Content Lost)';
            }
            // For text items, switch to rich for visibility
            else if (config.layoutMode === 'text') {
                config.layoutMode = 'rich';
                config.title = config.text ? config.text.substring(0, 50) + '...' : 'Text (Full Content Lost)';
            }

            config.subtitle = 'Cannot be recovered';
        }

        return config;
    }

    /**
     * Configure File item view
     * @private
     */
    static _configureFileItem(config, item) {
        config.title = item.preview || 'Unknown File';
        config.subtitle = item.file_uri;
    }

    /**
     * Configure URL item view
     * @private
     */
    static _configureUrlItem(config, item, linkPreviewsDir) {
        config.title = item.title || item.url;
        config.subtitle = item.url;
        if (item.icon_filename && linkPreviewsDir) {
            const iconPath = GLib.build_filenamev([linkPreviewsDir, item.icon_filename]);
            config.gicon = new Gio.FileIcon({ file: Gio.File.new_for_path(iconPath) });
        }
    }

    /**
     * Configure Contact item view
     * @private
     */
    static _configureContactItem(config, item, style, linkPreviewsDir) {
        config.title = item.preview || item.text || 'Unknown Contact';
        config.subtitle = item.subtype === 'email' ? 'Email' : 'Phone';
        if (style.subtypes && style.subtypes[item.subtype]) {
            config.icon = style.subtypes[item.subtype].icon;
        }

        if (item.subtype === 'email' && item.icon_filename && linkPreviewsDir) {
            const iconPath = GLib.build_filenamev([linkPreviewsDir, item.icon_filename]);
            config.gicon = new Gio.FileIcon({ file: Gio.File.new_for_path(iconPath) });
        }

        if (item.subtype === 'phone' && item.metadata && item.metadata.code) {
            const countryCode = item.metadata.code.toLowerCase();
            config.flagPath = `${ResourcePaths.ASSETS.FLAGS}/${countryCode}.svg`;
        }
    }

    /**
     * Configure Color item view
     * @private
     */
    static _configureColorItem(config, item, style) {
        config.title = item.color_value;
        config.subtitle = item.format_type;
        config.cssColor = item.color_value;
        if (style.subtypes && style.subtypes[item.subtype]) {
            config.icon = style.subtypes[item.subtype].icon;
        }
    }

    /**
     * Configure Code item view
     * @private
     */
    static _configureCodeItem(config, item) {
        config.text = item.preview || '';
        config.rawLines = item.raw_lines || 0;
    }

    /**
     * Configure Text item view
     * @private
     */
    static _configureTextItem(config, item) {
        // If item.preview is missing, use item.text or empty string.
        config.text = item.preview || item.text || '';
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
            const icon = createStaticIcon(config, { styleClass: 'clipboard-item-icon' });
            contentWidget.add_child(icon);

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

            // Create icon
            let icon;
            if (config.gicon) {
                icon = new St.Icon({
                    icon_size: IconSizes.RICH_LAYOUT,
                    style_class: 'clipboard-item-icon',
                    gicon: config.gicon,
                });
            } else if (config.flagPath) {
                // Use SVG flag from GResource
                const file = Gio.File.new_for_uri(config.flagPath);
                icon = new St.Icon({
                    icon_size: IconSizes.RICH_LAYOUT,
                    style_class: 'clipboard-item-icon',
                    gicon: new Gio.FileIcon({ file: file }),
                });
            } else {
                icon = createStaticIcon(config, { styleClass: 'clipboard-item-icon' });
            }
            contentWidget.add_child(icon);

            // Color swatch for single colors or gradient images
            if (config.cssColor || itemData.gradient_filename) {
                const swatchContainer = new St.Bin({
                    style_class: 'clipboard-item-color-container',
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                });

                let swatch;
                if (itemData.gradient_filename && options.imagesDir) {
                    // Load gradient image
                    const gradientPath = GLib.build_filenamev([options.imagesDir, itemData.gradient_filename]);

                    // Use St.Bin with background-image to preserve 48x24 aspect ratio
                    swatch = new St.Bin({
                        style_class: 'clipboard-item-color-swatch',
                        style: `background-image: url('file://${gradientPath}'); background-size: cover;`,
                    });
                } else {
                    // CSS solid color
                    swatch = new St.Bin({
                        style_class: 'clipboard-item-color-swatch',
                        style: `background-color: ${config.cssColor};`,
                    });
                }

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
            titleLabel.get_clutter_text().set_line_wrap(false);
            titleLabel.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
            textCol.add_child(titleLabel);
            const subLabel = new St.Label({
                text: config.subtitle || '',
                style_class: 'clipboard-item-subtitle',
                x_expand: true,
            });
            subLabel.get_clutter_text().set_line_wrap(false);
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
