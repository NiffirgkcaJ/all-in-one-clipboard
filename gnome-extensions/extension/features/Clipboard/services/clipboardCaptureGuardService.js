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
    constructor(ttlMs = DEFAULT_TTL_MS, maxHashes = MAX_BLOCKED_HASHES) {
        this._ttlMs = ttlMs;
        this._maxHashes = maxHashes;
        this._hashExpiry = new Map();
    }

    /**
     * Check whether a hash is currently blocked.
     *
     * @param {string} hash
     * @returns {boolean}
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
     * @param {string} hash
     * @param {number} ttlMs
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
     * @param {string} text
     * @param {number} ttlMs
     */
    registerText(text, ttlMs = this._ttlMs) {
        if (!text) return;
        const hash = ProcessorUtils.computeHashForString(text);
        this.registerHash(hash, ttlMs);
    }

    /**
     * Clear all suppression entries.
     */
    destroy() {
        this._hashExpiry.clear();
    }
}
