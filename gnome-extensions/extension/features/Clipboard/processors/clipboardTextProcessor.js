import GLib from 'gi://GLib';

import { clipboardGetContent, clipboardGetText } from '../../../shared/utilities/utilityClipboard.js';
import { Logger } from '../../../shared/utilities/utilityLogger.js';
import { IOFile, IOText } from '../../../shared/utilities/utilityIO.js';

import { ClipboardType } from '../constants/clipboardPluginConstants.js';
import { ProcessorUtils } from '../utilities/clipboardProcessorUtils.js';

// Configuration
const MAX_PREVIEW_LENGTH = 500;

/**
 * TextProcessor
 *
 * Reads raw text from the clipboard, persists long text to files, and delegates to secondary processors.
 */
export class TextProcessor {
    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Extract text data from the clipboard.
     *
     * @returns {Promise<Object|null>} An object containing text, hash, and bytes, or null if no text found.
     */
    static async extract() {
        const text = await clipboardGetText();
        if (!text) return null;

        const hash = ProcessorUtils.computeHashForString(text);
        const htmlResult = await clipboardGetContent('text/html');
        const hasRichContent = Boolean(htmlResult?.data && htmlResult.size > 0);
        let hasImages = false;

        if (hasRichContent) {
            const htmlString = IOText.parseBytes(htmlResult.data);
            if (htmlString && /<img\b/i.test(htmlString)) {
                hasImages = true;
            }
        }

        return {
            type: ClipboardType.TEXT,
            text,
            preview: text.substring(0, MAX_PREVIEW_LENGTH).replace(/\s+/g, ' '),
            hash,
            has_rich_content: hasRichContent,
            has_images: hasImages,
            html_data: hasRichContent ? htmlResult.data : null,
        };
    }

    /**
     * Save text items to storage.
     *
     * @param {Object} item The item to save.
     * @param {string} textsDir Directory for text files.
     * @param {boolean} forceFileSave If true, always save to file regardless of length.
     * @returns {Promise<Object>} The saved clipboard item.
     */
    static async save(item, textsDir, forceFileSave = false) {
        const { text, hash, type } = item;
        const id = ProcessorUtils.generateUUID();

        let has_full_content = false;

        // File Persistence
        if (text && (forceFileSave || text.length > MAX_PREVIEW_LENGTH)) {
            const filename = `${id}.txt`;
            const destPath = GLib.build_filenamev([textsDir, filename]);
            const success = await IOFile.write(destPath, IOText.stringifyBytes(text));

            if (success) {
                has_full_content = true;
            } else {
                Logger.error('Failed to save text file', 'TextProcessor');
            }
        }

        // Rich Content Persistence
        if (item.has_rich_content && item.html_data) {
            const htmlFilename = `${id}.html`;
            const htmlPath = GLib.build_filenamev([textsDir, htmlFilename]);
            const success = await IOFile.write(htmlPath, item.html_data);

            if (!success) {
                Logger.error('Failed to save html file', 'TextProcessor');
            }
        }

        const finalType = type || ClipboardType.TEXT;

        let preview = item.preview;
        if (!preview && text) {
            preview = text.substring(0, MAX_PREVIEW_LENGTH).replace(/\s+/g, ' ');
        }

        const resultItem = {
            id,
            type: finalType,
            timestamp: ProcessorUtils.getCurrentTimestamp(),
            preview: preview || '',
            hash,
            has_full_content,
            has_rich_content: Boolean(item.has_rich_content && item.html_data),
            has_images: Boolean(item.has_images),
            raw_lines: item.raw_lines || 0,
        };

        // Inline Persistence
        if (!has_full_content && text) {
            resultItem.text = text;
        }

        return resultItem;
    }
}
