import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { IOFile } from '../../../shared/utilities/utilityIO.js';
import { ResourcePath } from '../../../shared/constants/storagePaths.js';

import { ClipboardType, ClipboardStyling, ClipboardIcons } from '../constants/clipboardConstants.js';

// Existing Preview
const EXISTING_PREVIEW_PATH_CACHE = new Set();

/**
 * ClipboardBaseItemConfig
 *
 * Shared configuration utilities for clipboard items.
 * Maps raw item data to view configurations used by both list and grid factories.
 */
export class ClipboardBaseItemConfig {
    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Map an item's raw data to a standardized view configuration.
     *
     * @param {Object} item The raw item data.
     * @param {string} imagesDir Directory where images are stored.
     * @param {string} linkPreviewsDir Directory where link previews are stored.
     * @returns {Object} Standardized configuration object.
     */
    static getItemViewConfig(item, imagesDir, linkPreviewsDir) {
        const style = ClipboardStyling[item.type] || ClipboardStyling[ClipboardType.TEXT];

        const config = {
            layoutMode: style.layout,
            icon: style.icon,
            text: '',
        };

        // Type Configuration
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

        // Corruption Fallback
        if (item.is_corrupted) {
            config.icon = ClipboardIcons.ERROR_WARNING.icon;
            config.iconOptions = ClipboardIcons.ERROR_WARNING.iconOptions;

            if (config.layoutMode === 'image') {
                config.layoutMode = 'rich';
                config.title = 'Image (Data Lost)';
            } else if (config.layoutMode === 'code') {
                config.title = 'Code (Full Content Lost)';
            } else if (config.layoutMode === 'text') {
                config.layoutMode = 'rich';
                config.title = config.text ? config.text.substring(0, 50) + '...' : 'Text (Full Content Lost)';
            }

            config.subtitle = 'Cannot be recovered';
        }

        config._fingerprint = ClipboardBaseItemConfig._buildConfigFingerprint(config);
        return config;
    }

    /**
     * Resolve an image preview path if available on disk.
     *
     * @param {Object} itemData Clipboard item data.
     * @param {string} imagePreviewsDir Directory where image previews are stored.
     * @returns {string|null} Resolved path or null if missing.
     */
    static resolveImagePreviewPath(itemData, imagePreviewsDir) {
        if (!imagePreviewsDir || !itemData?.image_filename) return null;

        const base = itemData.image_filename.replace(/\.[^/.]+$/, '');
        const fallbackPreviewName = `preview_${base}.png`;
        const previewName = itemData.preview_filename || fallbackPreviewName;
        const previewPath = GLib.build_filenamev([imagePreviewsDir, previewName]);

        if (EXISTING_PREVIEW_PATH_CACHE.has(previewPath)) {
            return previewPath;
        }

        if (IOFile.existsSync(previewPath)) {
            EXISTING_PREVIEW_PATH_CACHE.add(previewPath);
            return previewPath;
        }

        return null;
    }

    // ========================================================================
    // Internal Helpers
    // ========================================================================

    /**
     * Build a lightweight stable fingerprint for update fast-path checks.
     *
     * @param {Object} config Item view config.
     * @returns {string} Config fingerprint.
     * @private
     */
    static _buildConfigFingerprint(config) {
        const iconOptions = config.iconOptions;
        const iconOptionsFingerprint = iconOptions ? `${iconOptions.color || ''}:${iconOptions.styleClass || ''}` : '';

        return [
            config.layoutMode || '',
            config.icon || '',
            config.title || '',
            config.subtitle || '',
            config.text || '',
            config.cssColor || '',
            config.rawLines || 0,
            config.previewLinesCount || 0,
            config.flagPath || '',
            config.giconPath || '',
            iconOptionsFingerprint,
        ].join('|');
    }

    /**
     * Configure the view state for File items.
     *
     * @param {Object} config Output config.
     * @param {Object} item Source item.
     * @private
     */
    static _configureFileItem(config, item) {
        config.title = item.preview || 'Unknown File';
        config.subtitle = item.file_uri;
    }

    /**
     * Configure the view state for URL items.
     *
     * @param {Object} config Output config.
     * @param {Object} item Source item.
     * @param {string} linkPreviewsDir Previews directory.
     * @private
     */
    static _configureUrlItem(config, item, linkPreviewsDir) {
        config.title = item.title || item.url;
        config.subtitle = item.url;

        if (item.icon_filename && linkPreviewsDir) {
            const iconPath = GLib.build_filenamev([linkPreviewsDir, item.icon_filename]);
            config.giconPath = iconPath;
            config.gicon = new Gio.FileIcon({ file: Gio.File.new_for_path(iconPath) });
        }
    }

    /**
     * Configure the view state for Contact items.
     *
     * @param {Object} config Output config.
     * @param {Object} item Source item.
     * @param {Object} style Styling definitions.
     * @param {string} linkPreviewsDir Previews directory.
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
            config.giconPath = iconPath;
            config.gicon = new Gio.FileIcon({ file: Gio.File.new_for_path(iconPath) });
        }

        if (item.subtype === 'phone' && item.metadata && item.metadata.code) {
            const countryCode = item.metadata.code.toLowerCase();
            config.flagPath = `${ResourcePath.FLAGS}/${countryCode}.svg`;
        }
    }

    /**
     * Configure the view state for Color items.
     *
     * @param {Object} config Output config.
     * @param {Object} item Source item.
     * @param {Object} style Styling definitions.
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
     * Configure the view state for Code items.
     *
     * @param {Object} config Output config.
     * @param {Object} item Source item.
     * @private
     */
    static _configureCodeItem(config, item) {
        config.text = item.preview || '';
        config.rawLines = item.raw_lines || 0;
        config.previewLinesCount = config.text ? config.text.split('\n').length : 0;
    }

    /**
     * Configure the view state for Text items.
     *
     * @param {Object} config Output config.
     * @param {Object} item Source item.
     * @private
     */
    static _configureTextItem(config, item) {
        config.text = item.preview || item.text || '';
    }
}
