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
            icon: style ? style.icon : null,
            text: '',
        };

        // Type Configuration
        if (registry) {
            registry.configureView(config, item, { ...context, style });
        } else {
            config.text = item.preview || item.text || '';
        }

        // Corruption Fallback
        const isCorrupted = item.is_corrupted || Boolean(registry && !registry.getDefinition(item.type));
        if (isCorrupted) {
            config.icon = ClipboardIcons.ERROR_WARNING.icon;
            config.iconOptions = ClipboardIcons.ERROR_WARNING.iconOptions;
            config.subtitle = 'Cannot be recovered';
            config.title = ClipboardBaseItemConfig._resolveFallbackTitle(config, item);
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
     * Resolve a safe display title for corrupted items.
     *
     * @param {Object} config View configuration.
     * @param {Object} item Raw clipboard item.
     * @returns {string} Safe display title.
     * @private
     */
    static _resolveFallbackTitle(config, item) {
        const candidates = [config.title, item.title, item.name, item.url, config.text, item.text, item.preview];
        const rawCandidate = candidates.find(Boolean) || '';
        const safeText = String(rawCandidate).trim();
        const textPreview = safeText.length > 50 ? `${safeText.slice(0, 50)}...` : safeText;
        return textPreview || 'Item (Data Lost)';
    }

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

        return [config.icon || '', config.title || '', config.subtitle || '', config.text || '', iconOptionsFingerprint].join('|');
    }
}
