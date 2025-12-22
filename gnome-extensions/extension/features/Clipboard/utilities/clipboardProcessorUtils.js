import GLib from 'gi://GLib';

/**
 * Utility functions for clipboard processors
 */
export class ProcessorUtils {
    /**
     * Compute hash for a string
     * @param {string} text - Text to hash
     * @returns {string} SHA256 hash
     */
    static computeHashForString(text) {
        if (!text) return '';

        // For massive strings over 1MB, sample to avoid freezing UI
        if (text.length > 1024 * 1024) {
            const head = text.substring(0, 4096);
            const tail = text.substring(text.length - 4096);
            const sample = `${head}:${text.length}:${tail}`;
            return GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, sample, -1);
        }

        return GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, text, -1);
    }

    /**
     * Compute hash for binary data
     * @param {Uint8Array} bytes - Data to hash
     * @returns {string} SHA256 hash
     */
    static computeHashForData(bytes) {
        return GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, bytes);
    }

    /**
     * Generate a random UUID
     * @returns {string} UUID string
     */
    static generateUUID() {
        return GLib.uuid_string_random();
    }

    /**
     * Get current Unix timestamp in seconds
     * @returns {number} Timestamp
     */
    static getCurrentTimestamp() {
        return Math.floor(Date.now() / 1000);
    }
}
