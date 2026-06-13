import { ProcessorUtils } from '../utilities/clipboardProcessorUtils.js';

// Configuration
const DEFAULT_TTL_MS = 5000;
const QUARANTINE_TTL_MS = 1000;
const MAX_BLOCKED_HASHES = 50;
const MAX_QUARANTINED_HASHES = 200;

/**
 * ClipboardCaptureGuardService
 *
 * Stores short-lived suppression hashes and long-lived quarantined hashes for blocked clipboard content.
 */
export class ClipboardCaptureGuardService {
    // ========================================================================
    // Initialization
    // ========================================================================

    /**
     * Initialize the capture guard service.
     *
     * @param {number} ttlMs Time to live in milliseconds for suppression.
     * @param {number} maxHashes Maximum number of blocked hashes to store.
     * @param {number} maxQuarantinedHashes Maximum number of quarantined hashes to store.
     */
    constructor(ttlMs = DEFAULT_TTL_MS, maxHashes = MAX_BLOCKED_HASHES, maxQuarantinedHashes = MAX_QUARANTINED_HASHES) {
        this._ttlMs = ttlMs;
        this._maxHashes = maxHashes;
        this._maxQuarantinedHashes = maxQuarantinedHashes;
        this._hashExpiry = new Map();
        this._quarantinedHashes = new Map();
        this._lastBlockedHash = null;
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
     * Decide whether a hash should be suppressed in the current capture context.
     *
     * @param {string} hash Hash to verify.
     * @param {boolean} isSafeContext Whether the current capture is in a non-blocked context.
     * @param {boolean} hasFocus Whether there is currently a focused window.
     * @param {boolean} isWindowTransitioning True if focus changed very recently.
     * @returns {boolean} True if the hash should be suppressed.
     */
    shouldSuppressHash(hash, isSafeContext = true, hasFocus = true, isWindowTransitioning = false) {
        if (!hash) return false;

        // Strictly suppress recently blocked hashes.
        const quarantineExpiry = this._quarantinedHashes.get(hash);
        if (quarantineExpiry) {
            if (Date.now() < quarantineExpiry) {
                return true;
            } else {
                this._quarantinedHashes.delete(hash);
            }
        }

        // Prevent leaks during focus transitions.
        if ((!hasFocus || isWindowTransitioning) && hash === this._lastBlockedHash) {
            return true;
        }

        const isBlocked = this.shouldBlockHash(hash);

        // Cleanse the blocked hash if the user explicitly re-copied it in a stable safe window.
        if (!isBlocked && isSafeContext && hasFocus && !isWindowTransitioning && hash === this._lastBlockedHash) {
            this._lastBlockedHash = null;
        }

        return isBlocked;
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
        this._trimOldestEntries(this._hashExpiry, this._maxHashes);
    }
    /**
     * Register a blocked hash in quarantine.
     * We avoid short-lived suppression to prevent annoying the user if they manually re-copy it in a safe context a few seconds later.
     *
     * @param {string} hash Hash to quarantine.
     */
    registerBlockedHash(hash) {
        if (!hash) return;

        this._lastBlockedHash = hash;
        this._quarantinedHashes.set(hash, Date.now() + QUARANTINE_TTL_MS);
        this._trimOldestEntries(this._quarantinedHashes, this._maxQuarantinedHashes);
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

    /**
     * Convenience registration for blocked text values.
     *
     * @param {string} text Text to hash and quarantine.
     */
    registerBlockedText(text) {
        if (!text) return;
        const hash = ProcessorUtils.computeHashForString(text);
        this.registerBlockedHash(hash);
    }

    /**
     * Trim map entries to a fixed maximum size by removing oldest items first.
     *
     * @param {Map} map Target map.
     * @param {number} maxSize Maximum allowed size.
     * @private
     */
    _trimOldestEntries(map, maxSize) {
        while (map.size > maxSize) {
            const oldestKey = map.keys().next().value;
            if (oldestKey === undefined) break;
            map.delete(oldestKey);
        }
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    /**
     * Clear all suppression entries.
     */
    destroy() {
        this._hashExpiry.clear();
        this._quarantinedHashes.clear();
    }
}
