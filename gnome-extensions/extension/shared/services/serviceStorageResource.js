import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { Logger } from '../utilities/utilityLogger.js';

/**
 * Service-level resource operations for read-only GResource bundles.
 */
export const ServiceStorageResource = {
    /**
     * Normalizes a resource URI to a resource path.
     *
     * @param {string} uri Full resource URI or resource path.
     * @returns {string|null} Resource path or null.
     * @private
     */
    _normalizePath(uri) {
        if (!uri) return null;
        if (uri.startsWith('resource://')) {
            return uri.replace('resource://', '');
        }
        return uri;
    },

    /**
     * Normalizes a resource path or URI to a full resource URI.
     *
     * @param {string} uri Full resource URI or resource path.
     * @returns {string|null} Full resource URI or null.
     * @private
     */
    _normalizeUri(uri) {
        if (!uri) return null;
        if (uri.startsWith('resource://')) {
            return uri;
        }
        return `resource://${uri.startsWith('/') ? uri : `/${uri}`}`;
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

    /**
     * Lists children of a resource directory asynchronously.
     *
     * @param {string} uri Full resource URI or resource path.
     * @returns {Promise<Array<string>|null>} Array of child names or null on error.
     */
    async listAsync(uri) {
        try {
            const resourceUri = this._normalizeUri(uri);
            if (!resourceUri) return null;

            const dir = Gio.File.new_for_uri(resourceUri);
            const enumerator = await new Promise((resolve, reject) => {
                dir.enumerate_children_async('standard::name', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_LOW, null, (obj, res) => {
                    try {
                        resolve(obj.enumerate_children_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            try {
                const children = [];
                const fetchBatch = async () => {
                    const infos = await new Promise((resolve, reject) => {
                        enumerator.next_files_async(50, GLib.PRIORITY_LOW, null, (obj, res) => {
                            try {
                                resolve(obj.next_files_finish(res));
                            } catch (e) {
                                reject(e);
                            }
                        });
                    });

                    if (!infos || infos.length === 0) return;

                    for (const info of infos) {
                        children.push(info.get_name());
                    }

                    await fetchBatch();
                };

                await fetchBatch();
                return children;
            } finally {
                await new Promise((resolve) => {
                    enumerator.close_async(GLib.PRIORITY_LOW, null, resolve);
                });
            }
        } catch (e) {
            Logger.warn(`ServiceStorageResource.listAsync failed for '${uri}': ${e.message}`);
            return null;
        }
    },
};
