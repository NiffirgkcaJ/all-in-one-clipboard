/**
 * Text encoding and decoding service.
 * Works with raw bytes for integration with File/Resource.
 */
export const ServiceText = {
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
     * Converts bytes to a string.
     * @param {Uint8Array} bytes - Raw bytes to convert
     * @param {string} [encoding='utf-8'] - Character encoding
     * @returns {string|null} String or null on error
     */
    fromBytes(bytes, encoding = 'utf-8') {
        if (!bytes) return null;
        try {
            const decrypted = this.decode(bytes);
            const decoder = new TextDecoder(encoding);
            return decoder.decode(decrypted);
        } catch (e) {
            console.warn(`[AIO-Clipboard] ServiceText.fromBytes failed: ${e.message}`);
            return null;
        }
    },

    /**
     * Converts a string to bytes.
     * @param {string} text - String to convert
     * @returns {Uint8Array|null} Bytes or null on error
     */
    toBytes(text) {
        if (text === null || text === undefined) return null;
        try {
            const encoder = new TextEncoder();
            const bytes = encoder.encode(text);
            return this.encode(bytes);
        } catch (e) {
            console.error(`[AIO-Clipboard] ServiceText.toBytes failed: ${e.message}`);
            return null;
        }
    },
};
