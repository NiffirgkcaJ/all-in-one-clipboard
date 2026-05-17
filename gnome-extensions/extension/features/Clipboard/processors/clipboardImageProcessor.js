import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';

import { clipboardGetContent } from '../../../shared/utilities/utilityClipboard.js';
import { IOFile, IOImage } from '../../../shared/utilities/utilityIO.js';

import { ClipboardType } from '../constants/clipboardConstants.js';
import { ProcessorUtils } from '../utilities/clipboardProcessorUtils.js';

// Configuration
const IMAGE_MIMETYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
const PREVIEW_MAX_SIZE = 192;
const MIN_HEADER_SIZE = 4;

// Magic Bytes
const MAGIC_PNG = [0x89, 0x50, 0x4e, 0x47];
const MAGIC_JPEG = [0xff, 0xd8, 0xff];
const MAGIC_GIF = [0x47, 0x49, 0x46];
const MAGIC_WEBP = [0x52, 0x49, 0x46, 0x46];

/**
 * ImageProcessor
 *
 * Reads raw image data from the clipboard, persists it to disk, and generates item metadata.
 */
export class ImageProcessor {
    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Extract image data from the clipboard.
     *
     * @returns {Promise<Object|null>} An object containing data, hash, and mimetype, or null if no image was found.
     */
    static async extract() {
        const tryMimetype = async (mimetype) => {
            const result = await clipboardGetContent(mimetype);
            if (!result || !result.data || result.data.length < MIN_HEADER_SIZE) return null;

            if (!this._isValidImageHeader(result.data, mimetype)) {
                return null;
            }

            const hash = ProcessorUtils.computeHashForData(result.data);
            return { type: ClipboardType.IMAGE, data: result.data, hash, mimetype };
        };

        const results = await Promise.all(IMAGE_MIMETYPES.map(tryMimetype));
        return results.find((r) => r !== null) || null;
    }

    /**
     * Save the image item to disk.
     *
     * @param {Object} extractedData The data returned from extract().
     * @param {string} imagesDir The directory path to store image files.
     * @param {string} previewsDir The directory path to store preview files.
     * @returns {Promise<Object|null>} The final item object to be added to history, or null on failure.
     */
    static async save(extractedData, imagesDir, previewsDir = null) {
        const { data, hash, mimetype, file_uri } = extractedData;
        const id = ProcessorUtils.generateUUID();

        const extension = IOImage.getExtension(mimetype);
        const filename = `${Date.now()}_${id.substring(0, 8)}.${extension}`;
        const filePath = GLib.build_filenamev([imagesDir, filename]);

        const success = await IOFile.write(filePath, IOImage.stringifyBytes(data));

        if (!success) {
            console.error('[AIO-Clipboard] ImageProcessor: Failed to save image file');
            return null;
        }

        let previewFilename = null;
        if (previewsDir) {
            previewFilename = this._generatePreviewFilename(filename);
            this._ensurePreview(filePath, previewsDir, previewFilename);
        }

        let imageWidth = null;
        let imageHeight = null;

        try {
            const [format, width, height] = GdkPixbuf.Pixbuf.get_file_info(filePath);
            if (format) {
                imageWidth = width;
                imageHeight = height;
            }
        } catch {
            // Dimensions couldn't be read, continue without them.
        }

        const item = {
            id,
            type: ClipboardType.IMAGE,
            timestamp: ProcessorUtils.getCurrentTimestamp(),
            image_filename: filename,
            hash,
        };

        if (previewFilename) {
            item.preview_filename = previewFilename;
        }

        if (imageWidth && imageHeight) {
            item.width = imageWidth;
            item.height = imageHeight;
        }

        if (file_uri) {
            item.file_uri = file_uri;
        }

        return item;
    }

    /**
     * Ensure an image item has a cached preview on disk.
     *
     * @param {Object} item Clipboard image item.
     * @param {string} imagesDir Directory where full-size images are stored.
     * @param {string} previewsDir Directory where previews are stored.
     * @returns {boolean} True if preview was created or already exists.
     */
    static ensurePreviewForItem(item, imagesDir, previewsDir) {
        if (!item?.image_filename || !imagesDir || !previewsDir) return false;

        const previewFilename = item.preview_filename || this._generatePreviewFilename(item.image_filename);
        const previewPath = GLib.build_filenamev([previewsDir, previewFilename]);

        if (!IOFile.existsSync(previewPath)) {
            const sourcePath = GLib.build_filenamev([imagesDir, item.image_filename]);
            this._ensurePreview(sourcePath, previewsDir, previewFilename);
        }

        if (IOFile.existsSync(previewPath)) {
            item.preview_filename = previewFilename;
            return true;
        }

        return false;
    }

