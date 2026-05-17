import { ServiceCoreText } from './serviceCoreText.js';
import { ServiceStorageFile } from './serviceStorageFile.js';
import { ServiceStorageResource } from './serviceStorageResource.js';

/**
 * Text IO service for file and resource reads/writes.
 */
export const ServiceIOText = {
    /**
     * Encodes bytes for storage.
     *
     * @param {Uint8Array} bytes Raw bytes.
     * @returns {Uint8Array} Encoded bytes.
     */
    encode(bytes) {
        return ServiceCoreText.encode(bytes);
    },

    /**
     * Decodes bytes from storage.
     *
     * @param {Uint8Array} bytes Stored bytes.
     * @returns {Uint8Array} Decoded bytes.
     */
    decode(bytes) {
        return ServiceCoreText.decode(bytes);
    },

    /**
     * Parses bytes as text.
     *
     * @param {Uint8Array} bytes Raw bytes to convert.
     * @param {string} [encoding='utf-8'] Character encoding.
     * @returns {string|null} String or null on error.
     */
    parseBytes(bytes, encoding) {
        return ServiceCoreText.parseBytes(bytes, encoding);
    },

    /**
     * Serializes text to bytes.
     *
     * @param {string} text String to convert.
     * @returns {Uint8Array|null} Bytes or null on error.
     */
    stringifyBytes(text) {
        return ServiceCoreText.stringifyBytes(text);
    },

    /**
     * Parses text as text.
     *
     * @param {string} text Input text.
     * @returns {string} Same text.
     */
    parseText(text) {
        return ServiceCoreText.parseText(text);
    },

    /**
     * Serializes text to text.
     *
     * @param {string} text Input text.
     * @returns {string} Same text.
     */
    stringifyText(text) {
        return ServiceCoreText.stringifyText(text);
    },

    /**
     * Reads a text file from disk.
     *
     * @param {string} path Absolute path to the file.
     * @returns {Promise<string|null>} File contents or null.
     */
    async readFile(path) {
        const bytes = await ServiceStorageFile.read(path);
        return ServiceCoreText.parseBytes(bytes);
    },

    /**
     * Writes a text file to disk.
     *
     * @param {string} path Absolute path to the file.
     * @param {string} text String to write.
     * @returns {Promise<boolean>} True if successful.
     */
    async writeFile(path, text) {
        const bytes = ServiceCoreText.stringifyBytes(text);
        if (!bytes) return false;
        return ServiceStorageFile.write(path, bytes);
    },

    /**
     * Reads a text resource from a GResource bundle.
     *
     * @param {string} uri Full resource URI.
     * @returns {Promise<string|null>} Resource contents or null.
     */
    async readResource(uri) {
        const bytes = await ServiceStorageResource.read(uri);
        return ServiceCoreText.parseBytes(bytes);
    },

    /**
     * Reads a text resource synchronously from a GResource bundle.
     *
     * @param {string} uri Full resource URI or resource path.
     * @returns {string|null} Resource contents or null.
     */
    readResourceSync(uri) {
        const bytes = ServiceStorageResource.readSync(uri);
        return ServiceCoreText.parseBytes(bytes);
    },
};
