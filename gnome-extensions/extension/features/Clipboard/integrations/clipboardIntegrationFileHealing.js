import GLib from 'gi://GLib';

// ============================================================================
// Public API
// ============================================================================

/**
 * Create a text-file integrity integration.
 *
 * @param {object} config Integration configuration.
 * @param {string} config.dirKey Storage directory getter key.
 * @param {Function} config.filenameResolver Resolves the expected filename.
 * @param {Function} config.shouldCheck Decides whether the item should be checked.
 * @returns {Function} Healing integration.
 */
export function ClipboardIntegrationFileIntegrity({ dirKey, filenameResolver, shouldCheck = () => true }) {
    return (item, { storage } = {}) => {
        if (!shouldCheck(item) || !storage) {
            return { healed: false, isCorrupted: false };
        }

        const filename = filenameResolver(item);
        const isCorrupted = !storage.checkFileExists(storage[dirKey], filename);
        return { healed: false, isCorrupted };
    };
}

/**
 * Create an icon-file healing integration.
 *
 * @param {object} config Integration configuration.
 * @param {string} config.iconField Item field containing the icon filename.
 * @param {Function} config.shouldHeal Decides whether the item should be healed.
 * @param {Function} config.regenerateIcon Regenerates the icon file.
 * @returns {Function} Async healing integration.
 */
export function ClipboardIntegrationIconFileHealing({ iconField = 'icon_filename', shouldHeal = () => true, regenerateIcon }) {
    return async (item, context = {}) => {
        if (!shouldHeal(item, context)) {
            return { healed: false, isCorrupted: false };
        }

        if (!item?.[iconField]) {
            return { healed: false, isCorrupted: false };
        }

        if (context.storage.checkFileExists(context.storage.linkPreviewsDir, item[iconField])) {
            return { healed: false, isCorrupted: false };
        }

        const newFilename = await regenerateIcon(item, context);
        item[iconField] = newFilename || null;

        return { healed: true, isCorrupted: false };
    };
}

/**
 * Create a generated-file healing integration.
 *
 * @param {object} config Integration configuration.
 * @param {string} config.fileField Item field containing the generated filename.
 * @param {string} config.dirKey Storage directory getter key.
 * @param {Function} config.regenerate Regenerates the file.
 * @returns {Function} Healing integration.
 */
export function ClipboardIntegrationGeneratedFileHealing({ fileField, dirKey, regenerate }) {
    return (item, context = {}) => {
        if (!item?.[fileField]) {
            return { healed: false, isCorrupted: false };
        }

        if (context.storage.checkFileExists(context.storage[dirKey], item[fileField])) {
            return { healed: false, isCorrupted: false };
        }

        const healed = regenerate(item, context);
        return { healed, isCorrupted: !healed };
    };
}

/**
 * Create image cache and preview healing integration.
 *
 * @param {object} config Integration configuration.
 * @param {Function} config.ensurePreview Ensures the preview file exists.
 * @param {Function} config.regenerateThumbnail Regenerates image from a file URI.
 * @param {Function} config.regenerateFromUrl Regenerates image from a source URL.
 * @returns {Function} Async healing integration.
 */
export function ClipboardIntegrationImageFileHealing({ ensurePreview, regenerateThumbnail, regenerateFromUrl }) {
    return async (item, context = {}) => {
        const storage = context.storage;
        if (!item?.image_filename || !storage) {
            return { healed: false, isCorrupted: false };
        }

        const missingFile = !storage.checkFileExists(storage.imagesDir, item.image_filename);
        if (!missingFile) {
            if (item.preview_filename) {
                const previewMissing = !storage.checkFileExists(storage.imagePreviewsDir, item.preview_filename);
                if (!previewMissing) return { healed: false, isCorrupted: false };
            }

            const healed = ensurePreview(item, context);
            return { healed, isCorrupted: false };
        }

        if (item.file_uri) {
            const cacheUri = `file://${GLib.build_filenamev([storage.imagesDir, item.image_filename])}`;
            if (item.file_uri !== cacheUri) {
                const healed = await regenerateThumbnail(item, context);
                return { healed, isCorrupted: !healed };
            }
        }

        if (item.source_url && context.httpSession) {
            const healed = await regenerateFromUrl(item, context);
            return { healed, isCorrupted: !healed };
        }

        return { healed: false, isCorrupted: true };
    };
}
