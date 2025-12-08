import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';
import St from 'gi://St';

import { ClipboardType } from '../constants/clipboardConstants.js';
import { ProcessorUtils } from '../utilities/clipboardProcessorUtils.js';

// Validation Patterns
const IMAGE_MIMETYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];

// Configuration
const DOWNLOAD_TIMEOUT = 10; // seconds
const HTTP_ERROR_STATUS = 300; // Status codes >= this are errors

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
        for (const mimetype of IMAGE_MIMETYPES) {
            // eslint-disable-next-line no-await-in-loop
            const result = await new Promise((resolve) => {
                St.Clipboard.get_default().get_content(
                    St.ClipboardType.CLIPBOARD,
                    mimetype,

                    (_clipboard, bytes) => {
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
                    },
                );
            });

            if (result) {
                return result;
            }
        }
        return null;
    }

    /**
     * Saves the image item to disk.
     * @param {Object} extractedData - The data returned from extract().
     * @param {string} imagesDir - The directory path to store image files.
     * @returns {Object|null} The final item object to be added to history, or null on failure.
     */
    static save(extractedData, imagesDir) {
        const { data, hash, mimetype, file_uri } = extractedData;
        const id = ProcessorUtils.generateUUID();

        const extension = mimetype.split('/')[1] || 'img';
        const filename = `${Date.now()}_${id.substring(0, 8)}.${extension}`;

        try {
            const file = Gio.File.new_for_path(GLib.build_filenamev([imagesDir, filename]));

            const bytesToSave = GLib.Bytes.new(data);
            file.replace_contents(bytesToSave.get_data(), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (e) {
            console.error(`[AIO-Clipboard] ImageProcessor: Failed to save image file: ${e.message}`);
            return null;
        }

        // Construct the item object
        const item = {
            id,
            type: ClipboardType.IMAGE, // Use Enum
            timestamp: ProcessorUtils.getCurrentTimestamp(),
            image_filename: filename,
            hash,
        };

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
            // Check if source file exists
            const sourceFile = Gio.File.new_for_uri(item.file_uri);
            if (!sourceFile.query_exists(null)) return false;

            // Load from source
            const [success, contents] = await new Promise((resolve) => {
                sourceFile.load_contents_async(null, (src, res) => {
                    try {
                        const result = src.load_contents_finish(res);
                        resolve(result);
                    } catch {
                        resolve([false, null]);
                    }
                });
            });

            if (!success || !contents) return false;

            // Save to images directory
            const destPath = GLib.build_filenamev([imagesDir, item.image_filename]);
            const destFile = Gio.File.new_for_path(destPath);

            await new Promise((resolve, reject) => {
                destFile.replace_contents_async(contents, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null, (src, res) => {
                    try {
                        src.replace_contents_finish(res);
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            return true;
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
            const session = new Soup.Session();
            session.timeout = DOWNLOAD_TIMEOUT;

            const message = new Soup.Message({
                method: 'GET',
                uri: GLib.Uri.parse(item.source_url, GLib.UriFlags.NONE),
            });

            const bytes = await new Promise((resolve, reject) => {
                session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (sess, res) => {
                    if (message.get_status() >= HTTP_ERROR_STATUS) {
                        reject(new Error(`HTTP Error ${message.get_status()}`));
                        return;
                    }
                    try {
                        resolve(sess.send_and_read_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            if (!bytes || bytes.get_size() === 0) return false;

            // Save to images directory
            const destPath = GLib.build_filenamev([imagesDir, item.image_filename]);
            const destFile = Gio.File.new_for_path(destPath);

            await new Promise((resolve, reject) => {
                destFile.replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null, (src, res) => {
                    try {
                        src.replace_contents_finish(res);
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            return true;
        } catch (e) {
            console.error(`[AIO-Clipboard] ImageProcessor: Failed to heal from URL: ${e.message}`);
            return false;
        }
    }
}
