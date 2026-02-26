import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { ResourcePath } from '../../../shared/constants/storagePaths.js';

import { ClipboardType, ClipboardStyling, ClipboardIcons } from '../constants/clipboardConstants.js';

/**
 * Shared configuration utilities for clipboard items.
 * Maps raw item data to view configurations used by both list and grid factories.
 */
export class ClipboardBaseItemConfig {
    /**
     * Maps an item's data to a standardized view configuration.
     * @param {Object} item The raw item data
     * @param {string} imagesDir Directory where images are stored
     * @param {string} linkPreviewsDir Directory where link previews are stored
     * @returns {Object} Configuration object
     */
    static getItemViewConfig(item, imagesDir, linkPreviewsDir) {
        const style = ClipboardStyling[item.type] || ClipboardStyling[ClipboardType.TEXT];

        const config = {
            layoutMode: style.layout,
            icon: style.icon,
            text: '', // Initialize text to prevent undefined errors
        };

        switch (item.type) {
            case ClipboardType.FILE:
                ClipboardBaseItemConfig._configureFileItem(config, item);
                break;
            case ClipboardType.URL:
                ClipboardBaseItemConfig._configureUrlItem(config, item, linkPreviewsDir);
                break;
            case ClipboardType.CONTACT:
                ClipboardBaseItemConfig._configureContactItem(config, item, style, linkPreviewsDir);
                break;
            case ClipboardType.COLOR:
                ClipboardBaseItemConfig._configureColorItem(config, item, style);
                break;
            case ClipboardType.CODE:
                ClipboardBaseItemConfig._configureCodeItem(config, item);
                break;
            case ClipboardType.TEXT:
            default:
                ClipboardBaseItemConfig._configureTextItem(config, item);
                break;
        }

        // Corrupted state fallback
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
     * Configure File item view.
     * @private
     */
    static _configureFileItem(config, item) {
        config.title = item.preview || 'Unknown File';
        config.subtitle = item.file_uri;
    }

    /**
     * Configure URL item view.
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
     * Configure Contact item view.
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
            config.flagPath = `${ResourcePath.FLAGS}/${countryCode}.svg`;
        }
    }

    /**
     * Configure Color item view.
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
     * Configure Code item view.
     * @private
     */
    static _configureCodeItem(config, item) {
        config.text = item.preview || '';
        config.rawLines = item.raw_lines || 0;
        config.previewLinesCount = config.text ? config.text.split('\n').length : 0;
    }

    /**
     * Configure Text item view.
     * @private
     */
    static _configureTextItem(config, item) {
        config.text = item.preview || item.text || '';
    }
}
