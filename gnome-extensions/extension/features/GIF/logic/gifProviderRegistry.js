import { Logger } from '../../../shared/utilities/utilityLogger.js';
import { IOResource, ResourcePath } from '../../../shared/constants/storagePaths.js';

import { GifGenericProvider } from './gifGenericProvider.js';

/**
 * GifProviderRegistry
 *
 * Registry to manage GIF providers.
 * Scans the directory for JSON configurations.
 */
export class GifProviderRegistry {
    // ========================================================================
    // Initialization
    // ========================================================================

    /**
     * @param {string} extensionPath Path to the extension root.
     * @param {GifHttpService} httpService The shared HTTP service.
     * @param {Gio.Settings} settings Extension settings.
     */
    constructor(extensionPath, httpService, settings) {
        this._extensionPath = extensionPath;
        this._httpService = httpService;
        this._settings = settings;
        this._providers = new Map();
        this._loadPromise = null;
        this._isLoaded = false;
    }

    /**
     * Scans the directory and loads valid JSON providers.
     *
     * @returns {Promise<void>} Resolves when providers have been loaded.
     */
    loadProviders() {
        if (this._isLoaded) {
            return Promise.resolve();
        }

        if (!this._loadPromise) {
            this._loadPromise = this._loadProviders().finally(() => {
                this._loadPromise = null;
            });
        }

        return this._loadPromise;
    }

    /**
     * Scans provider directories and loads valid JSON providers.
     *
     * @returns {Promise<void>} Resolves when scanning is complete.
     * @private
     */
    async _loadProviders() {
        const locations = [ResourcePath.GIF];
        this._providers.clear();

        await Promise.all(locations.map((uri) => this._loadProvidersFromDirectory(uri)));

        this._isLoaded = true;
    }

    /**
     * Scans a provider directory and loads all JSON definitions.
     *
     * @param {string} resourceUri The resource directory to scan.
     * @returns {Promise<void>} Resolves when the directory has been scanned.
     * @private
     */
    async _loadProvidersFromDirectory(resourceUri) {
        try {
            const filenames = await IOResource.listAsync(resourceUri);
            if (!filenames) return;

            const providerLoadPromises = filenames.filter((filename) => filename.endsWith('.json')).map((filename) => this._loadProviderFromFile(`${resourceUri}/${filename}`));
            await Promise.all(providerLoadPromises);
        } catch (e) {
            Logger.warn(`Failed to scan GIF providers: ${e.message}`);
        }
    }

    /**
     * Loads a single provider from a JSON file.
     *
     * @param {string} providerUri The provider resource URI to load.
     * @returns {Promise<void>} Resolves when the provider has been processed.
     */
    async _loadProviderFromFile(providerUri) {
        try {
            const definition = await IOResource.readJson(providerUri);

            if (this._validateDefinition(definition)) {
                this._providers.set(definition.id, definition);
            } else {
                Logger.warn(`Invalid provider definition in ${this._getBasename(providerUri)}`);
            }
        } catch (e) {
            Logger.error(`Failed to load provider ${this._getBasename(providerUri)}: ${e.message}`);
        }
    }

    /**
     * Gets the final path segment from a resource URI.
     *
     * @param {string} uri The resource URI.
     * @returns {string} The final path segment.
     * @private
     */
    _getBasename(uri) {
        return uri.split('/').pop();
    }

    /**
     * Validates that a definition has the minimum required fields.
     * @param {Object} def The definition to validate.
     */
    _validateDefinition(def) {
        return def && def.id && def.name && def.base_url && def.endpoints;
    }

    /**
     * Returns a list of available provider definitions for the UI or Settings.
     * @returns {Array<{id: string, name: string, hasProxy: boolean}>}
     */
    getAvailableProviders() {
        return Array.from(this._providers.values()).map((p) => ({
            id: p.id,
            name: p.name,
            hasProxy: !!p.proxy_url,
        }));
    }

    /**
     * Returns the raw JSON definition for a provider.
     * @param {string} providerId The provider ID.
     * @returns {Object|null} The provider definition or null.
     */
    getProviderDefinition(providerId) {
        return this._providers.get(providerId) || null;
    }

    /**
     * Instantiates the requested provider.
     * @param {string} providerId The provider ID.
     * @returns {GifGenericProvider|null}
     */
    createProvider(providerId) {
        const def = this._providers.get(providerId);
        if (!def) return null;

        return new GifGenericProvider(def, this._httpService, this._settings);
    }
}
