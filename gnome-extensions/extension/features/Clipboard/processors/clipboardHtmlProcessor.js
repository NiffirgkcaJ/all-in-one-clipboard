import GLib from 'gi://GLib';

import { Logger } from '../../../shared/utilities/utilityLogger.js';
import { clipboardGetContent, clipboardGetText } from '../../../shared/utilities/utilityClipboard.js';
import { IOFile, IOText } from '../../../shared/utilities/utilityIO.js';

import { ClipboardType } from '../constants/clipboardPluginConstants.js';
import { ProcessorUtils } from '../utilities/clipboardProcessorUtils.js';

// Configuration
const MAX_PREVIEW_LENGTH = 500;

/**
 * HtmlProcessor
 *
 * Reads rich HTML content from the clipboard, persists HTML files, and parses image sources.
 */
export class HtmlProcessor {
    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Process HTML content and fallback text into a standard HTML clipboard item payload.
     *
     * @param {Uint8Array|string} source Raw HTML bytes or HTML string.
     * @param {object} [options] Processing options containing optional textFallback.
     * @returns {object|null} Processed HTML item payload or null if empty.
     */
    static process(source, options = {}) {
        if (!source) return null;

        const textFallback = options.textFallback || '';
        const htmlData = typeof source === 'string' ? IOText.stringifyBytes(source) : source;
        if (!htmlData || htmlData.length === 0) return null;

        const htmlString = typeof source === 'string' ? source : IOText.parseBytes(htmlData);
        if (!htmlString) return null;

        const hasImages = Boolean(/<img\b/i.test(htmlString));
        const text = textFallback || '';

        let preview = '';
        if (text) {
            preview = text.substring(0, MAX_PREVIEW_LENGTH).replace(/\s+/g, ' ').trim();
        } else {
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
            html_data: htmlData,
        };
    }

    /**
     * Extract HTML data from the clipboard.
     *
     * @returns {Promise<object|null>} An object containing HTML, text preview, hash, or null if no HTML found.
     */
    static async extract() {
        const htmlResult = await clipboardGetContent('text/html');
        if (!htmlResult || !htmlResult.data || htmlResult.size === 0) return null;

        const text = await clipboardGetText();
        return this.process(htmlResult.data, { textFallback: text || '' });
    }

    /**
     * Save HTML items to storage.
     *
     * @param {object} item The item to save.
     * @param {string} textsDir Directory for text files.
     * @param {boolean} forceFileSave If true, always save text fallback to file regardless of length.
     * @returns {Promise<object>} The saved clipboard item.
     */
    static async save(item, textsDir, forceFileSave = false) {
        const { text, hash } = item;
        const id = ProcessorUtils.generateUUID();

        let has_full_content = false;

        // Text Persistence
        if (text && (forceFileSave || text.length > MAX_PREVIEW_LENGTH)) {
            const filename = `${id}.txt`;
            const destPath = GLib.build_filenamev([textsDir, filename]);
            const success = await IOFile.write(destPath, IOText.stringifyBytes(text));

            if (success) {
                has_full_content = true;
            } else {
                Logger.error('Failed to save fallback text file', 'HtmlProcessor');
            }
        }

        // HTML Persistence
        if (item.html_data) {
            const htmlFilename = `${id}.html`;
            const htmlPath = GLib.build_filenamev([textsDir, htmlFilename]);
            const success = await IOFile.write(htmlPath, item.html_data);

            if (!success) {
                Logger.error('Failed to save html file', 'HtmlProcessor');
            }
        }

        let preview = item.preview;
        if (!preview && text) {
            preview = text.substring(0, MAX_PREVIEW_LENGTH).replace(/\s+/g, ' ');
        }

        const detectedLines = text ? text.replace(/\r?\n+$/, '').split('\n').length : 1;
        const resultItem = {
            id,
            type: ClipboardType.HTML,
            timestamp: ProcessorUtils.getCurrentTimestamp(),
            preview: preview || '',
            hash,
            has_full_content,
            has_images: Boolean(item.has_images),
            raw_lines: item.raw_lines || detectedLines,
        };

        // Inline Persistence
        if (!has_full_content && text) {
            resultItem.text = text;
        }

        return resultItem;
    }

    /**
     * Parse image source URLs from an HTML string.
     *
     * @param {string} htmlString Raw HTML markup string.
     * @returns {Array<string>} Array of image source URL strings.
     */
    static parseImageSources(htmlString) {
        if (!htmlString) return [];

        const imgMatches = [...htmlString.matchAll(/<img\b[^>]*?\bsrc=(?:["']([^"']+)["']|([^"'\s>]+))/gi)];
        if (imgMatches.length === 0) return [];

        return imgMatches.map((m) => m[1] || m[2]).filter(Boolean);
    }
}