    /**
     * Regenerate the thumbnail from the source file if it exists.
     *
     * @param {Object} item The clipboard item to heal.
     * @param {string} imagesDir The directory to save the image to.
     * @param {string} previewsDir The directory to save previews to.
     * @returns {Promise<boolean>} True if regeneration succeeded.
     */
    static async regenerateThumbnail(item, imagesDir, previewsDir = null) {
        if (!item.file_uri || !item.image_filename) return false;

        try {
            const bytes = await IOFile.read(item.file_uri.replace('file://', ''));
            if (!bytes) return false;

            const destPath = GLib.build_filenamev([imagesDir, item.image_filename]);
            const success = await IOFile.write(destPath, IOImage.stringifyBytes(bytes));

            if (success && previewsDir) {
                const previewFilename = item.preview_filename || this._generatePreviewFilename(item.image_filename);
                this._ensurePreview(destPath, previewsDir, previewFilename);
                item.preview_filename = previewFilename;
            }

            return success;
        } catch (e) {
            console.error(`[AIO-Clipboard] ImageProcessor: Failed to heal image: ${e.message}`);
            return false;
        }
    }

    /**
     * Regenerate an image by re-downloading from a source URL.
     *
     * @param {Soup.Session} httpSession The HTTP session to use for the request.
     * @param {Object} item The clipboard item to heal.
     * @param {string} imagesDir The directory to save the image to.
     * @param {string} previewsDir The directory to save previews to.
     * @returns {Promise<boolean>} True if regeneration succeeded.
     */
    static async regenerateFromUrl(httpSession, item, imagesDir, previewsDir = null) {
        if (!httpSession || !item.source_url || !item.image_filename) return false;

        try {
            const result = await IOImage.download(httpSession, item.source_url);
            if (!result?.bytes || result.bytes.length === 0) return false;

            const destPath = GLib.build_filenamev([imagesDir, item.image_filename]);
            const success = await IOFile.write(destPath, IOImage.stringifyBytes(result.bytes));

            if (success && previewsDir) {
                const previewFilename = item.preview_filename || this._generatePreviewFilename(item.image_filename);
                this._ensurePreview(destPath, previewsDir, previewFilename);
                item.preview_filename = previewFilename;
            }

            return success;
        } catch (e) {
            console.error(`[AIO-Clipboard] ImageProcessor: Failed to heal from URL: ${e.message}`);
            return false;
        }
    }

    // ========================================================================
    // Internal Helpers
    // ========================================================================

    /**
     * Validate that the data starts with correct magic bytes for the given mimetype.
     *
     * @param {Uint8Array} data The raw bytes to check.
     * @param {string} mimetype The expected mimetype.
     * @returns {boolean} True if the header matches the mimetype.
     * @private
     */
    static _isValidImageHeader(data, mimetype) {
        if (!data || data.length < MIN_HEADER_SIZE) return false;

        switch (mimetype) {
            case 'image/png':
                return MAGIC_PNG.every((byte, i) => data[i] === byte);
            case 'image/jpeg':
            case 'image/jpg':
                return MAGIC_JPEG.every((byte, i) => data[i] === byte);
            case 'image/gif':
                return MAGIC_GIF.every((byte, i) => data[i] === byte);
            case 'image/webp':
                return MAGIC_WEBP.every((byte, i) => data[i] === byte);
            default:
                return false;
        }
    }

    /**
     * Build a preview filename based on the original filename.
     *
     * @param {string} filename Original image filename.
     * @returns {string|null} Preview filename.
     * @private
     */
    static _generatePreviewFilename(filename) {
        if (!filename) return null;
        const base = filename.replace(/\.[^/.]+$/, '');
        return `preview_${base}.png`;
    }

    /**
     * Generate a downscaled preview image if missing.
     *
     * @param {string} sourcePath Full-size image path.
     * @param {string} previewsDir Directory to store previews.
     * @param {string} previewFilename Preview filename.
     * @private
     */
    static _ensurePreview(sourcePath, previewsDir, previewFilename) {
        if (!previewsDir || !previewFilename) return;

        try {
            const previewPath = GLib.build_filenamev([previewsDir, previewFilename]);
            if (IOFile.existsSync(previewPath)) return;

            IOFile.mkdir(previewsDir);

            const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(sourcePath, PREVIEW_MAX_SIZE, PREVIEW_MAX_SIZE, true);
            if (!pixbuf) return;
            pixbuf.savev(previewPath, 'png', [], []);
        } catch (e) {
            console.warn(`[AIO-Clipboard] ImageProcessor: Failed to generate preview: ${e.message}`);
        }
    }
}
