import GLib from 'gi://GLib';

import { createSwatchGridContent, createSwatchListContent } from './clipboardViewTemplates.js';

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Resolve the swatch background style for an item.
 *
 * @param {object} config View config.
 * @param {object} item Clipboard item.
 * @param {object} options Render options.
 * @param {Function} resolveFilename Gradient filename resolver.
 * @param {string} backgroundSize Background size style.
 * @returns {string} CSS style.
 */
function resolveSwatchStyle(config, item, options, resolveFilename, backgroundSize) {
    const filename = resolveFilename(item);
    const imagesDir = options.storage?.imagesDir;
    if (filename && imagesDir) {
        const gradientPath = GLib.build_filenamev([imagesDir, filename]);
        return `background-image: url('file://${gradientPath}'); background-size: ${backgroundSize};`;
    }

    return `background-color: ${config.cssColor || '#000000'};`;
}

/**
 * Resolve the swatch background style for grid cards.
 *
 * @param {object} config View config.
 * @param {object} item Clipboard item.
 * @param {object} options Render options.
 * @param {Function} resolveFilename Gradient filename resolver.
 * @returns {string} CSS style.
 */
function resolveGridSwatchStyle(config, item, options, resolveFilename) {
    const filename = resolveFilename(item);
    const imagesDir = options.storage?.imagesDir;
    if (filename && imagesDir) {
        return `${resolveSwatchStyle(config, item, options, resolveFilename, 'contain')} background-repeat: repeat;`;
    }

    if (config.cssColor) {
        return `background-color: ${config.cssColor};`;
    }

    return '';
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Create reusable swatch view rendering hooks for clipboard definitions.
 *
 * @param {object} config Integration configuration.
 * @param {Function} config.resolveFilename Resolves the generated swatch filename.
 * @returns {object} View rendering hooks.
 */
export function ClipboardIntegrationViewSwatch({ resolveFilename }) {
    return {
        createListContent: (config, item, options) => {
            return createSwatchListContent({
                icon: config.icon,
                iconOptions: config.iconOptions,
                gicon: config.gicon,
                flagPath: config.flagPath,
                title: config.title,
                subtitle: config.subtitle,
                swatchStyle: resolveSwatchStyle(config, item, options, resolveFilename, 'cover'),
            });
        },

        createGridContent: (config, item, options) => {
            return createSwatchGridContent({
                title: config.title,
                swatchStyle: resolveGridSwatchStyle(config, item, options, resolveFilename),
            });
        },

        getViewFingerprint: (_config, item) => {
            return resolveFilename(item) || '';
        },

        getViewMetadata: () => {
            return {
                isFullBleedGrid: true,
            };
        },
    };
}
