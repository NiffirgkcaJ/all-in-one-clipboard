import GLib from 'gi://GLib';
import Soup from 'gi://Soup';
import St from 'gi://St';

import { IOFile } from '../../../shared/utilities/utilityIO.js';
import { ServiceImage } from '../../../shared/services/serviceImage.js';

import { ClipboardType } from '../../Clipboard/constants/clipboardConstants.js';

/**
 * GifDownloadService
 *
 * Handles downloading images and saving them to disk.
 * Maintains its own HTTP session for request lifecycle management.
 */
export class GifDownloadService {
    /**
     * @param {Soup.Session} httpSession - The HTTP session to use for requests
     */
    constructor(httpSession) {
        this._httpSession = httpSession || new Soup.Session();
    }

    /**
     * Fetch image bytes from a URL.
     *
     * @param {string} url - The image URL
     * @returns {Promise<Uint8Array>} The image bytes
     */
    async fetchImageBytes(url) {
        const message = new Soup.Message({
            method: 'GET',
            uri: GLib.Uri.parse(url, GLib.UriFlags.NONE),
        });

        return new Promise((resolve, reject) => {
            this._httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, res) => {
                if (message.get_status() >= 300) {
                    reject(new Error(`HTTP Error ${message.get_status()}`));
                    return;
                }

                try {
                    const bytes = session.send_and_read_finish(res);
                    resolve(bytes?.get_data() || null);
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    /**
     * Downloads and caches a preview image if not already cached.
     * Uses URL hash as filename for deduplication.
     *
     * @param {string} url - The image URL
     * @param {string} cacheDir - The cache directory path
     * @returns {Promise<string>} The cached file path
     */
    async downloadPreviewCached(url, cacheDir) {
        const hash = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, url, -1);
        const filename = `${hash}.gif`;
        const filePath = GLib.build_filenamev([cacheDir, filename]);

        if (await IOFile.exists(filePath)) {
            return filePath;
        }

        const bytes = await this.fetchImageBytes(url);
        await IOFile.write(filePath, ServiceImage.encode(bytes));
        return filePath;
    }

    /**
     * Helper to download and save an image to a specific path.
     *
     * @param {string} url - The URL to download
     * @param {string} destPath - The absolute path to save to
     * @returns {Promise<Uint8Array>} The downloaded bytes
     */
    async downloadAndSave(url, destPath) {
        const bytes = await this.fetchImageBytes(url);
        await IOFile.write(destPath, ServiceImage.encode(bytes));
        return bytes;
    }

    /**
     * Copy a GIF to clipboard, respecting paste behavior setting.
     * Image Mode: Downloads GIF, saves to images dir, adds to clipboard history.
     * Link Mode: Copies URL as text.
     *
     * @param {Object} gifObject - GIF data with full_url, width, height
     * @param {Gio.Settings} settings - Extension settings
     * @param {ClipboardManager} clipboardManager - Clipboard manager instance
     * @returns {Promise<boolean>} True if successful
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
                    const path = GLib.build_filenamev([clipboardManager.imagesDir, filename]);

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
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, gifObject.full_url);
            success = true;
        }

        return success;
    }

    /** @private */
    _setClipboardUri(fileUri) {
        const uriList = fileUri + '\r\n';
        const uriBytes = new GLib.Bytes(new TextEncoder().encode(uriList));
        St.Clipboard.get_default().set_content(St.ClipboardType.CLIPBOARD, 'text/uri-list', uriBytes);
    }

    /**
     * Cancel any pending requests
     */
    destroy() {
        if (this._httpSession) {
            this._httpSession.abort();
            this._httpSession = null;
        }
    }
}
