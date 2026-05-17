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
};
