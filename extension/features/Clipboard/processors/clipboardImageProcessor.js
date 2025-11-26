import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

// Supported image MIME types
const IMAGE_MIMETYPES = [
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/gif',
    'image/webp'
];

export class ImageProcessor {
    /**
     * Extracts image data from the clipboard.
     * @returns {Promise<Object|null>} An object containing data, hash, and mimetype, or null if no image found.
     */
    static async extract() {
        for (const mimetype of IMAGE_MIMETYPES) {
            const result = await new Promise(resolve => {
                St.Clipboard.get_default().get_content(
                    St.ClipboardType.CLIPBOARD,
                    mimetype,
                    (_, bytes) => {
                        if (bytes && bytes.get_size() > 0) {
                            const data = bytes.get_data();
                            const hash = GLib.compute_checksum_for_data(
                                GLib.ChecksumType.SHA256,
                                data
                            );
                            resolve({ data, hash, mimetype });
                        } else {
                            resolve(null);
                        }
                    }
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
        const id = GLib.uuid_string_random();

        const extension = mimetype.split('/')[1] || 'img';
        const filename = `${Date.now()}_${id.substring(0, 8)}.${extension}`;

        try {
            const file = Gio.File.new_for_path(
                GLib.build_filenamev([imagesDir, filename])
            );

            const bytesToSave = GLib.Bytes.new(data);
            file.replace_contents(
                bytesToSave.get_data(),
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null
            );
        } catch (e) {
            console.error(`[AIO-Clipboard] Failed to save image file: ${e.message}`);
            return null;
        }

        // Construct the item object
        const item = {
            id,
            type: 'image',
            timestamp: Math.floor(Date.now() / 1000),
            image_filename: filename,
            hash
        };

        if (file_uri) {
            item.file_uri = file_uri;
        }

        return item;
    }
}