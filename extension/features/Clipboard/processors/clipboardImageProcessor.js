import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';
import St from 'gi://St';

import { IOFile } from '../../../shared/utilities/utilityIO.js';
import { ServiceImage } from '../../../shared/services/serviceImage.js';

import { ClipboardType } from '../constants/clipboardConstants.js';
import { ProcessorUtils } from '../utilities/clipboardProcessorUtils.js';

// Validation Patterns
const IMAGE_MIMETYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];

// Configuration
const DOWNLOAD_TIMEOUT = 10; // seconds

/**
 * ImageProcessor - Handles image clipboard data
 *
 * Pattern: Two-phase (extract + save)
 * - extract(): Reads raw image data from clipboard
 * - save(): Persists image to disk and returns item metadata
 */
export class ImageProcessor {
    /**
     * Extracts image data from the clipboard.
     * @returns {Promise<Object|null>} An object containing data, hash, and mimetype, or null if no image found.
     */
    static async extract() {
        const tryMimetype = (mimetype) =>
            new Promise((resolve) => {
                St.Clipboard.get_default().get_content(St.ClipboardType.CLIPBOARD, mimetype, (_clipboard, bytes) => {
                    if (bytes && bytes.get_size() > 0) {
                        const data = bytes.get_data();
                        const hash = ProcessorUtils.computeHashForData(data);
                        resolve({
                            type: ClipboardType.IMAGE,
                            data,
                            hash,
                            mimetype,
                        });
                    } else {
                        resolve(null);
                    }
                });
            });

        const results = await Promise.all(IMAGE_MIMETYPES.map(tryMimetype));
        return results.find((r) => r !== null) || null;
    }

    /**
     * Saves the image item to disk.
     * @param {Object} extractedData - The data returned from extract().
     * @param {string} imagesDir - The directory path to store image files.
     * @returns {Promise<Object|null>} The final item object to be added to history, or null on failure.
     */
    static async save(extractedData, imagesDir) {
        const { data, hash, mimetype, file_uri } = extractedData;
        const id = ProcessorUtils.generateUUID();

        const extension = ServiceImage.getExtension(mimetype);
        const filename = `${Date.now()}_${id.substring(0, 8)}.${extension}`;
        const filePath = GLib.build_filenamev([imagesDir, filename]);

        const success = await IOFile.write(filePath, ServiceImage.encode(data));
        if (!success) {
            console.error('[AIO-Clipboard] ImageProcessor: Failed to save image file');
            return null;
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
            // Dimensions couldn't be read, continue without them
        }

        const item = {
            id,
            type: ClipboardType.IMAGE,
            timestamp: ProcessorUtils.getCurrentTimestamp(),
            image_filename: filename,
            hash,
        };

        if (imageWidth && imageHeight) {
            item.image_width = imageWidth;
            item.image_height = imageHeight;
        }

        if (file_uri) {
            item.file_uri = file_uri;
        }

        return item;
    }

    /**
     * Regenerates the thumbnail from the source file if it exists.
     * @param {Object} item - The clipboard item to heal.
     * @param {string} imagesDir - The directory to save the image to.
     * @returns {Promise<boolean>} True if regeneration succeeded.
     */
    static async regenerateThumbnail(item, imagesDir) {
        if (!item.file_uri || !item.image_filename) return false;

        try {
            const bytes = await IOFile.read(item.file_uri.replace('file://', ''));
            if (!bytes) return false;

            const destPath = GLib.build_filenamev([imagesDir, item.image_filename]);
            const success = await IOFile.write(destPath, ServiceImage.encode(bytes));

            return success;
        } catch (e) {
            console.error(`[AIO-Clipboard] ImageProcessor: Failed to heal image: ${e.message}`);
            return false;
        }
    }

    /**
     * Regenerates an image by re-downloading from a source URL.
     * Used for images that were originally downloaded from the web (e.g., GIFs).
     * @param {Object} item - The clipboard item to heal.
     * @param {string} imagesDir - The directory to save the image to.
     * @returns {Promise<boolean>} True if regeneration succeeded.
     */
    static async regenerateFromUrl(item, imagesDir) {
        if (!item.source_url || !item.image_filename) return false;

        try {
            const bytes = await ServiceImage.download(item.source_url, DOWNLOAD_TIMEOUT);
            if (!bytes || bytes.length === 0) return false;

            const destPath = GLib.build_filenamev([imagesDir, item.image_filename]);
            const success = await IOFile.write(destPath, ServiceImage.encode(bytes));

            return success;
        } catch (e) {
            console.error(`[AIO-Clipboard] ImageProcessor: Failed to heal from URL: ${e.message}`);
            return false;
        }
    }
}
