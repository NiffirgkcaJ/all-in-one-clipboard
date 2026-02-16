import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

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

        // Basic validation
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
     * @returns {Promise<{results: Array, next_offset: string|number|null}>}
     */
    async search(query, offset = null) {
        if (!this._def.endpoints.search) {
            return { results: [], next_offset: null };
        }

        const url = this._buildUrl(this._def.endpoints.search, {
            query: query,
            offset: offset,
        });

        const json = await this._fetch(url);
        return this._parseResponse(json);
    }

    /**
     * Get Trending GIFs
     * @param {string|number|null} offset
     * @returns {Promise<{results: Array, next_offset: string|number|null}>}
     */
    async getTrending(offset = null) {
        if (!this._def.endpoints.trending) {
            return { results: [], next_offset: null };
        }

        const url = this._buildUrl(this._def.endpoints.trending, {
            offset: offset,
        });

        const json = await this._fetch(url);
        return this._parseResponse(json);
    }

    /**
     * Get Categories
     * @returns {Promise<Array<{name: string, keyword: string}>>}
     */
    async getCategories() {
        if (!this._def.endpoints.categories) {
            return [];
        }

        const url = this._buildUrl(this._def.endpoints.categories, {}, { skipDefaultParams: true });

        try {
            const json = await this._fetch(url);
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

        // Determine the API key and base URL
        const keyValue = this._settings.get_string('gif-custom-api-key');
        const useProxy = !keyValue && this._def.proxy_url;
        let url = (useProxy ? this._def.proxy_url : this._def.base_url) + endpointPath;

        // Add Default Parameters
        if (!options.skipDefaultParams && this._def.default_params) {
            for (const [key, value] of Object.entries(this._def.default_params)) {
                queryParams.push(`${key}=${encodeURIComponent(value)}`);
            }
        }

        // Add API Key when using the direct URL as proxy injects its own
        if (!useProxy) {
            if (this._def.api_key_in_path) {
                url = url.replace('{api_key}', keyValue || '');
            } else if (keyValue && this._def.params.api_key) {
                queryParams.push(`${this._def.params.api_key}=${encodeURIComponent(keyValue)}`);
            }
        }

        // Map Internal Params to API Params
        if (internalParams.query && this._def.params.query) {
            const val = internalParams.query.trim().replace(/\s+/g, '+');
            queryParams.push(`${this._def.params.query}=${val}`);
        }

        if (internalParams.offset !== null && internalParams.offset !== undefined && this._def.params.offset) {
            queryParams.push(`${this._def.params.offset}=${internalParams.offset}`);
        }

        // Hardcoded limit for now, or from config
        const limit = 20;
        if (this._def.params.limit) {
            queryParams.push(`${this._def.params.limit}=${limit}`);
        }

        if (queryParams.length > 0) {
            url += '?' + queryParams.join('&');
        }

        return url;
    }

    /**
     * Execute HTTP request
     * @param {string} url
     * @returns {Promise<Object>} JSON response
     */
    async _fetch(url) {
        const message = new Soup.Message({
            method: 'GET',
            uri: GLib.Uri.parse(url, GLib.UriFlags.NONE),
        });

        const bytes = await new Promise((resolve, reject) => {
            this._httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (source, res) => {
                if (message.get_status() >= 300) {
                    reject(new GifProviderError(`HTTP ${message.get_status()}`));
                    return;
                }
                try {
                    resolve(source.send_and_read_finish(res));
                } catch (e) {
                    reject(new GifProviderError(e.message));
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

        // Extract List
        const rawList = this._getValueByPath(json, map.results);
        if (!Array.isArray(rawList)) {
            return { results: [], next_offset: null };
        }

        // Extract Next Offset
        let nextOffset = null;
        if (map.next_offset) {
            nextOffset = this._getValueByPath(json, map.next_offset);
        }

        // Map Items
        const results = rawList
            .map((item) => {
                const mapped = {};
                // Start with ID
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
}
