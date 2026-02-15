import Gio from 'gi://Gio';

import { GifGenericProvider } from './gifGenericProvider.js';
import { ResourcePath } from '../../../shared/constants/storagePaths.js';

/**
 * GifProviderRegistry
 *
 * Registry to manage GIF providers.
 * Scans the directory for JSON configurations.
 */
export class GifProviderRegistry {
    /**
     * @param {string} extensionPath - Path to the extension root
     * @param {Soup.Session} httpSession - Shared HTTP session
     * @param {Gio.Settings} settings - Extension settings
     */
    constructor(extensionPath, httpSession, settings) {
        this._extensionPath = extensionPath;
        this._httpSession = httpSession;
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
     * @param {Gio.File} file
     */
    _loadProviderFromFile(file) {
        try {
            const [success, contents] = file.load_contents(null);
            if (!success) return;

            const jsonString = new TextDecoder('utf-8').decode(contents);
            const definition = JSON.parse(jsonString);

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
     */
    _validateDefinition(def) {
        return def && def.id && def.name && def.base_url && def.endpoints;
    }

    /**
     * Returns a list of available provider definitions (for UI/Settings).
     * @returns {Array<{id: string, name: string}>}
     */
    getAvailableProviders() {
        return Array.from(this._providers.values()).map((p) => ({
            id: p.id,
            name: p.name,
        }));
    }

    /**
     * Instantiates the requested provider.
     * @param {string} providerId
     * @returns {GifGenericProvider|null}
     */
    createProvider(providerId) {
        const def = this._providers.get(providerId);
        if (!def) return null;

        return new GifGenericProvider(def, this._httpSession, this._settings);
    }
}
