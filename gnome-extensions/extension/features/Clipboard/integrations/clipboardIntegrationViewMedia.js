import GLib from 'gi://GLib';

import { createMediaGridContent, createMediaListContent } from './clipboardViewTemplates.js';

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Resolve the expected preview path for a media item.
 *
 * @param {object} item Clipboard item.
 * @param {string} previewsDir Preview directory.
 * @param {Function} resolveFilename Source filename resolver.
 * @param {Function} resolvePreviewFilename Preview filename resolver.
 * @returns {string|null} Preview path or null.
 */
function resolvePreviewPath(item, previewsDir, resolveFilename, resolvePreviewFilename) {
    const sourceFilename = resolveFilename(item);
    if (!previewsDir || !sourceFilename) return null;

    const base = sourceFilename.replace(/\.[^/.]+$/, '');
    const fallbackPreviewName = `preview_${base}.png`;
    const previewName = resolvePreviewFilename(item) || fallbackPreviewName;

    return GLib.build_filenamev([previewsDir, previewName]);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Create reusable media view rendering hooks for clipboard definitions.
 *
 * @param {object} config Integration configuration.
 * @param {Function} config.resolveFilename Resolves the source filename.
 * @param {Function} config.resolvePreviewFilename Resolves the preview filename.
 * @param {string} config.sourceDirKey Render option key for source files.
 * @param {string} config.previewDirKey Render option key for preview files.
 * @param {string} config.logLabel Label used in load error messages.
 * @returns {object} View rendering hooks.
 */
export function ClipboardIntegrationViewMedia({ resolveFilename, resolvePreviewFilename, sourceDirKey, previewDirKey, logLabel = 'media' }) {
    return {
        createListContent: (_config, item, options) => {
            const filename = resolveFilename(item);
            const sourceDir = options.storage?.[sourceDirKey];
            const previewDir = options.storage?.[previewDirKey];
            if (!filename || !sourceDir || !previewDir) return null;

            const previewPath = resolvePreviewPath(item, previewDir, resolveFilename, resolvePreviewFilename);
            const imagePath = GLib.build_filenamev([sourceDir, filename]);

            return createMediaListContent({
                sourcePath: imagePath,
                previewPath,
                imagePreviewSize: options.previewSize,
                logLabel,
            });
        },

        createGridContent: (_config, item, options) => {
            const filename = resolveFilename(item);
            const sourceDir = options.storage?.[sourceDirKey];
            const previewDir = options.storage?.[previewDirKey];
            if (!filename || !sourceDir || !previewDir) return null;

            const previewPath = resolvePreviewPath(item, previewDir, resolveFilename, resolvePreviewFilename);
            const imagePath = GLib.build_filenamev([sourceDir, filename]);

            return createMediaGridContent({
                sourcePath: imagePath,
                previewPath,
                imagePreviewSize: options.previewSize,
                logLabel,
            });
        },

        getViewFingerprint: (_config, item, options) => {
            return [resolveFilename(item) || '', resolvePreviewFilename(item) || '', options.previewSize || ''].join('|');
        },

        getViewMetadata: (_config, _item, options) => {
            return {
                listMinHeight: options.previewSize || null,
                isFullBleedGrid: true,
            };
        },
    };
}
