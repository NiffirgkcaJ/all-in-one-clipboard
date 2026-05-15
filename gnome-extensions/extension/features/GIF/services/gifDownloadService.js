import GLib from 'gi://GLib';

import { FilePath } from '../../../shared/constants/storagePaths.js';
import { IOFile } from '../../../shared/utilities/utilityIO.js';
import { ServiceImage } from '../../../shared/services/serviceImage.js';
import { ServiceText } from '../../../shared/services/serviceText.js';
import { clipboardSetText, clipboardSetContent } from '../../../shared/utilities/utilityClipboard.js';

import { ClipboardType } from '../../Clipboard/constants/clipboardConstants.js';

/**
 * GifDownloadService
 *
 * Handles downloading images and saving them to disk.
 * Uses the shared GifHttpService for all network operations.
 */
export class GifDownloadService {
    // ========================================================================
    // Initialization
    // ========================================================================

    /**
     * @param {GifHttpService} httpService The shared HTTP service.
     */
    constructor(httpService) {
        this._httpService = httpService;
    }

    /**
     * Fetch image bytes from a URL.
     *
     * @param {string} url The image URL.
     * @returns {Promise<Uint8Array>} The image bytes.
     */
    async fetchImageBytes(url) {
        const result = await ServiceImage.download(this._httpService.getSession(), url);
        return result?.bytes || null;
    }

    /**
     * Downloads and caches a preview image if not already cached.
     * Uses URL hash as filename for deduplication.
     *
     * @param {string} url The image URL.
     * @param {string} cacheDir The cache directory path.
     * @returns {Promise<string>} The cached file path.
     */
    async downloadPreviewCached(url, cacheDir) {
        const hash = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, url, -1);
        const filename = `${hash}.gif`;
        const filePath = GLib.build_filenamev([cacheDir, filename]);

        if (await IOFile.exists(filePath)) {
            return filePath;
        }

        const bytes = await this.fetchImageBytes(url);
        await IOFile.write(filePath, ServiceImage.stringifyBytes(bytes));
        return filePath;
    }

    /**
     * Helper to download and save an image to a specific path.
     *
     * @param {string} url The URL to download.
     * @param {string} destPath The absolute path to save to.
     * @returns {Promise<Uint8Array>} The downloaded bytes.
     */
    async downloadAndSave(url, destPath) {
        const bytes = await this.fetchImageBytes(url);
        await IOFile.write(destPath, ServiceImage.stringifyBytes(bytes));
        return bytes;
    }

    /**
     * Copy a GIF to clipboard, respecting paste behavior setting.
     * Image Mode downloads GIF, saves to images dir, adds to clipboard history.
     * Link Mode copies URL as text.
     *
     * @param {Object} gifObject GIF data with full_url, width, height.
     * @param {Gio.Settings} settings Extension settings.
     * @param {ClipboardManager} clipboardManager Clipboard manager instance.
     * @returns {Promise<boolean>} True if successful.
     */
    async copyToClipboard(gifObject, settings, clipboardManager) {
        if (!gifObject?.full_url) return false;

        const pasteBehavior = settings.get_int('gif-paste-behavior'); // 0=Link, 1=Image
        let success = false;

        if (pasteBehavior === 1 && clipboardManager) {
            try {
                const existingItem = clipboardManager.getItemBySourceUrl(gifObject.full_url);

                if (existingItem?.file_uri) {
                    clipboardManager.addExternalItem(existingItem);
                    this._setClipboardUri(existingItem.file_uri);
                    success = true;
                } else {
                    const filename = `${GLib.uuid_string_random()}.gif`;
                    const path = GLib.build_filenamev([FilePath.IMAGES, filename]);

                    const bytes = await this.downloadAndSave(gifObject.full_url, path);

                    const item = {
                        id: GLib.uuid_string_random(),
                        type: ClipboardType.IMAGE,
                        timestamp: Math.floor(Date.now() / 1000),
                        image_filename: filename,
                        file_uri: `file://${path}`,
                        source_url: gifObject.full_url,
                        hash: GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, bytes),
                        width: gifObject.width,
                        height: gifObject.height,
                    };

                    clipboardManager.addExternalItem(item);
                    this._setClipboardUri(item.file_uri);
                    success = true;
                }
            } catch (e) {
                console.error(`[AIO-Clipboard] Failed to paste GIF as image: ${e.message}`);
            }
        }

        // Fallback to Link Mode
        if (!success) {
            clipboardSetText(gifObject.full_url);
            success = true;
        }

        return success;
    }

    /**
     * Set the clipboard to a URI list.
     *
     * @param {string} fileUri The file URI to set.
     */
    _setClipboardUri(fileUri) {
        const uriList = fileUri + '\r\n';
        const bytes = ServiceText.stringifyBytes(uriList);
        if (!bytes) return;
        clipboardSetContent('text/uri-list', new GLib.Bytes(bytes));
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    /**
     * Clean up resources.
     */
    destroy() {
        this._httpService = null;
    }
}
