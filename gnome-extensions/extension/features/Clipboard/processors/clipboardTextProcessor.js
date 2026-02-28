import GLib from 'gi://GLib';

import { IOFile } from '../../../shared/utilities/utilityIO.js';
import { clipboardGetText } from '../../../shared/utilities/utilityClipboard.js';
import { ServiceText } from '../../../shared/services/serviceText.js';

import { ClipboardType } from '../constants/clipboardConstants.js';
import { ProcessorUtils } from '../utilities/clipboardProcessorUtils.js';

// Configuration
const MAX_PREVIEW_LENGTH = 500;

/**
 * TextProcessor - Handles text clipboard data
 *
 * Pattern: Two-phase (extract + save)
 * - extract(): Reads raw text from clipboard
 * - save(): Persists long text to files, delegates to secondary processors (Code, Link, Contact, Color)
 */
export class TextProcessor {
    /**
     * Extracts text data from the clipboard.
     * @returns {Promise<Object|null>} An object containing text, hash, and bytes, or null if no text found.
     */
    static async extract() {
        const text = await clipboardGetText();
        if (!text) return null;

        const hash = ProcessorUtils.computeHashForString(text);

        return {
            type: ClipboardType.TEXT,
            text: text,
            preview: text.substring(0, MAX_PREVIEW_LENGTH).replace(/\s+/g, ' '),
            hash: hash,
        };
    }

    /**
     * Saves text items. Required by ClipboardManager.
     * @param {Object} item - The item to save
     * @param {string} textsDir - Directory for text files
     * @param {boolean} forceFileSave - If true, always save to file regardless of length
     */
    static async save(item, textsDir, forceFileSave = false) {
        const { text, hash, type } = item;
        const id = ProcessorUtils.generateUUID();

        let has_full_content = false;

        if (text && (forceFileSave || text.length > MAX_PREVIEW_LENGTH)) {
            const filename = `${id}.txt`;
            const destPath = GLib.build_filenamev([textsDir, filename]);
            const success = await IOFile.write(destPath, ServiceText.toBytes(text));
            if (success) {
                has_full_content = true;
            } else {
                console.error(`[AIO-Clipboard] TextProcessor: Failed to save text file`);
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
            raw_lines: item.raw_lines || 0,
        };

        // Preserve exact short text content since it bypasses file storage
        if (!has_full_content && text) {
            resultItem.text = text;
        }

        return resultItem;
    }
}
