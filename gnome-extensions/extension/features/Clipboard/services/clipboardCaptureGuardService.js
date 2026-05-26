import { ProcessorUtils } from '../utilities/clipboardProcessorUtils.js';

// Configuration
const DEFAULT_TTL_MS = 5000;
const MAX_BLOCKED_HASHES = 50;

/**
 * ClipboardCaptureGuardService
 *
 * Stores short-lived hash blocks to suppress immediate re-capture.
 */
export class ClipboardCaptureGuardService {
    // ========================================================================
    // Initialization
    // ========================================================================

    /**
     * Initialize the capture guard service.
     *
     * @param {number} ttlMs Time to live in milliseconds.
     * @param {number} maxHashes Maximum number of blocked hashes to store.
     */
    constructor(ttlMs = DEFAULT_TTL_MS, maxHashes = MAX_BLOCKED_HASHES) {
        this._ttlMs = ttlMs;
        this._maxHashes = maxHashes;
        this._hashExpiry = new Map();
    }

    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Check whether a hash is currently blocked.
     *
     * @param {string} hash Hash to verify.
     * @returns {boolean} True if the hash is blocked.
     */
    shouldBlockHash(hash) {
        if (!hash) return false;

        const expiry = this._hashExpiry.get(hash);
        if (!expiry) return false;

        if (Date.now() >= expiry) {
            this._hashExpiry.delete(hash);
            return false;
        }

        return true;
    }

    /**
     * Register a hash to be blocked for the TTL window.
     *
     * @param {string} hash Hash to block.
     * @param {number} ttlMs Time to live for this entry.
     */
    registerHash(hash, ttlMs = this._ttlMs) {
        if (!hash) return;

        this._hashExpiry.set(hash, Date.now() + ttlMs);

        if (this._hashExpiry.size > this._maxHashes) {
            const oldestKey = this._hashExpiry.keys().next().value;
            if (oldestKey !== undefined) {
                this._hashExpiry.delete(oldestKey);
            }
        }
    }

    /**
     * Convenience registration for text values.
     *
     * @param {string} text Text to hash and register.
     * @param {number} ttlMs Time to live for this entry.
     */
    registerText(text, ttlMs = this._ttlMs) {
        if (!text) return;
        const hash = ProcessorUtils.computeHashForString(text);
        this.registerHash(hash, ttlMs);
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    /**
     * Clear all suppression entries.
     */
    destroy() {
        this._hashExpiry.clear();
    }
}
