import GLib from 'gi://GLib';

import { ServiceImage } from '../../../shared/services/serviceImage.js';
import { ServiceText } from '../../../shared/services/serviceText.js';
import { clipboardSetText, clipboardSetContent } from '../../../shared/utilities/utilityClipboard.js';

import { ClipboardType } from '../constants/clipboardConstants.js';

/**
 * ClipboardCopyService
 *
 * Handles copying clipboard items back to the system clipboard.
 * Supports all content types.
 */
export class ClipboardCopyService {
    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Copy an item's content to the system clipboard.
     *
     * @param {Object} itemData Data of the item to copy.
     * @param {ClipboardStorage} storage Storage instance for reading raw files.
     * @param {ClipboardManager} manager Manager instance for content retrieval.
     * @returns {Promise<boolean>} True if successful.
     */
    static async copy(itemData, storage, manager) {
        try {
            switch (itemData.type) {
                case ClipboardType.IMAGE:
                    return await ClipboardCopyService._copyImage(itemData, storage);
                case ClipboardType.FILE:
                    return ClipboardCopyService._copyFile(itemData);
                case ClipboardType.URL:
                case ClipboardType.COLOR:
                    clipboardSetText(itemData.url || itemData.color_value);
                    return true;
                case ClipboardType.CONTACT:
                case ClipboardType.CODE:
                case ClipboardType.TEXT:
                    return await ClipboardCopyService._copyText(itemData, manager);
                default:
                    return false;
            }
        } catch (e) {
            console.error(`[AIO-Clipboard] Copy failed: ${e.message}`);
            return false;
        }
    }

    // ========================================================================
    // Internal Helpers
    // ========================================================================

    /**
     * Copy an image item to the clipboard.
     *
     * @param {Object} itemData Image item data.
     * @param {ClipboardStorage} storage Storage instance.
     * @returns {Promise<boolean>} True if successful.
     * @private
     */
    static async _copyImage(itemData, storage) {
        if (itemData.file_uri) {
            const uriBytes = ServiceText.stringifyBytes(itemData.file_uri + '\r\n');
            if (!uriBytes) return false;
            clipboardSetContent('text/uri-list', new GLib.Bytes(uriBytes));
            return true;
        }

        const imagePath = GLib.build_filenamev([storage.imagesDir, itemData.image_filename]);
        const bytes = ServiceImage.parseBytes(await storage.readRaw(imagePath));

        if (!bytes) return false;
        clipboardSetContent(ServiceImage.getMimeType(itemData.image_filename), bytes);
        return true;
    }

    /**
     * Copy a file URI to the clipboard.
     *
     * @param {Object} itemData File item data.
     * @returns {boolean} True if successful.
     * @private
     */
    static _copyFile(itemData) {
        const uriBytes = ServiceText.stringifyBytes(itemData.file_uri + '\r\n');
        if (!uriBytes) return false;
        clipboardSetContent('text/uri-list', new GLib.Bytes(uriBytes));
        return true;
    }

    /**
     * Copy text content to the clipboard.
     *
     * @param {Object} itemData Text, code, or contact item data.
     * @param {ClipboardManager} manager Manager for content retrieval.
     * @returns {Promise<boolean>} True if successful.
     * @private
     */
    static async _copyText(itemData, manager) {
        let content = itemData.text || (await manager.getContent(itemData.id));

        if (!content && itemData.preview && itemData.type !== ClipboardType.CODE) {
            content = itemData.preview;
        }

        if (!content) return false;
        clipboardSetText(content);
        return true;
    }
}
