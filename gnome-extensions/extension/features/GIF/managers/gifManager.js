import GObject from 'gi://GObject';

import { Logger } from '../../../shared/utilities/utilityLogger.js';

import { GifProviderRegistry } from '../logic/gifProviderRegistry.js';
import { GifSettings } from '../constants/gifConstants.js';

/**
 * GifManager
 *
 * Handles GIF fetching via the active provider.
 * Uses dynamic GifProviderRegistry.
 */
export const GifManager = GObject.registerClass(
    class GifManager extends GObject.Object {
        // ========================================================================
        // Initialization
        // ========================================================================

        /**
         * Initialize the GIF manager.
         * @param {Gio.Settings} settings Extension settings object.
         * @param {string} extensionUUID Extension UUID.
         * @param {string} extensionPath Path to extension root.
         * @param {GifHttpService} httpService The shared HTTP service.
         */
        constructor(settings, extensionUUID, extensionPath, httpService) {
            super();
            this._settings = settings;
            this._uuid = extensionUUID;
            this._registry = new GifProviderRegistry(extensionPath, httpService, settings);
            this._activeProvider = null;

            this._loadActiveProvider();

            this._providerChangedSignalId = this._settings.connect(`changed::${GifSettings.PROVIDER_KEY}`, () => {
                this._loadActiveProvider();
            });
        }

        /**
         * Loads the provider specified in settings.
         */
        _loadActiveProvider() {
            const providerId = this._settings.get_string(GifSettings.PROVIDER_KEY);

            if (this._activeProvider) {
                this._activeProvider.destroy();
                this._activeProvider = null;
            }

            if (providerId === 'none') {
                this._activeProvider = null;
                return;
            }

            this._activeProvider = this._registry.createProvider(providerId);

            if (!this._activeProvider) {
                Logger.warn(`Provider '${providerId}' not found in registry.`);
            }
        }

        /**
         * Search for GIFs using the currently configured provider.
         * @param {string} query The search term.
         * @param {string|null} nextPos Pagination token.
         * @param {Gio.Cancellable|null} [cancellable=null] Optional cancellable.
         * @returns {Promise<{results: Array, nextPos: string|null}>} Search results.
         */
        async search(query, nextPos = null, cancellable = null) {
            if (!this._activeProvider) return { results: [], nextPos: null };

            try {
                const response = await this._activeProvider.search(query, nextPos, cancellable);
                return {
                    results: response.results,
                    nextPos: response.next_offset,
                };
            } catch (e) {
                Logger.error(`Search failed: ${e.message}`);
                throw e;
            }
        }

        /**
         * Fetch trending GIFs.
         * @param {string|null} nextPos Pagination token.
         * @param {Gio.Cancellable|null} [cancellable=null] Optional cancellable.
         * @returns {Promise<{results: Array, nextPos: string|null}>} Trending results.
         */
        async getTrending(nextPos = null, cancellable = null) {
            if (!this._activeProvider) return { results: [], nextPos: null };

            try {
                const response = await this._activeProvider.getTrending(nextPos, cancellable);
                return {
                    results: response.results,
                    nextPos: response.next_offset,
                };
            } catch (e) {
                Logger.error(`Trending failed: ${e.message}`);
                throw e;
            }
        }

        /**
         * Fetch categories.
         * @param {Gio.Cancellable|null} [cancellable=null] Optional cancellable.
         * @returns {Promise<Array<{name: string, searchTerm: string}>>}
         */
        async getCategories(cancellable = null) {
            if (!this._activeProvider) return [];

            try {
                const categories = await this._activeProvider.getCategories(cancellable);
                return categories.map((c) => ({
                    name: c.name,
                    searchTerm: c.keyword || c.name,
                }));
            } catch (e) {
                Logger.error(`Categories failed: ${e.message}`);
                return [];
            }
        }

        /**
         * Get the attribution configuration for the active provider.
         * @returns {Object|null} Attribution object with search_icon, or null.
         */
        getActiveProviderAttribution() {
            const providerId = this._settings.get_string(GifSettings.PROVIDER_KEY);
            const def = this._registry.getProviderDefinition(providerId);
            return def?.attribution || null;
        }

        /**
         * Get the display name of the active provider.
         * @returns {string|null} Provider name or null.
         */
        getActiveProviderName() {
            const providerId = this._settings.get_string(GifSettings.PROVIDER_KEY);
            const def = this._registry.getProviderDefinition(providerId);
            return def?.name || null;
        }

        /**
         * Get list of available providers for the UI or Settings.
         * @returns {Array<{id: string, name: string}>}
         */
        getAvailableProviders() {
            return this._registry.getAvailableProviders();
        }

        // ========================================================================
        // Lifecycle
        // ========================================================================

        /**
         * Clean up resources.
         */
        destroy() {
            if (this._providerChangedSignalId) {
                this._settings.disconnect(this._providerChangedSignalId);
                this._providerChangedSignalId = 0;
            }

            if (this._activeProvider) {
                this._activeProvider.destroy();
                this._activeProvider = null;
            }
        }
    },
);
