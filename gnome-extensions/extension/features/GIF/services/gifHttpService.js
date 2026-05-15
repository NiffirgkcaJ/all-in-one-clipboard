import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

import { ServiceJson } from '../../../shared/services/serviceJson.js';

import { GifProvider } from '../constants/gifConstants.js';

/**
 * Custom error class for HTTP errors.
 */
export class GifHttpError extends Error {
    /**
     * @param {string} message Error description.
     * @param {object} [details={}] Additional error context.
     */
    constructor(message, details = {}) {
        super(message);
        this.name = 'GifHttpError';
        this.details = details;
    }
}

/**
 * GifHttpService
 *
 * The unified HTTP layer for the GIF module.
 * Owns the single Soup.Session and provides JSON fetching with retry logic for transient errors.
 */
export class GifHttpService {
    // ========================================================================
    // Initialization
    // ========================================================================

    constructor() {
        this._httpSession = new Soup.Session();
        this._retryTimeoutId = 0;
    }

    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Returns the raw Soup.Session for consumers that need direct access.
     * @returns {Soup.Session}
     */
    getSession() {
        return this._httpSession;
    }

    /**
     * Fetches JSON from a URL with automatic retry on transient errors.
     * @param {string} url The URL to fetch.
     * @param {Gio.Cancellable|null} [cancellable=null] Optional cancellable.
     * @returns {Promise<Object>} Parsed JSON response.
     */
    async fetchJson(url, cancellable = null) {
        return this._fetchWithRetry(url, cancellable, 0);
    }

    // ========================================================================
    // Internal Logic
    // ========================================================================

    /**
     * Recursive retry wrapper for HTTP requests.
     * Retries on 5xx and transient network errors with exponential backoff.
     * @param {string} url The URL to fetch.
     * @param {Gio.Cancellable|null} cancellable Optional cancellable.
     * @param {number} attempt Current attempt with 0-index.
     * @returns {Promise<Object>} Parsed JSON response.
     * @private
     */
    async _fetchWithRetry(url, cancellable, attempt) {
        const maxRetries = GifProvider.MAX_RETRIES;
        const baseDelayMs = GifProvider.RETRY_BASE_DELAY_MS;

        try {
            return await this._fetchOnce(url, cancellable);
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                throw e;
            }

            const status = e.details?.status;
            const isTransientIoError = Object.keys(GifProvider.RETRY_TRANSIENT_IO_ERROR_NAMES).some((errorName) => {
                const errorCode = Gio.IOErrorEnum[errorName];
                return typeof errorCode === 'number' && e.matches?.(Gio.IOErrorEnum, errorCode);
            });
            const isRetryable = (typeof status === 'number' && status >= GifProvider.SERVER_ERROR_THRESHOLD) || isTransientIoError;

            if (!isRetryable || attempt >= maxRetries) throw e;

            const delay = baseDelayMs * Math.pow(2, attempt);
            await new Promise((r) => {
                if (this._retryTimeoutId) {
                    GLib.source_remove(this._retryTimeoutId);
                }
                this._retryTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                    r();
                    this._retryTimeoutId = 0;
                    return GLib.SOURCE_REMOVE;
                });
            });

            return this._fetchWithRetry(url, cancellable, attempt + 1);
        }
    }

    /**
     * Executes a single HTTP GET request and parses the JSON response.
     * @param {string} url The URL to fetch.
     * @param {Gio.Cancellable|null} [cancellable=null] Optional cancellable.
     * @returns {Promise<Object>} Parsed JSON response.
     * @private
     */
    async _fetchOnce(url, cancellable = null) {
        const message = new Soup.Message({
            method: 'GET',
            uri: GLib.Uri.parse(url, GLib.UriFlags.NONE),
        });

        const bytes = await new Promise((resolve, reject) => {
            this._httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable, (source, res) => {
                const status = message.get_status();
                if (status >= GifProvider.HTTP_ERROR_THRESHOLD) {
                    reject(new GifHttpError(`HTTP ${status}`, { status }));
                    return;
                }
                try {
                    resolve(source.send_and_read_finish(res));
                } catch (e) {
                    if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                        reject(e);
                    } else {
                        reject(new GifHttpError(e.message));
                    }
                }
            });
        });

        if (!bytes) throw new GifHttpError('No data received');
        const parsed = ServiceJson.parseBytes(bytes.get_data());
        if (!parsed) {
            throw new GifHttpError('Invalid JSON response');
        }
        return parsed;
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    /**
     * Clean up resources and abort any pending requests.
     */
    destroy() {
        if (this._retryTimeoutId) {
            GLib.source_remove(this._retryTimeoutId);
            this._retryTimeoutId = 0;
        }

        if (this._httpSession) {
            this._httpSession.abort();
            this._httpSession = null;
        }
    }
}
