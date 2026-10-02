import { ClipboardIcons } from '../constants/clipboardConstants.js';

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
     * @param {Object} context View context.
     * @param {Object} context.registry Clipboard registry instance.
     * @param {Object} context.storage Clipboard storage instance.
     * @returns {Object} Standardized configuration object.
     */
    static getItemViewConfig(item, context = {}) {
        const registry = context.registry;
        const style = registry ? registry.getItemStyle(item) : null;

        const config = {
            layoutMode: style?.layout || 'text',
            icon: style?.icon || null,
            text: '',
        };

        // Type Configuration
        if (registry) {
            registry.configureView(config, item, { ...context, style });
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
     * Build a fingerprint for all inputs that affect rendered item content.
     *
     * @param {Object} config Item view config.
     * @param {Object} item Clipboard item.
     * @param {Object} options Render options.
     * @returns {string} Render fingerprint.
     */
    static getItemRenderFingerprint(config, item, options = {}) {
        if (options.registry) {
            return options.registry.getViewFingerprint(config, item, options);
        }

        return config._fingerprint || ClipboardBaseItemConfig._buildConfigFingerprint(config);
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
