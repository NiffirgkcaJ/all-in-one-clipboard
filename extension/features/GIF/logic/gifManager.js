import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Soup from 'gi://Soup';

// GSettings keys
const GIF_PROVIDER_KEY = 'gif-provider';
const GIF_TENOR_API_KEY = 'gif-tenor-api-key';
const GIF_IMGUR_CLIENT_ID_KEY = 'gif-imgur-client-id';

const _httpSession = new Soup.Session();

/**
 * Custom error class for GifManager-specific errors
 */
class GifManagerError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'GifManagerError';
        this.details = details;
    }
}

/**
 * GifManager - Handles GIF fetching from multiple providers (Tenor, Imgur)
 *
 * Provides a unified interface for searching, trending, and categories
 * regardless of the underlying provider.
 */
export const GifManager = GObject.registerClass(
class GifManager extends GObject.Object {
    /**
     * Initialize the GIF manager
     * @param {Gio.Settings} settings - Extension settings object
     * @param {string} extensionUUID - Extension UUID for logging
     */
    _init(settings, extensionUUID) {
        super._init();
        this._settings = settings;
        this._uuid = extensionUUID;
    }

    // ===========================
    // Public API Methods
    // ===========================

    /**
     * Search for GIFs using the currently configured provider
     * @param {string} query - The search term
     * @param {string|null} nextPos - Pagination token for the next page of results
     * @returns {Promise<{results: Array, nextPos: string|null}>} Search results and next page token
     */
    async search(query, nextPos = null) {
        const provider = this._settings.get_string(GIF_PROVIDER_KEY);

        switch (provider) {
            case 'tenor':
                return this._fetchFromTenor(query, false, nextPos);

            case 'imgur':
                // Imgur uses page numbers instead of opaque tokens
                const page = nextPos ? parseInt(nextPos, 10) : 0;
                return this._fetchFromImgur(query, false, page);

            case 'none':
            default:
                return { results: [], nextPos: null };
        }
    }

    /**
     * Fetch trending GIFs from the currently configured provider
     * @param {string|null} nextPos - Pagination token for the next page
     * @returns {Promise<{results: Array, nextPos: string|null}>} Trending results and next page token
     */
    async getTrending(nextPos = null) {
        const provider = this._settings.get_string(GIF_PROVIDER_KEY);

        switch (provider) {
            case 'tenor':
                return this._fetchFromTenor(null, true, nextPos);

            case 'imgur':
                const page = nextPos ? parseInt(nextPos, 10) : 0;
                return this._fetchFromImgur(null, true, page);

            case 'none':
            default:
                return { results: [], nextPos: null };
        }
    }

    /**
     * Fetch the list of GIF categories/topics from the configured provider
     * @returns {Promise<Array<{name: string, searchTerm: string}>>} Array of standardized category objects
     */
    async getCategories() {
        const provider = this._settings.get_string(GIF_PROVIDER_KEY);

        switch (provider) {
            case 'tenor':
                return this._fetchTenorCategories();
            case 'imgur':
                return this._fetchImgurTopics();
            default:
                return [];
        }
    }

    // ===========================
    // Category Fetching Methods
    // ===========================

    /**
     * Fetch categories from Tenor API
     * @private
     * @returns {Promise<Array<{name: string, searchTerm: string}>>}
     */
    async _fetchTenorCategories() {
        const apiKey = this._settings.get_string(GIF_TENOR_API_KEY);
        if (!apiKey) {
            throw new GifManagerError('Missing Tenor API Key.');
        }

        const url = `https://tenor.googleapis.com/v2/categories?key=${apiKey}&client_key=all-in-one-clipboard-gnome-shell`;
        const responseJson = await this._makeApiRequest(url);

        // Standardize the response format
        if (!responseJson || !Array.isArray(responseJson.tags)) {
            return [];
        }

        return responseJson.tags.map(tag => ({
            name: tag.name,
            searchTerm: tag.searchterm,
        }));
    }

    /**
     * Fetch topics from Imgur API
     * @private
     * @returns {Promise<Array<{name: string, searchTerm: string}>>}
     */
    async _fetchImgurTopics() {
        const clientId = this._settings.get_string(GIF_IMGUR_CLIENT_ID_KEY);
        if (!clientId) {
            throw new GifManagerError('Missing Imgur Client ID.');
        }

        const url = `https://api.imgur.com/3/topics/defaults`;
        const headers = { 'Authorization': `Client-ID ${clientId}` };
        const responseJson = await this._makeApiRequest(url, headers);

        // Standardize the response format
        if (!responseJson || !Array.isArray(responseJson.data)) {
            return [];
        }

        return responseJson.data.map(topic => ({
            name: topic.name,
            searchTerm: topic.name, // For Imgur, the search term is the topic name itself
        }));
    }

    // ===========================
    // Tenor Provider Methods
    // ===========================

    /**
     * Fetch GIFs from Tenor API
     * @private
     * @param {string|null} query - Search query (null for trending)
     * @param {boolean} isTrending - Whether to fetch trending instead of search
     * @param {string|null} nextPos - Pagination position token
     * @returns {Promise<{results: Array, nextPos: string|null}>}
     */
    async _fetchFromTenor(query, isTrending, nextPos) {
        const apiKey = this._settings.get_string(GIF_TENOR_API_KEY);
        if (!apiKey) {
            throw new GifManagerError('Missing Tenor API Key.');
        }

        const clientKey = 'all-in-one-clipboard-gnome-shell';
        const limit = '20';
        let url;

        if (isTrending) {
            url = `https://tenor.googleapis.com/v2/featured?key=${apiKey}&client_key=${clientKey}&limit=${limit}`;
        } else {
            const encodedQuery = query.trim().replace(/\s+/g, '+');
            url = `https://tenor.googleapis.com/v2/search?q=${encodedQuery}&key=${apiKey}&client_key=${clientKey}&limit=${limit}`;
        }

        // Add pagination position if it exists
        if (nextPos) {
            url += `&pos=${nextPos}`;
        }

        const responseJson = await this._makeApiRequest(url);
        const parsedResults = this._parseTenorResponse(responseJson);

        // Return the results and the token for the next page
        return {
            results: parsedResults,
            nextPos: responseJson.next || null
        };
    }

    /**
     * Parse Tenor API response into standardized format
     * @private
     * @param {Object} json - Raw Tenor API response
     * @returns {Array<{id: string, description: string, preview_url: string, full_url: string, width: number, height: number}>}
     */
    _parseTenorResponse(json) {
        if (!json || !Array.isArray(json.results)) {
            return [];
        }

        return json.results.map(result => {
            const dims = result.media_formats?.tinygif?.dims;
            return {
                id: result.id,
                description: result.content_description,
                preview_url: result.media_formats?.tinygif?.url,
                full_url: result.media_formats?.gif?.url,
                width: dims ? dims[0] : 0,
                height: dims ? dims[1] : 0,
            };
        }).filter(item => item.preview_url && item.full_url && item.width > 0);
    }

    // ===========================
    // Imgur Provider Methods
    // ===========================

    /**
     * Fetch GIFs from Imgur API
     * @private
     * @param {string|null} query - Search query (null for trending)
     * @param {boolean} isTrending - Whether to fetch trending instead of search
     * @param {number} page - Page number for pagination
     * @returns {Promise<{results: Array, nextPos: string|null}>}
     */
    async _fetchFromImgur(query, isTrending, page) {
        const clientId = this._settings.get_string(GIF_IMGUR_CLIENT_ID_KEY);
        if (!clientId) {
            throw new GifManagerError('Missing Imgur Client ID.');
        }

        let url;
        if (isTrending) {
            // Imgur's trending path contains the page number
            url = `https://api.imgur.com/3/gallery/hot/viral/day/${page}?image_type=gif`;
        } else {
            const encodedQuery = query.trim().replace(/\s+/g, '+');
            // Imgur's search uses a query parameter for the page
            url = `https://api.imgur.com/3/gallery/search/viral/${page}?q=${encodedQuery}+ext:gif`;
        }

        const headers = { 'Authorization': `Client-ID ${clientId}` };
        const responseJson = await this._makeApiRequest(url, headers);
        const parsedResults = this._parseImgurResponse(responseJson);

        // If we got results, the next page is page + 1
        const nextPos = parsedResults.length > 0 ? (page + 1).toString() : null;

        return {
            results: parsedResults,
            nextPos: nextPos
        };
    }

    /**
     * Parse Imgur API response into standardized format
     * @private
     * @param {Object} json - Raw Imgur API response
     * @returns {Array<{id: string, description: string, preview_url: string, full_url: string, width: number, height: number}>}
     */
    _parseImgurResponse(json) {
        if (!json || !Array.isArray(json.data)) {
            return [];
        }

        const gifs = [];

        for (const item of json.data) {
            // Handle both albums and single images
            const images = item.is_album && Array.isArray(item.images) ? item.images : [item];

            for (const image of images) {
                if (image.animated && image.type === 'image/gif' && image.link) {
                    gifs.push({
                        id: image.id,
                        description: image.title || image.description || 'Imgur GIF',
                        preview_url: `https://i.imgur.com/${image.id}b.jpg`,
                        full_url: image.link,
                        width: image.width,
                        height: image.height,
                    });
                }
            }
        }

        return gifs.filter(item => item.width > 0);
    }

    // ===========================
    // HTTP Request Methods
    // ===========================

    /**
     * Make an HTTP API request
     * @private
     * @param {string} url - The API endpoint URL
     * @param {Object} headers - Additional HTTP headers
     * @returns {Promise<Object>} Parsed JSON response
     * @throws {GifManagerError} If the request fails
     */
    async _makeApiRequest(url, headers = {}) {
        const message = new Soup.Message({
            method: 'GET',
            uri: GLib.Uri.parse(url, GLib.UriFlags.NONE)
        });

        // Add custom headers
        for (const [key, value] of Object.entries(headers)) {
            message.get_request_headers().append(key, value);
        }

        try {
            const bytes = await new Promise((resolve, reject) => {
                _httpSession.send_and_read_async(
                    message,
                    GLib.PRIORITY_DEFAULT,
                    null,
                    (source, res) => {
                        if (message.get_status() >= 300) {
                            return reject(new Error(
                                `HTTP Error: ${message.get_status()} ${message.get_reason_phrase()}`
                            ));
                        }

                        try {
                            resolve(source.send_and_read_finish(res));
                        } catch (e) {
                            reject(e);
                        }
                    }
                );
            });

            if (!bytes) {
                throw new Error("No data received from API.");
            }

            return JSON.parse(new TextDecoder('utf-8').decode(bytes.get_data()));

        } catch (e) {
            console.error(`[AIO-Clipboard] API request to ${url} failed: ${e.message}`);
            throw new GifManagerError('API request failed.', { cause: e });
        }
    }
});