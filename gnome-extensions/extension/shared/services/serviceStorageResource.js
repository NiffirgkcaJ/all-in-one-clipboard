import Gio from 'gi://Gio';

import { Logger } from '../utilities/utilityLogger.js';

/**
 * Service-level resource operations for read-only GResource bundles.
 */
export const ServiceStorageResource = {
    _normalizePath(uri) {
        if (!uri) return null;
        if (uri.startsWith('resource://')) {
            return uri.replace('resource://', '');
        }
        return uri;
    },

    /**
     * Reads a resource from a GResource bundle.
     *
     * @param {string} uri Full resource URI.
     * @returns {Promise<Uint8Array|null>} Contents or null if not found.
     */
    async read(uri) {
        try {
            const file = Gio.File.new_for_uri(uri);
            return await new Promise((resolve, reject) => {
                file.load_contents_async(null, (source, res) => {
                    try {
                        const [ok, contents] = source.load_contents_finish(res);
                        resolve(ok ? contents : null);
                    } catch (e) {
                        reject(e);
                    }
                });
            });
        } catch (e) {
            Logger.error(`ServiceStorageResource.read failed for '${uri}': ${e.message}`);
            return null;
        }
    },

    /**
     * Reads a resource synchronously from a GResource bundle.
     *
     * @param {string} uri Full resource URI or resource path.
     * @returns {Uint8Array|null} Contents or null if not found.
     */
    readSync(uri) {
        try {
            const path = this._normalizePath(uri);
            if (!path) return null;
            const bytes = Gio.resources_lookup_data(path, Gio.ResourceLookupFlags.NONE);
            return bytes.get_data();
        } catch (e) {
            Logger.error(`ServiceStorageResource.readSync failed for '${uri}': ${e.message}`);
            return null;
        }
    },

    /**
     * Checks if a resource exists in the bundle.
     *
     * @param {string} uri Full resource URI or resource path.
     * @returns {boolean} True if the resource exists.
     */
    exists(uri) {
        try {
            const path = this._normalizePath(uri);
            if (!path) return false;
            Gio.resources_lookup_data(path, Gio.ResourceLookupFlags.NONE);
            return true;
        } catch {
            return false;
        }
    },

    /**
     * Lists children of a resource directory.
     *
     * @param {string} uri Full resource URI or resource path.
     * @returns {Array<string>|null} Array of child names or null on error.
     */
    list(uri) {
        try {
            const path = this._normalizePath(uri);
            if (!path) return null;
            return Gio.resources_enumerate_children(path, Gio.ResourceLookupFlags.NONE) ?? [];
        } catch (e) {
            Logger.warn(`ServiceStorageResource.list failed for '${uri}': ${e.message}`);
            return null;
        }
    },
};
