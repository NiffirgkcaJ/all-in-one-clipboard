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
