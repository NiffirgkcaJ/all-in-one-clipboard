import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

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
        return new Promise((resolve) => {
            St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD, (_, text) => {
                if (text && text.trim().length > 0) {
                    const hash = ProcessorUtils.computeHashForString(text);

                    resolve({
                        type: ClipboardType.TEXT,
                        text: text,
                        preview: text.substring(0, MAX_PREVIEW_LENGTH).replace(/\s+/g, ' '),
                        hash: hash,
                    });
                } else {
                    resolve(null);
                }
            });
        });
    }

    /**
     * Saves text items. Required by ClipboardManager.
     */
    static save(extractedData, textsDir) {
        const { text, hash, type } = extractedData;
        const id = ProcessorUtils.generateUUID();

        let has_full_content = false;

        // Save long text to file
        if (text && text.length > MAX_PREVIEW_LENGTH) {
            try {
                const filename = `${id}.txt`;
                const file = Gio.File.new_for_path(GLib.build_filenamev([textsDir, filename]));
                const bytes = new GLib.Bytes(new TextEncoder().encode(text));
                file.replace_contents(bytes.get_data(), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
                has_full_content = true;
            } catch (e) {
                console.error(`[AIO-Clipboard] TextProcessor: Failed to save text file: ${e.message}`);
            }
        }

        // Use provided type or default to text
        const finalType = type || ClipboardType.TEXT;

        // Use existing preview or create one
        let preview = extractedData.preview;
        if (!preview && text) {
            preview = text.substring(0, MAX_PREVIEW_LENGTH).replace(/\s+/g, ' ');
        }

        const item = {
            id,
            type: finalType,
            timestamp: ProcessorUtils.getCurrentTimestamp(),
            preview: preview || '',
            hash,
            has_full_content,
        };

        // For short content (not saved to file), store the text directly in the item
        if (!has_full_content && text) {
            item.text = text;
        }

        // Pass through raw_lines for code items
        if (extractedData.raw_lines) {
            item.raw_lines = extractedData.raw_lines;
        }

        return item;
    }
}
