import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { Debouncer } from '../../../utilities/utilityDebouncer.js';
import { manageCacheSize } from '../../../utilities/utilityCacheManager.js';

let _instance = null;

/**
 * A singleton manager for the GIF preview cache.
 * It centralizes the logic for cache path, limits, and cleanup operations,
 * including a debounced trigger for efficiency.
 */
class GifCacheManager {
    constructor(uuid, settings) {
        this._uuid = uuid;
        this._settings = settings;
        this._gifCacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), this._uuid, 'gif-previews']);

        // Instantiate the Debouncer class.
        this._debouncer = new Debouncer(() => {
            this._runCleanup();
        }, 5000);
    }

    /**
     * Executes the cache size management immediately.
     * Used for startup and preference changes.
     */
    runCleanupImmediately() {
        this._runCleanup();
    }

    /**
     * Triggers the debounced cache cleanup.
     * Used during GIF browsing to batch cleanup operations.
     */
    triggerDebouncedCleanup() {
        this._debouncer.trigger();
    }

    /**
     * The core cleanup logic.
     * @private
     */
    _runCleanup() {
        try {
            const cacheLimit = this._settings.get_int('gif-cache-limit-mb');
            manageCacheSize(this._gifCacheDir, cacheLimit).catch((e) => console.warn(`[AIO-Clipboard] GIF cache management failed: ${e.message}`));
        } catch (e) {
            console.warn(`[AIO-Clipboard] Could not initiate GIF cache management: ${e.message}`);
        }
    }

    /**
     * Clears the entire GIF cache by deleting all files within the directory.
     * Used by the "Clear Cache" button in preferences.
     */
    clearCache() {
        try {
            const dir = Gio.File.new_for_path(this._gifCacheDir);
            if (!dir.query_exists(null)) {
                return; // Nothing to clear
            }

            // Asynchronously list all files in the directory
            dir.enumerate_children_async('standard::name', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null, (source, res) => {
                try {
                    const enumerator = source.enumerate_children_finish(res);
                    this._deleteFilesInEnumerator(enumerator, dir);
                } catch {
                    // Ignore errors if file doesn't exist
                }
            });
        } catch (e) {
            console.error(`[AIO-Clipboard] Failed to access cache directory for clearing: ${e.message}`);
        }
    }

    /**
     * Cleans up resources, including canceling any pending debounced cleanup.
     */
    destroy() {
        if (this._debouncer) {
            this._debouncer.destroy();
            this._debouncer = null;
        }
        this._settings = null;
    }

    /**
     * Helper function to recursively delete files from a directory enumerator.
     * @private
     */
    _deleteFilesInEnumerator(enumerator, parentDir) {
        enumerator.next_files_async(100, GLib.PRIORITY_DEFAULT, null, (source, res) => {
            try {
                const files = source.next_files_finish(res);
                if (files.length === 0) {
                    // No more files, we are done.
                    enumerator.close_async(GLib.PRIORITY_DEFAULT, null, null); // Clean up the enumerator
                    return;
                }

                // Delete each file found in this batch
                for (const fileInfo of files) {
                    const child = parentDir.get_child(fileInfo.get_name());
                    child.delete_async(GLib.PRIORITY_DEFAULT, null, (sourceDelete, resDelete) => {
                        try {
                            sourceDelete.delete_finish(resDelete);
                        } catch {
                            // Ignore if a file couldn't be deleted (e.g., already gone)
                        }
                    });
                }

                // Look for the next batch of files
                this._deleteFilesInEnumerator(enumerator, parentDir);
            } catch (e) {
                console.error(`[AIO-Clipboard] Error while deleting cache files: ${e.message}`);
            }
        });
    }
}

/**
 * Initializes and/or returns the singleton instance of the GifCacheManager.
 * @param {string} [uuid] - The extension UUID (required for first-time initialization).
 * @param {Gio.Settings} [settings] - The GSettings object (required for first-time initialization).
 * @returns {GifCacheManager} The singleton instance.
 */
export function getGifCacheManager(uuid, settings) {
    if (_instance === null) {
        if (!uuid || !settings) {
            throw new Error('GifCacheManager must be initialized with uuid and settings.');
        }
        _instance = new GifCacheManager(uuid, settings);
    }
    return _instance;
}

/**
 * Destroys the singleton instance of the GifCacheManager, cleaning up its resources.
 */
export function destroyGifCacheManager() {
    if (_instance !== null) {
        _instance.destroy();
        _instance = null;
    }
}
