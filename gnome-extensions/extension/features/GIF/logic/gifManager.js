import GObject from 'gi://GObject';
import Soup from 'gi://Soup';

import { GifSettings } from '../constants/gifConstants.js';
import { GifProviderRegistry } from './gifProviderRegistry.js';

/**
 * GifManager
 *
 * Handles GIF fetching via the active provider.
 * Uses dynamic GifProviderRegistry.
 */
export const GifManager = GObject.registerClass(
    class GifManager extends GObject.Object {
        /**
         * Initialize the GIF manager
         * @param {Gio.Settings} settings - Extension settings object
         * @param {string} extensionUUID - Extension UUID
         * @param {string} extensionPath - Path to extension root
         */
        constructor(settings, extensionUUID, extensionPath) {
            super();
            this._settings = settings;
            this._uuid = extensionUUID;
            this._httpSession = new Soup.Session();

            // Initialize Registry
            this._registry = new GifProviderRegistry(extensionPath, this._httpSession, settings);

            // Initialize Active Provider
            this._activeProvider = null;
            this._loadActiveProvider();

            // Listen for provider changes
            this._settings.connect(`changed::${GifSettings.PROVIDER_KEY}`, () => {
                this._loadActiveProvider();
            });
        }

        /**
         * Loads the provider specified in settings.
         */
        _loadActiveProvider() {
            const providerId = this._settings.get_string(GifSettings.PROVIDER_KEY);

            if (providerId === 'none') {
                this._activeProvider = null;
                return;
            }

            this._activeProvider = this._registry.createProvider(providerId);

            if (!this._activeProvider) {
                console.warn(`[AIO-Clipboard] Provider '${providerId}' not found in registry.`);
            }
        }

        /**
         * Search for GIFs using the currently configured provider
         * @param {string} query - The search term
         * @param {string|null} nextPos - Pagination token
         * @returns {Promise<{results: Array, nextPos: string|null}>} Search results
         */
        async search(query, nextPos = null) {
            if (!this._activeProvider) return { results: [], nextPos: null };

            try {
                const response = await this._activeProvider.search(query, nextPos);
                return {
                    results: response.results,
                    nextPos: response.next_offset,
                };
            } catch (e) {
                console.error(`[AIO-Clipboard] Search failed: ${e.message}`);
                throw e;
            }
        }

        /**
         * Fetch trending GIFs
         * @param {string|null} nextPos - Pagination token
         * @returns {Promise<{results: Array, nextPos: string|null}>} Trending results
         */
        async getTrending(nextPos = null) {
            if (!this._activeProvider) return { results: [], nextPos: null };

            try {
                const response = await this._activeProvider.getTrending(nextPos);
                return {
                    results: response.results,
                    nextPos: response.next_offset,
                };
            } catch (e) {
                console.error(`[AIO-Clipboard] Trending failed: ${e.message}`);
                throw e;
            }
        }

        /**
         * Fetch categories
         * @returns {Promise<Array<{name: string, searchTerm: string}>>}
         */
        async getCategories() {
            if (!this._activeProvider) return [];

            try {
                const categories = await this._activeProvider.getCategories();
                // Map to ensure compatibility with UI expectations
                return categories.map((c) => ({
                    name: c.name,
                    searchTerm: c.keyword || c.name,
                }));
            } catch (e) {
                console.error(`[AIO-Clipboard] Categories failed: ${e.message}`);
                return [];
            }
        }

        /**
         * Get list of available providers for UI (Settings)
         * @returns {Array<{id: string, name: string}>}
         */
        getAvailableProviders() {
            return this._registry.getAvailableProviders();
        }

        /**
         * Clean up resources
         */
        destroy() {
            if (this._httpSession) {
                this._httpSession.abort();
                this._httpSession = null;
            }
        }
    },
);
