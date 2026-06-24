import { Logger } from '../../../shared/utilities/utilityLogger.js';

import { GifProvider } from '../constants/gifConstants.js';

/**
 * GifGenericProvider
 *
 * A configuration-driven provider that can interface with any JSON-based GIF API.
 * It uses a JSON definition object to map internal method calls to specific API endpoints and response formats.
 */
export class GifGenericProvider {
    // ========================================================================
    // Initialization
    // ========================================================================

    /**
     * @param {Object} definition The parsed JSON configuration for this provider.
     * @param {GifHttpService} httpService The shared HTTP service.
     * @param {Object} settings Extension settings to retrieve API keys.
     */
    constructor(definition, httpService, settings) {
        this._def = definition;
        this._httpService = httpService;
        this._settings = settings;

        if (!this._def.base_url || !this._def.endpoints) {
            throw new Error(`Invalid provider definition for ${this._def.name}: missing base_url or endpoints`);
        }
    }

    /**
     * Returns the ID of the provider.
     * @returns {string} The provider ID.
     */
    get id() {
        return this._def.id;
    }

    /**
     * Returns the name of the provider.
     * @returns {string} The provider name.
     */
    get name() {
        return this._def.name;
    }

    /**
     * Search for GIFs.
     * @param {string} query The search query.
     * @param {string|number|null} offset Pagination offset.
     * @param {Gio.Cancellable|null} [cancellable=null] Optional cancellable.
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

        const json = await this._httpService.fetchJson(url, cancellable);
        return this._parseResponse(json);
    }

    /**
     * Get Trending GIFs.
     * @param {string|number|null} offset Pagination offset.
     * @param {Gio.Cancellable|null} [cancellable=null] Optional cancellable.
     * @returns {Promise<{results: Array, next_offset: string|number|null}>}
     */
    async getTrending(offset = null, cancellable = null) {
        if (!this._def.endpoints.trending) {
            return { results: [], next_offset: null };
        }

        const url = this._buildUrl(this._def.endpoints.trending, {
            offset: offset,
        });

        const json = await this._httpService.fetchJson(url, cancellable);
        return this._parseResponse(json);
    }

    /**
     * Get Categories.
     * @param {Gio.Cancellable|null} [cancellable=null] Optional cancellable.
     * @returns {Promise<Array<{name: string, keyword: string}>>}
     */
    async getCategories(cancellable = null) {
        if (!this._def.endpoints.categories) {
            return [];
        }

        const url = this._buildUrl(this._def.endpoints.categories, {}, { skipDefaultParams: true });

        try {
            const json = await this._httpService.fetchJson(url, cancellable);
            return this._parseCategories(json);
        } catch (e) {
            Logger.warn(`Failed to fetch categories: ${e.message}`);
            return [];
        }
    }

    // ========================================================================
    // URL Construction
    // ========================================================================

    /**
     * Constructs the full API URL suitable for Soup.
     * @param {string} endpointPath The endpoint path.
     * @param {Object} internalParams Internal parameters like query, offset.
     * @param {Object} [options={}] Additional options.
     * @returns {string} Full URL.
     * @private
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

        // API Key
        if (!useProxy) {
            if (this._def.api_key_in_path) {
                url = url.replace('{api_key}', keyValue || '');
            } else if (keyValue && this._def.params.api_key) {
                queryParams.push(`${this._def.params.api_key}=${encodeURIComponent(keyValue)}`);
            }
        }

        // Query
        if (internalParams.query && this._def.params.query) {
            const val = internalParams.query.trim().replace(/\s+/g, '+');
            queryParams.push(`${this._def.params.query}=${val}`);
        }

        // Offset
        if (internalParams.offset !== null && internalParams.offset !== undefined && this._def.params.offset) {
            queryParams.push(`${this._def.params.offset}=${internalParams.offset}`);
        }

        // Limit
        const limit = this._def.default_limit || GifProvider.DEFAULT_RESULT_LIMIT;
        if (this._def.params.limit) {
            queryParams.push(`${this._def.params.limit}=${limit}`);
        }

        if (queryParams.length > 0) {
            url += '?' + queryParams.join('&');
        }

        return url;
    }

    // ========================================================================
    // Response Parsing
    // ========================================================================

    /**
     * Parse the JSON response based on response_map.
     * @param {Object} json Raw JSON response.
     * @returns {Object} Normalized results with next_offset.
     * @private
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
     * Parse the categories response.
     * @param {Object} json Raw JSON response.
     * @returns {Array} Parsed categories.
     * @private
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
     * Helper to traverse object by dot notation.
     * @param {Object} obj Source object.
     * @param {string} path Dot-separated path string.
     * @returns {*} Resolved value or null.
     * @private
     */
    _getValueByPath(obj, path) {
        if (!path || !obj) return null;
        return path.split('.').reduce((acc, part) => acc && acc[part], obj);
    }

    /**
     * Release provider references.
     */
    destroy() {
        this._def = null;
        this._httpService = null;
        this._settings = null;
    }
}
