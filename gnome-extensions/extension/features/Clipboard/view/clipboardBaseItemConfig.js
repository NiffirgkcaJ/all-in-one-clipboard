import GLib from 'gi://GLib';

import { IOFile } from '../../../shared/utilities/utilityIO.js';

import { ClipboardIcons } from '../constants/clipboardConstants.js';

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
     * @param {Object} registry Clipboard registry instance.
     * @returns {Object} Standardized configuration object.
     */
    static getItemViewConfig(item, imagesDir, linkPreviewsDir, registry) {
        const style = registry ? registry.getItemStyle(item) : null;

        const config = {
            layoutMode: style?.layout || 'text',
            icon: style?.icon || null,
            text: '',
        };

        // Type Configuration
        if (registry) {
            registry.configureView(config, item, { imagesDir, linkPreviewsDir, style });
        } else {
            config.text = item.preview || item.text || '';
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
        if (!imagePreviewsDir || !itemData.image_filename) return null;

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
}
