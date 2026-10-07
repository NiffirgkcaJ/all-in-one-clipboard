import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

import { Logger } from '../../../shared/utilities/utilityLogger.js';
import { clipboardGetContent, clipboardGetText } from '../../../shared/utilities/utilityClipboard.js';
import { IOFile, IOImage, IOText } from '../../../shared/utilities/utilityIO.js';

import { ClipboardType } from '../constants/clipboardPluginConstants.js';
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
        const standardMatch = results.find((r) => r !== null) || null;
        if (standardMatch) {
            return standardMatch;
        }

        return await this._extractStandaloneFromHtml();
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
            Logger.error('Failed to save image file', 'ImageProcessor');
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
     * Ensure an image item has a cached preview on disk asynchronously.
     *
     * @param {Object} item Clipboard image item.
     * @param {string} imagesDir Directory where full-size images are stored.
     * @param {string} previewsDir Directory where previews are stored.
     * @returns {Promise<boolean>} True if preview was created or already exists.
     */
    static async ensurePreviewForItemAsync(item, imagesDir, previewsDir) {
        if (!item?.image_filename || !imagesDir || !previewsDir) return false;

        const previewFilename = item.preview_filename || this._generatePreviewFilename(item.image_filename);
        const previewPath = GLib.build_filenamev([previewsDir, previewFilename]);

        const exists = await IOFile.exists(previewPath);

        if (!exists) {
            const sourcePath = GLib.build_filenamev([imagesDir, item.image_filename]);
            await this._ensurePreviewAsync(sourcePath, previewsDir, previewFilename);
        }

        const existsAfter = await IOFile.exists(previewPath);

        if (existsAfter) {
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
            Logger.error(`Failed to heal image: ${e.message}`, 'ImageProcessor');
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
            Logger.error(`Failed to heal from URL: ${e.message}`, 'ImageProcessor');
            return false;
        }
    }

    // ========================================================================
    // Internal Helpers
    // ========================================================================

    /**
     * Fetch and decode image data from a data URI, web URL, or local file URI.
     *
     * @param {string} source Source URI or data string.
     * @returns {Promise<Object|null>} Object containing data, hash, and mimetype, or null.
     */
    static async fetchImageFromSource(source) {
        if (!source) return null;

        if (source.startsWith('data:image/')) {
            return this._fetchDataUriImage(source);
        }

        if (source.startsWith('http://') || source.startsWith('https://')) {
            return await this._fetchWebImage(source);
        }

        if (source.startsWith('file://')) {
            return await this._fetchFileImage(source);
        }

        return null;
    }

    /**
     * Decode image data from a base64 data URI.
     *
     * @param {string} source Data URI string.
     * @returns {Object|null} Decoded image data or null.
     * @private
     */
    static _fetchDataUriImage(source) {
        const dataUriMatch = source.match(/^data:(image\/[a-zA-Z0-9.+-]+)(?:;[^;,]+)*;base64,(.+)$/s);
        if (!dataUriMatch) return null;

        const rawMime = dataUriMatch[1];
        const base64Data = dataUriMatch[2].replace(/\s/g, '');
        try {
            const bytes = GLib.base64_decode(base64Data);
            if (!bytes || bytes.length < MIN_HEADER_SIZE) return null;

            const mimetype = this._detectImageMimetype(bytes) || rawMime;
            const hash = ProcessorUtils.computeHashForData(bytes);
            return { data: bytes, hash, mimetype };
        } catch {
            return null;
        }
    }

    /**
     * Download image data from a web URL.
     *
     * @param {string} source Web URL.
     * @returns {Promise<Object|null>} Downloaded image data or null.
     * @private
     */
    static async _fetchWebImage(source) {
        try {
            if (!this._httpSession) {
                this._httpSession = new Soup.Session();
            }
            const result = await IOImage.download(this._httpSession, source);
            if (!result?.bytes || result.bytes.length < MIN_HEADER_SIZE) return null;

            const mimetype = this._detectImageMimetype(result.bytes) || result.contentType || 'image/png';
            const hash = ProcessorUtils.computeHashForData(result.bytes);
            return { data: result.bytes, hash, mimetype };
        } catch {
            return null;
        }
    }

    /**
     * Read image data from a local file URI.
     *
     * @param {string} source File URI.
     * @returns {Promise<Object|null>} Read image data or null.
     * @private
     */
    static async _fetchFileImage(source) {
        try {
            const [filePath] = GLib.filename_from_uri(source);
            if (!filePath) return null;

            const bytes = await IOFile.read(filePath);
            if (!bytes || bytes.length < MIN_HEADER_SIZE) return null;

            const mimetype = this._detectImageMimetype(bytes) || 'image/png';
            const hash = ProcessorUtils.computeHashForData(bytes);
            return { data: bytes, hash, mimetype };
        } catch {
            return null;
        }
    }

    /**
     * Extract standalone image from an HTML clipboard payload when text is absent.
     *
     * @returns {Promise<Object|null>} Extracted image or null.
     * @private
     */
    static async _extractStandaloneFromHtml() {
        const text = await clipboardGetText();
        if (text && text.replace(/[\s\uFFFC]/g, '').length > 0) {
            return null;
        }

        const htmlResult = await clipboardGetContent('text/html');
        if (!htmlResult?.data || htmlResult.size === 0) {
            return null;
        }

        const htmlString = IOText.parseBytes(htmlResult.data);
        if (!htmlString) return null;

        const cleanHtml = htmlString.replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, '');
        const textWithoutTags = cleanHtml.replace(/<[^>]+>/g, '');
        const visibleText = textWithoutTags.replace(/&nbsp;/g, ' ').replace(/[\s\uFFFC]/g, '');
        if (visibleText.length > 0) {
            return null;
        }

        const imgMatches = [...cleanHtml.matchAll(/<img\b[^>]*?\bsrc=(?:["']([^"']+)["']|([^"'\s>]+))/gi)];
        if (imgMatches.length !== 1) {
            return null;
        }

        const src = imgMatches[0][1] || imgMatches[0][2];
        if (!src) return null;

        const imageData = await this.fetchImageFromSource(src);
        if (!imageData) return null;

        return {
            type: ClipboardType.IMAGE,
            ...imageData,
        };
    }

    /**
     * Detect image mimetype from magic bytes.
     *
     * @param {Uint8Array} data Raw byte buffer.
     * @returns {string|null} Detected mimetype or null.
     * @private
     */
    static _detectImageMimetype(data) {
        if (!data || data.length < MIN_HEADER_SIZE) return null;
        if (MAGIC_PNG.every((byte, i) => data[i] === byte)) return 'image/png';
        if (MAGIC_JPEG.every((byte, i) => data[i] === byte)) return 'image/jpeg';
        if (MAGIC_GIF.every((byte, i) => data[i] === byte)) return 'image/gif';
        if (MAGIC_WEBP.every((byte, i) => data[i] === byte)) return 'image/webp';
        return null;
    }

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
        const previewPath = GLib.build_filenamev([previewsDir, previewFilename]);
        IOImage.ensurePreview(sourcePath, previewPath, PREVIEW_MAX_SIZE);
    }

    /**
     * Generate a downscaled preview image asynchronously if missing.
     *
     * @param {string} sourcePath Full-size image path.
     * @param {string} previewsDir Directory to store previews.
     * @param {string} previewFilename Preview filename.
     * @private
     */
    static async _ensurePreviewAsync(sourcePath, previewsDir, previewFilename) {
        if (!previewsDir || !previewFilename) return;
        const previewPath = GLib.build_filenamev([previewsDir, previewFilename]);
        await IOImage.ensurePreviewAsync(sourcePath, previewPath, PREVIEW_MAX_SIZE);
    }
}
