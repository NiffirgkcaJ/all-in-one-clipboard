import { ServiceCoreJson } from './serviceCoreJson.js';
import { ServiceStorageFile } from './serviceStorageFile.js';
import { ServiceStorageResource } from './serviceStorageResource.js';

/**
 * JSON IO service for file and resource reads/writes.
 */
export const ServiceIOJson = {
    /**
     * Encodes bytes for storage.
     *
     * @param {Uint8Array} bytes Raw bytes.
     * @returns {Uint8Array} Encoded bytes.
     */
    encode(bytes) {
        return ServiceCoreJson.encode(bytes);
    },

    /**
     * Decodes bytes from storage.
     *
     * @param {Uint8Array} bytes Stored bytes.
     * @returns {Uint8Array} Decoded bytes.
     */
    decode(bytes) {
        return ServiceCoreJson.decode(bytes);
    },

    /**
     * Parses bytes as JSON.
     *
     * @param {Uint8Array} bytes Raw bytes to parse.
     * @returns {any|null} Parsed object or null on error.
     */
    parseBytes(bytes) {
        return ServiceCoreJson.parseBytes(bytes);
    },

    /**
     * Serializes JSON to bytes.
     *
     * @param {any} data Object to serialize.
     * @returns {Uint8Array|null} JSON bytes or null on error.
     */
    stringifyBytes(data) {
        return ServiceCoreJson.stringifyBytes(data);
    },

    /**
     * Parses text as JSON.
     *
     * @param {string} text JSON string to parse.
     * @returns {any|null} Parsed object or null on error.
     */
    parseText(text) {
        return ServiceCoreJson.parseText(text);
    },

    /**
     * Serializes JSON to text.
     *
     * @param {any} data Object to serialize.
     * @param {number|string} [space] Indentation for pretty printing.
     * @returns {string|null} JSON text or null on error.
     */
    stringifyText(data, space) {
        return ServiceCoreJson.stringifyText(data, space);
    },

    /**
     * Reads a JSON file from disk.
     *
     * @param {string} path Absolute path to the file.
     * @returns {Promise<any|null>} Parsed object or null.
     */
    async readFile(path) {
        const bytes = await ServiceStorageFile.read(path);
        return ServiceCoreJson.parseBytes(bytes);
    },

    /**
     * Writes a JSON file to disk.
     *
     * @param {string} path Absolute path to the file.
     * @param {any} data Object to serialize and write.
     * @returns {Promise<boolean>} True if successful.
     */
    async writeFile(path, data) {
        const bytes = ServiceCoreJson.stringifyBytes(data);
        if (!bytes) return false;
        return ServiceStorageFile.write(path, bytes);
    },

    /**
     * Reads a JSON resource from a GResource bundle.
     *
     * @param {string} uri Full resource URI.
     * @returns {Promise<any|null>} Parsed object or null.
     */
    async readResource(uri) {
        const bytes = await ServiceStorageResource.read(uri);
        return ServiceCoreJson.parseBytes(bytes);
    },

    /**
     * Reads a JSON resource synchronously from a GResource bundle.
     *
     * @param {string} uri Full resource URI or resource path.
     * @returns {any|null} Parsed object or null.
     */
    readResourceSync(uri) {
        const bytes = ServiceStorageResource.readSync(uri);
        return ServiceCoreJson.parseBytes(bytes);
    },
};
