import GLib from 'gi://GLib';

import { clipboardGetContent } from '../../../shared/utilities/utilityClipboard.js';
import { Logger } from '../../../shared/utilities/utilityLogger.js';
import { IOFile, IOText } from '../../../shared/utilities/utilityIO.js';

import { ClipboardType } from '../constants/clipboardPluginConstants.js';
import { ProcessorUtils } from '../utilities/clipboardProcessorUtils.js';

import { ImageProcessor } from './clipboardImageProcessor.js';
import { TextProcessor } from './clipboardTextProcessor.js';

// Configuration
const MAX_PREVIEW_LENGTH = 500;

/**
 * HtmlProcessor
 *
 * Reads rich HTML content from the clipboard, persists HTML files, and extracts embedded images.
 */
export class HtmlProcessor {
    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Extract HTML data from the clipboard.
     *
     * @returns {Promise<Object|null>} An object containing HTML, text preview, hash, or null if no HTML found.
     */
    static async extract() {
        const htmlResult = await clipboardGetContent('text/html');
        if (!htmlResult?.data || htmlResult.size === 0) return null;

        const htmlString = IOText.parseBytes(htmlResult.data);
        const hasImages = Boolean(htmlString && /<img\b/i.test(htmlString));
        const textItem = await TextProcessor.extract();

        const text = textItem?.text || '';
        let preview = textItem?.preview || '';
        if (!preview && htmlString) {
            preview = htmlString
                .replace(/<[^>]+>/g, ' ')
                .substring(0, MAX_PREVIEW_LENGTH)
                .replace(/\s+/g, ' ')
                .trim();
        }
        const hash = ProcessorUtils.computeHashForString(htmlString || text);

        return {
            type: ClipboardType.HTML,
            text,
            preview,
            hash,
            has_images: hasImages,
            html_data: htmlResult.data,
        };
    }

    /**
     * Save HTML items to storage.
     *
     * @param {Object} item The item to save.
     * @param {string} textsDir Directory for text files.
     * @param {boolean} forceFileSave If true, always save text fallback to file regardless of length.
     * @returns {Promise<Object>} The saved clipboard item.
     */
    static async save(item, textsDir, forceFileSave = false) {
        const baseItem = await TextProcessor.save(
            {
                ...item,
                type: ClipboardType.HTML,
            },
            textsDir,
            forceFileSave,
        );

        // HTML Persistence
        if (item.html_data) {
            const htmlFilename = `${baseItem.id}.html`;
            const htmlPath = GLib.build_filenamev([textsDir, htmlFilename]);
            const success = await IOFile.write(htmlPath, item.html_data);

            if (!success) {
                Logger.error('Failed to save html file', 'HtmlProcessor');
            }
        }

        return {
            ...baseItem,
            has_images: Boolean(item.has_images),
        };
    }

    /**
     * Extract embedded images from a stored HTML item.
     *
     * @param {Object} itemData Item with HTML content.
     * @param {ClipboardStorage} storage Storage instance for reading files.
     * @returns {Promise<Array<Object>>} Array of extracted image objects.
     */
    static async extractEmbeddedImages(itemData, storage) {
        if (!itemData?.has_images) return [];

        const htmlPath = GLib.build_filenamev([storage.textsDir, `${itemData.id}.html`]);
        const rawBytes = await storage.readRaw(htmlPath);
        if (!rawBytes) return [];

        const htmlString = IOText.parseBytes(rawBytes);
        if (!htmlString) return [];

        const imgMatches = [...htmlString.matchAll(/<img\b[^>]*?\bsrc=(?:["']([^"']+)["']|([^"'\s>]+))/gi)];
        if (imgMatches.length === 0) return [];

        const sources = imgMatches.map((m) => m[1] || m[2]).filter(Boolean);
        if (sources.length === 0) return [];

        const imageResults = await Promise.all(sources.map((src) => ImageProcessor.fetchImageFromSource(src)));
        return imageResults.filter(Boolean);
    }
}
