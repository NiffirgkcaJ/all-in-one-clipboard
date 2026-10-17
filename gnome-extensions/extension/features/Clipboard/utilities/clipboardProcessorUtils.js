import GLib from 'gi://GLib';

// Configuration
const HASH_SAMPLING_THRESHOLD = 1024 * 1024;
const HASH_SAMPLING_SIZE = 4096;

/**
 * ProcessorUtils
 *
 * Utility functions for clipboard processors.
 */
export class ProcessorUtils {
    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Compute hash for a string with sampling for large content.
     *
     * @param {string} text Text to hash.
     * @returns {string} SHA256 hash.
     */
    static computeHashForString(text) {
        if (!text) return '';

        // For massive strings, sample to avoid freezing UI.
        if (text.length > HASH_SAMPLING_THRESHOLD) {
            const head = text.substring(0, HASH_SAMPLING_SIZE);
            const tail = text.substring(text.length - HASH_SAMPLING_SIZE);
            const sample = `${head}:${text.length}:${tail}`;
            return GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, sample, -1);
        }

        return GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, text, -1);
    }

    /**
     * Compute hash for binary data.
     *
     * @param {Uint8Array} bytes Data to hash.
     * @returns {string} SHA256 hash.
     */
    static computeHashForData(bytes) {
        return GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, bytes);
    }

    /**
     * Generate a random UUID.
     *
     * @returns {string} UUID string.
     */
    static generateUUID() {
        return GLib.uuid_string_random();
    }

    /**
     * Get current Unix timestamp in seconds.
     *
     * @returns {number} Timestamp.
     */
    static getCurrentTimestamp() {
        return Math.floor(Date.now() / 1000);
    }

    /**
     * Truncate text content strictly to a maximum line count.
     *
     * @param {string} text Raw text content.
     * @param {number} maxLines Maximum lines allowed.
     * @returns {string} Truncated text content.
     */
    static clampLines(text, maxLines) {
        if (!text || maxLines <= 0) {
            return '';
        }

        const clean = text.replace(/\r?\n+$/, '');
        const lines = clean.split('\n');
        if (lines.length <= maxLines) {
            return clean;
        }

        return lines.slice(0, maxLines).join('\n');
    }

    /**
     * Count the non-empty-ending lines in rendered text.
     *
     * @param {string} text Rendered text content.
     * @returns {number} Number of rendered lines.
     */
    static getLineCount(text) {
        if (!text) return 1;
        return text.replace(/\r?\n+$/, '').split(/\r?\n/).length;
    }
}
