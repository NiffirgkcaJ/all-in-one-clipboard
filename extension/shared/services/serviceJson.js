/**
 * JSON parsing and serialization service.
 * Works with raw bytes for integration with File/Resource.
 */
export const ServiceJson = {
    /**
     * Encodes bytes for storage.
     * @param {Uint8Array} bytes - Raw bytes
     * @returns {Uint8Array} Encoded bytes
     */
    encode(bytes) {
        return this._encrypt(bytes);
    },

    /**
     * Decodes bytes from storage.
     * @param {Uint8Array} bytes - Stored bytes
     * @returns {Uint8Array} Decoded bytes
     */
    decode(bytes) {
        return this._decrypt(bytes);
    },

    /**
     * Encrypts bytes for storage.
     * @param {Uint8Array} bytes - Raw bytes
     * @returns {Uint8Array} Encoded bytes
     */
    _encrypt(bytes) {
        if (!bytes) return null;
        return bytes;
    },

    /**
     * Decrypts bytes from storage.
     * @param {Uint8Array} bytes - Stored bytes
     * @returns {Uint8Array} Decoded bytes
     */
    _decrypt(bytes) {
        if (!bytes) return null;
        return bytes;
    },

    /**
     * Parses bytes as JSON.
     * @param {Uint8Array} bytes - Raw bytes to parse
     * @returns {any|null} Parsed object or null on error
     */
    parse(bytes) {
        if (!bytes) return null;
        try {
            const decrypted = this.decode(bytes);
            const decoder = new TextDecoder('utf-8');
            return JSON.parse(decoder.decode(decrypted));
        } catch (e) {
            console.warn(`[AIO-Clipboard] ServiceJson.parse failed: ${e.message}`);
            return null;
        }
    },

    /**
     * Serializes an object to JSON bytes.
     * @param {any} data - Object to serialize
     * @returns {Uint8Array|null} JSON bytes or null on error
     */
    stringify(data) {
        try {
            const encoder = new TextEncoder();
            const bytes = encoder.encode(JSON.stringify(data));
            return this.encode(bytes);
        } catch (e) {
            console.error(`[AIO-Clipboard] ServiceJson.stringify failed: ${e.message}`);
            return null;
        }
    },
};
