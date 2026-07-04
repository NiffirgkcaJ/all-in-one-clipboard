import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { Logger } from '../utilities/utilityLogger.js';
import { ServiceCoreImage } from './serviceCoreImage.js';
import { ServiceStorageFile } from './serviceStorageFile.js';
import { ServiceStorageResource } from './serviceStorageResource.js';

/**
 * Image IO service for file and resource reads/writes plus image helpers.
 */
export const ServiceIOImage = {
    /**
     * Encodes bytes for storage.
     *
     * @param {Uint8Array} bytes Raw image bytes.
     * @returns {Uint8Array} Encoded image bytes.
     */
    encode(bytes) {
        return ServiceCoreImage.encode(bytes);
    },

    /**
     * Decodes bytes from storage.
     *
     * @param {Uint8Array} bytes Stored image bytes.
     * @returns {Uint8Array} Decoded image bytes.
     */
    decode(bytes) {
        return ServiceCoreImage.decode(bytes);
    },

    /**
     * Parses bytes as image.
     *
     * @param {Uint8Array} bytes Raw bytes to parse.
     * @returns {Uint8Array|null} Decoded image bytes or null.
     */
    parseBytes(bytes) {
        return ServiceCoreImage.parseBytes(bytes);
    },

    /**
     * Serializes image to bytes.
     *
     * @param {Uint8Array} bytes Image data to serialize.
     * @returns {Uint8Array|null} Encoded bytes or null.
     */
    stringifyBytes(bytes) {
        return ServiceCoreImage.stringifyBytes(bytes);
    },

    /**
     * Parses text as image.
     *
     * @param {Uint8Array} bytes Input bytes.
     * @returns {Uint8Array} Same bytes.
     */
    parseText(bytes) {
        return ServiceCoreImage.parseText(bytes);
    },

    /**
     * Serializes image to text.
     *
     * @param {Uint8Array} bytes Input bytes.
     * @returns {Uint8Array} Same bytes.
     */
    stringifyText(bytes) {
        return ServiceCoreImage.stringifyText(bytes);
    },

    /**
     * Downloads image bytes from a URL.
     *
     * @param {Soup.Session} httpSession The HTTP session to use.
     * @param {string} url Image URL.
     * @returns {Promise<{bytes: Uint8Array, contentType: string}|null>} Result object or null on error.
     */
    download(httpSession, url) {
        return ServiceCoreImage.download(httpSession, url);
    },

    /**
     * Computes a SHA256 hash of image bytes.
     *
     * @param {Uint8Array} bytes Image bytes.
     * @returns {string|null} Hash string or null.
     */
    hash(bytes) {
        return ServiceCoreImage.hash(bytes);
    },

    /**
     * Gets the MIME type from a filename extension.
     *
     * @param {string} filename Filename with extension.
     * @returns {string} MIME type.
     */
    getMimeType(filename) {
        return ServiceCoreImage.getMimeType(filename);
    },

    /**
     * Gets the file extension from a MIME type.
     *
     * @param {string} mimetype MIME type.
     * @returns {string} File extension without dot.
     */
    getExtension(mimetype) {
        return ServiceCoreImage.getExtension(mimetype);
    },

    /**
     * Reads an image file from disk.
     *
     * @param {string} path Absolute path to the file.
     * @returns {Promise<Uint8Array|null>} Image bytes or null.
     */
    async readFile(path) {
        const bytes = await ServiceStorageFile.read(path);
        return ServiceCoreImage.parseBytes(bytes);
    },

    /**
     * Writes an image file to disk.
     *
     * @param {string} path Absolute path to the file.
     * @param {Uint8Array} bytes Image bytes to write.
     * @returns {Promise<boolean>} True if successful.
     */
    async writeFile(path, bytes) {
        const encoded = ServiceCoreImage.stringifyBytes(bytes);
        if (!encoded) return false;
        return ServiceStorageFile.write(path, encoded);
    },

    /**
     * Reads an image resource from a GResource bundle.
     *
     * @param {string} uri Full resource URI.
     * @returns {Promise<Uint8Array|null>} Image bytes or null.
     */
    async readResource(uri) {
        const bytes = await ServiceStorageResource.read(uri);
        return ServiceCoreImage.parseBytes(bytes);
    },

    /**
     * Reads an image resource synchronously from a GResource bundle.
     *
     * @param {string} uri Full resource URI or resource path.
     * @returns {Uint8Array|null} Image bytes or null.
     */
    readResourceSync(uri) {
        const bytes = ServiceStorageResource.readSync(uri);
        return ServiceCoreImage.parseBytes(bytes);
    },

    /**
     * Helper to load a Gio.Icon from path.
     *
     * @param {string} path Absolute path to the icon file.
     * @returns {Gio.Icon} Gio.Icon instance.
     */
    loadIcon(path) {
        if (!path) return null;
        const file = Gio.File.new_for_path(path);
        return new Gio.FileIcon({ file });
    },

    /**
     * Synchronously ensure an image preview file exists on disk.
     *
     * @param {string} sourcePath Path to the original image file.
     * @param {string|null} previewPath Expected path for the preview file.
     * @param {number} size Target size for scaling.
     * @returns {boolean} True if the preview is ready, false otherwise.
     */
    ensurePreview(sourcePath, previewPath, size) {
        if (!sourcePath) return false;
        try {
            if (previewPath && ServiceStorageFile.existsSync(previewPath)) {
                return true;
            }

            if (!ServiceStorageFile.existsSync(sourcePath)) {
                return false;
            }

            const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(sourcePath, size, size, true);
            if (!pixbuf) return false;

            if (previewPath) {
                const previewFile = Gio.File.new_for_path(previewPath);
                const parent = previewFile.get_parent();
                if (parent && !parent.query_exists(null)) {
                    parent.make_directory_with_parents(null);
                }

                pixbuf.savev(previewPath, 'png', [], []);
            }
            return true;
        } catch (e) {
            Logger.warn(`ServiceIOImage.ensurePreview failed: ${e.message}`);
            return false;
        }
    },

    /**
     * Asynchronously ensure an image preview file exists on disk.
     *
     * @param {string} sourcePath Path to the original image file.
     * @param {string|null} previewPath Expected path for the preview file.
     * @param {number} size Target size for scaling.
     * @param {Gio.Cancellable} [cancellable] Cancellable.
     * @returns {Promise<boolean>} True if the preview is ready, false otherwise.
     */
    async ensurePreviewAsync(sourcePath, previewPath, size, cancellable = null) {
        if (!sourcePath) return false;

        try {
            if (cancellable && cancellable.is_cancelled()) return false;

            if (previewPath) {
                const previewExists = await ServiceStorageFile.exists(previewPath);
                if (previewExists) return true;
            }

            const sourceExists = await ServiceStorageFile.exists(sourcePath);
            if (!sourceExists || (cancellable && cancellable.is_cancelled())) return false;

            const file = Gio.File.new_for_path(sourcePath);
            const pixbuf = await new Promise((resolve, reject) => {
                file.read_async(GLib.PRIORITY_DEFAULT, cancellable, (fileSource, fileResult) => {
                    try {
                        const stream = fileSource.read_finish(fileResult);
                        GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(stream, size, size, true, cancellable, (pixbufSource, pixbufResult) => {
                            try {
                                const pb = GdkPixbuf.Pixbuf.new_from_stream_finish(pixbufResult);
                                resolve(pb);
                            } catch (e) {
                                reject(e);
                            } finally {
                                stream.close(null);
                            }
                        });
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            if (!pixbuf) return false;

            if (previewPath && (!cancellable || !cancellable.is_cancelled())) {
                const previewFile = Gio.File.new_for_path(previewPath);
                const parent = previewFile.get_parent();
                if (parent && !parent.query_exists(null)) {
                    parent.make_directory_with_parents(null);
                }

                const outputStream = await new Promise((resolve, reject) => {
                    previewFile.replace_async(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, GLib.PRIORITY_DEFAULT, cancellable, (source, res) => {
                        try {
                            resolve(source.replace_finish(res));
                        } catch (e) {
                            reject(e);
                        }
                    });
                });

                await new Promise((resolve, reject) => {
                    pixbuf.save_to_streamv_async(outputStream, 'png', [], [], cancellable, (source, res) => {
                        try {
                            source.save_to_stream_finish(res);
                            resolve();
                        } catch (e) {
                            reject(e);
                        } finally {
                            outputStream.close(null);
                        }
                    });
                });
            }

            return true;
        } catch (e) {
            if (!e.matches || !e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                Logger.warn(`ServiceIOImage.ensurePreviewAsync failed: ${e.message}`);
            }
            return false;
        }
    },
};
