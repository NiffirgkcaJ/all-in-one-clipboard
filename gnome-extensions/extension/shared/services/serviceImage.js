import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

/**
 * Image encoding and decoding service.
 * Works with raw bytes for integration with File operations.
 */
export const ServiceImage = {
    /**
     * Encodes image bytes for storage.
     * @param {Uint8Array} bytes - Raw image bytes
     * @returns {Uint8Array} Encoded image bytes
     */
    encode(bytes) {
        return this._encrypt(bytes);
    },

    /**
     * Decodes image bytes from storage.
     * @param {Uint8Array} bytes - Stored image bytes
     * @returns {Uint8Array} Decoded image bytes
     */
    decode(bytes) {
        return this._decrypt(bytes);
    },

    /**
     * Encrypts image bytes for storage.
     * @param {Uint8Array} bytes - Raw image bytes
     * @returns {Uint8Array} Encoded image bytes
     */
    _encrypt(bytes) {
        if (!bytes) return null;
        return bytes;
    },

    /**
     * Decrypts image bytes from storage.
     * @param {Uint8Array} bytes - Stored image bytes
     * @returns {Uint8Array} Decoded image bytes
     */
    _decrypt(bytes) {
        if (!bytes) return null;
        return bytes;
    },

    /**
     * Downloads image bytes from a URL.
     * @param {Soup.Session} httpSession - The HTTP session to use
     * @param {string} url - Image URL
     * @returns {Promise<{bytes: Uint8Array, contentType: string}|null>} Result object or null on error
     */
    async download(httpSession, url) {
        if (!httpSession || !url) return null;

        try {
            let uri;
            try {
                uri = GLib.Uri.parse(url, GLib.UriFlags.NONE);
            } catch (e) {
                console.warn(`[AIO-Clipboard] Invalid URI '${url}': ${e.message}`);
                return null;
            }

            if (!uri) return null;

            const scheme = uri.get_scheme();
            if (scheme !== 'http' && scheme !== 'https') return null;

            const host = uri.get_host();
            if (!host) return null;

            const message = new Soup.Message({
                method: 'GET',
                uri: uri,
            });

            return await new Promise((resolve, reject) => {
                httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (sess, res) => {
                    if (message.get_status() >= 300) {
                        reject(new Error(`HTTP Error ${message.get_status()}`));
                        return;
                    }
                    try {
                        const gbytes = sess.send_and_read_finish(res);
                        const bytes = gbytes?.get_data() || null;
                        const contentType = message.get_response_headers().get_one('Content-Type') || '';
                        resolve({ bytes, contentType });
                    } catch (e) {
                        reject(e);
                    }
                });
            });
        } catch (e) {
            console.warn(`[AIO-Clipboard] ServiceImage.download failed for '${url}': ${e.message}`);
            return null;
        }
    },

    /**
     * Computes a hash of image bytes.
     * @param {Uint8Array} bytes - Image bytes
     * @returns {string|null} SHA256 hash or null
     */
    hash(bytes) {
        if (!bytes) return null;
        try {
            const checksum = new GLib.Checksum(GLib.ChecksumType.SHA256);
            checksum.update(bytes);
            return checksum.get_string();
        } catch (e) {
            console.warn(`[AIO-Clipboard] ServiceImage.hash failed: ${e.message}`);
            return null;
        }
    },

    /**
     * Gets MIME type from filename extension.
     * @param {string} filename - Filename with extension
     * @returns {string} MIME type
     */
    getMimeType(filename) {
        if (!filename) return 'application/octet-stream';
        const lower = filename.toLowerCase();
        if (lower.endsWith('.png')) return 'image/png';
        if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
        if (lower.endsWith('.gif')) return 'image/gif';
        if (lower.endsWith('.webp')) return 'image/webp';
        if (lower.endsWith('.svg')) return 'image/svg+xml';
        return 'application/octet-stream';
    },

    /**
     * Gets file extension from MIME type.
     * @param {string} mimetype - MIME type
     * @returns {string} File extension without dot
     */
    getExtension(mimetype) {
        if (!mimetype) return 'bin';
        const type = mimetype.toLowerCase();
        if (type === 'image/png') return 'png';
        if (type === 'image/jpeg' || type === 'image/jpg') return 'jpg';
        if (type === 'image/gif') return 'gif';
        if (type === 'image/webp') return 'webp';
        if (type === 'image/svg+xml') return 'svg';
        return type.split('/')[1] || 'bin';
    },
};
