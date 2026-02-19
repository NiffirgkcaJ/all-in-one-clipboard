import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

import { GifProvider } from '../constants/gifConstants.js';

/**
 * Custom error class for Provider-specific errors
 */
class GifProviderError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'GifProviderError';
        this.details = details;
    }
}

/**
 * GifGenericProvider
 *
 * A configuration-driven provider that can interface with any JSON-based GIF API.
 * It uses a JSON definition object to map internal method calls to specific API endpoints and response formats.
 */
export class GifGenericProvider {
    /**
     * @param {Object} definition - The parsed JSON configuration for this provider
     * @param {Soup.Session} httpSession - Shared HTTP session
     * @param {Object} settings - Extension settings to retrieve API keys
     */
    constructor(definition, httpSession, settings) {
        this._def = definition;
        this._httpSession = httpSession;
        this._settings = settings;

        if (!this._def.base_url || !this._def.endpoints) {
            throw new Error(`Invalid provider definition for ${this._def.name}: missing base_url or endpoints`);
        }
    }

    get id() {
        return this._def.id;
    }

    get name() {
        return this._def.name;
    }

    /**
     * Search for GIFs
     * @param {string} query
     * @param {string|number|null} offset
     * @param {Gio.Cancellable|null} [cancellable=null]
     * @returns {Promise<{results: Array, next_offset: string|number|null}>}
     */
    async search(query, offset = null, cancellable = null) {
        if (!this._def.endpoints.search) {
            return { results: [], next_offset: null };
        }

        const url = this._buildUrl(this._def.endpoints.search, {
            query: query,
            offset: offset,
        });

        const json = await this._fetch(url, cancellable);
        return this._parseResponse(json);
    }

    /**
     * Get Trending GIFs
     * @param {string|number|null} offset
     * @param {Gio.Cancellable|null} [cancellable=null]
     * @returns {Promise<{results: Array, next_offset: string|number|null}>}
     */
    async getTrending(offset = null, cancellable = null) {
        if (!this._def.endpoints.trending) {
            return { results: [], next_offset: null };
        }

        const url = this._buildUrl(this._def.endpoints.trending, {
            offset: offset,
        });

        const json = await this._fetch(url, cancellable);
        return this._parseResponse(json);
    }

    /**
     * Get Categories
     * @param {Gio.Cancellable|null} [cancellable=null]
     * @returns {Promise<Array<{name: string, keyword: string}>>}
     */
    async getCategories(cancellable = null) {
        if (!this._def.endpoints.categories) {
            return [];
        }

        const url = this._buildUrl(this._def.endpoints.categories, {}, { skipDefaultParams: true });

        try {
            const json = await this._fetch(url, cancellable);
            return this._parseCategories(json);
        } catch (e) {
            console.warn(`[AIO-Clipboard] Failed to fetch categories: ${e.message}`);
            return [];
        }
    }

    // ========================================================================
    // Internal Logic
    // ========================================================================

    /**
     * Constructs the full API URL suitable for Soup
     * @param {string} endpointPath
     * @param {Object} internalParams - { query, offset, limit }
     * @param {Object} [options={}] - { skipDefaultParams: boolean }
     * @returns {string} Full URL
     */
    _buildUrl(endpointPath, internalParams, options = {}) {
        const queryParams = [];
        const keyValue = this._settings.get_string('gif-custom-api-key');
        const useProxy = !keyValue && this._def.proxy_url;
        let url = (useProxy ? this._def.proxy_url : this._def.base_url) + endpointPath;

        if (!options.skipDefaultParams && this._def.default_params) {
            for (const [key, value] of Object.entries(this._def.default_params)) {
                queryParams.push(`${key}=${encodeURIComponent(value)}`);
            }
        }

        if (!useProxy) {
            if (this._def.api_key_in_path) {
                url = url.replace('{api_key}', keyValue || '');
            } else if (keyValue && this._def.params.api_key) {
                queryParams.push(`${this._def.params.api_key}=${encodeURIComponent(keyValue)}`);
            }
        }

        if (internalParams.query && this._def.params.query) {
            const val = internalParams.query.trim().replace(/\s+/g, '+');
            queryParams.push(`${this._def.params.query}=${val}`);
        }

        if (internalParams.offset !== null && internalParams.offset !== undefined && this._def.params.offset) {
            queryParams.push(`${this._def.params.offset}=${internalParams.offset}`);
        }

        const limit = this._def.default_limit || GifProvider.DEFAULT_RESULT_LIMIT;
        if (this._def.params.limit) {
            queryParams.push(`${this._def.params.limit}=${limit}`);
        }

        if (queryParams.length > 0) {
            url += '?' + queryParams.join('&');
        }

        return url;
    }

