import Soup from 'gi://Soup';

import { FilePath } from '../../../shared/constants/storagePaths.js';

import { getGifCacheManager } from '../../GIF/logic/gifCacheManager.js';
import { GifDownloadService } from '../../GIF/logic/gifDownloadService.js';

let httpSession = null;
let gifDownloadService = null;

// ========================================================================
// Runtime Lifecycle
// ========================================================================

/**
 * Returns the GIF runtime services, creating them when needed.
 *
 * @returns {object} GIF runtime context.
 */
export function getRecentlyUsedGifRuntime() {
    if (!httpSession) {
        httpSession = new Soup.Session();
    }

    if (!gifDownloadService) {
        gifDownloadService = new GifDownloadService(httpSession);
    }

    return {
        gifDownloadService,
        gifCacheDir: FilePath.GIF_PREVIEWS,
        getGifCacheManager: getRecentlyUsedGifCacheManager,
    };
}

/**
 * Destroys the GIF runtime services.
 */
export function destroyRecentlyUsedGifRuntime() {
    if (httpSession) {
        httpSession.abort();
        httpSession = null;
    }

    gifDownloadService = null;
}

// ========================================================================
// Clipboard and Cache Access
// ========================================================================

/**
 * Copies GIF content to the system clipboard.
 *
 * @param {object} itemData GIF item payload.
 * @param {object} settings Extension settings object.
 * @param {object} extension Extension instance.
 * @returns {Promise<boolean>} True when copy succeeds.
 */
export async function copyRecentlyUsedGifToClipboard(itemData, settings, extension) {
    const clipboardManager = extension?._clipboardManager;
    const { gifDownloadService: service } = getRecentlyUsedGifRuntime();
    return service.copyToClipboard(itemData, settings, clipboardManager);
}

/**
 * Returns the shared GIF cache manager.
 *
 * @returns {object} GIF cache manager.
 */
export function getRecentlyUsedGifCacheManager() {
    return getGifCacheManager();
}
