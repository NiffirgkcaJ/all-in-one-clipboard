import { Debouncer } from '../../../shared/utilities/utilityDebouncer.js';
import { FilePath } from '../../../shared/constants/storagePaths.js';
import { IOFile } from '../../../shared/utilities/utilityIO.js';

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
        this._gifCacheDir = FilePath.GIF_PREVIEWS;

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
            IOFile.prune(this._gifCacheDir, cacheLimit).catch((e) => console.warn(`[AIO-Clipboard] GIF cache management failed: ${e.message}`));
        } catch (e) {
            console.warn(`[AIO-Clipboard] Could not initiate GIF cache management: ${e.message}`);
        }
    }

    /**
     * Clears the entire GIF cache by deleting all files within the directory.
     * Used by the "Clear Cache" button in preferences.
     */
    async clearCache() {
        await IOFile.empty(this._gifCacheDir);
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
