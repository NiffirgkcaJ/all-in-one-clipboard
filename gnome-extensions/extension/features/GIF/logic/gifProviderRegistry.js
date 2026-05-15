import Gio from 'gi://Gio';

import { ResourcePath } from '../../../shared/constants/storagePaths.js';
import { ServiceJson } from '../../../shared/services/serviceJson.js';

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

        this._loadProviders();
    }

    /**
     * Scans the directory and loads valid JSON providers.
     * @private
     */
    _loadProviders() {
        const locations = [Gio.File.new_for_uri(ResourcePath.GIF)];

        for (const dir of locations) {
            try {
                const enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
                let fileInfo;
                while ((fileInfo = enumerator.next_file(null)) !== null) {
                    const filename = fileInfo.get_name();
                    if (!filename.endsWith('.json')) continue;

                    const file = dir.get_child(filename);
                    this._loadProviderFromFile(file);
                }
            } catch {
                // Ignore
            }
        }
    }

    /**
     * Loads a single provider from a JSON file.
     * @param {Gio.File} file The file to load.
     */
    _loadProviderFromFile(file) {
        try {
            const [success, contents] = file.load_contents(null);
            if (!success) return;

            const definition = ServiceJson.parseBytes(contents);

            if (this._validateDefinition(definition)) {
                this._providers.set(definition.id, definition);
            } else {
                console.warn(`[AIO-Clipboard] Invalid provider definition in ${file.get_basename()}`);
            }
        } catch (e) {
            console.error(`[AIO-Clipboard] Failed to load provider ${file.get_basename()}: ${e.message}`);
        }
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