    /**
     * Execute HTTP request with retry for transient errors.
     * Retries on 5xx and network errors with exponential backoff.
     *
     * @param {string} url
     * @param {Gio.Cancellable|null} [cancellable=null]
     * @returns {Promise<Object>} JSON response
     */
    async _fetch(url, cancellable = null) {
        return this._fetchWithRetry(url, cancellable, 0);
    }

    /**
     * Recursive retry wrapper for HTTP requests.
     *
     * @param {string} url
     * @param {Gio.Cancellable|null} cancellable
     * @param {number} attempt - Current attempt (0-indexed)
     * @returns {Promise<Object>} JSON response
     */
    async _fetchWithRetry(url, cancellable, attempt) {
        const maxRetries = GifProvider.MAX_RETRIES;
        const baseDelayMs = GifProvider.RETRY_BASE_DELAY_MS;

        try {
            return await this._fetchOnce(url, cancellable);
        } catch (e) {
            const isRetryable = e.details?.status >= GifProvider.SERVER_ERROR_THRESHOLD || !e.details?.status;

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
     * Execute a single HTTP request.
     *
     * @param {string} url
     * @param {Gio.Cancellable|null} [cancellable=null]
     * @returns {Promise<Object>} JSON response
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
                    reject(new GifProviderError(`HTTP ${status}`, { status }));
                    return;
                }
                try {
                    resolve(source.send_and_read_finish(res));
                } catch (e) {
                    if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                        reject(e);
                    } else {
                        reject(new GifProviderError(e.message));
                    }
                }
            });
        });

        if (!bytes) throw new GifProviderError('No data received');
        return JSON.parse(new TextDecoder('utf-8').decode(bytes.get_data()));
    }

    /**
     * Parse the JSON response based on response_map
     * @param {Object} json
     * @returns {Object} { results, next_offset }
     */
    _parseResponse(json) {
        const map = this._def.response_map;
        const rawList = this._getValueByPath(json, map.results);
        if (!Array.isArray(rawList)) {
            return { results: [], next_offset: null };
        }

        let nextOffset = null;
        if (map.next_offset) {
            nextOffset = this._getValueByPath(json, map.next_offset);
        }

        const results = rawList
            .map((item) => {
                const mapped = {};
                mapped.id = this._getValueByPath(item, map.item.id);
                mapped.description = this._getValueByPath(item, map.item.description) || '';
                mapped.preview_url = this._getValueByPath(item, map.item.preview_url);
                mapped.full_url = this._getValueByPath(item, map.item.full_url);
                mapped.width = parseInt(this._getValueByPath(item, map.item.width), 10);
                mapped.height = parseInt(this._getValueByPath(item, map.item.height), 10);
                return mapped;
            })
            .filter((item) => item.preview_url && item.full_url && item.width > 0);

        return { results, next_offset: nextOffset };
    }

    /**
     * Parse the categories response
     * @param {Object} json
     * @returns {Array}
     */
    _parseCategories(json) {
        const map = this._def.response_map.categories;
        if (!map) return [];

        const rawList = this._getValueByPath(json, map.root);
        if (!Array.isArray(rawList)) return [];

        return rawList
            .map((item) => ({
                name: this._getValueByPath(item, map.item.name),
                keyword: this._getValueByPath(item, map.item.keyword),
                image: this._getValueByPath(item, map.item.image),
            }))
            .filter((c) => c.name && c.keyword);
    }

    /**
     * Helper to traverse object by dot notation
     * @param {Object} obj
     * @param {string} path
     */
    _getValueByPath(obj, path) {
        if (!path || !obj) return null;
        return path.split('.').reduce((acc, part) => acc && acc[part], obj);
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    /**
     * Cleanup resources
     */
    destroy() {
        if (this._retryTimeoutId) {
            GLib.source_remove(this._retryTimeoutId);
            this._retryTimeoutId = 0;
        }
    }
}
