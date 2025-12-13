import GLib from 'gi://GLib';
import St from 'gi://St';

import { IOFile } from '../../../shared/utilities/utilityIO.js';
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
    static async save(item, textsDir) {
        const { text, hash, type } = item;
        const id = ProcessorUtils.generateUUID();

        let has_full_content = false;

        // Save long text to file
        if (text && text.length > MAX_PREVIEW_LENGTH) {
            const filename = `${id}.txt`;
            const destPath = GLib.build_filenamev([textsDir, filename]);
            const success = await IOFile.write(destPath, ServiceText.toBytes(text));
            if (success) {
                has_full_content = true;
            } else {
                console.error(`[AIO-Clipboard] TextProcessor: Failed to save text file`);
            }
        }

        // Use provided type or default to text
        const finalType = type || ClipboardType.TEXT;

        // Use existing preview or create one
        let preview = item.preview;
        if (!preview && text) {
            preview = text.substring(0, MAX_PREVIEW_LENGTH).replace(/\s+/g, ' ');
        }

        const finalItem = {
            id,
            type: finalType,
            timestamp: ProcessorUtils.getCurrentTimestamp(),
            preview: preview || '',
            hash,
            has_full_content,
        };

        return finalItem;
    }
}
