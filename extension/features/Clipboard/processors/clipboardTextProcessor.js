import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

const TEXT_PREVIEW_MAX_LENGTH = 150;

export class TextProcessor {
    /**
     * Extracts text data from the clipboard.
     * @returns {Promise<Object|null>} An object containing text, hash, and bytes, or null if no text found.
     */
    static async extract() {
        const clipboard = St.Clipboard.get_default();

        // Try to get plain text first
        let text = await new Promise(resolve => {
            clipboard.get_text(St.ClipboardType.CLIPBOARD, (_, t) => resolve(t));
        });

        // If no plain text, try to get URI list
        if (!text || text.trim() === '') {
            const uriBytes = await new Promise(resolve => {
                clipboard.get_content(
                    St.ClipboardType.CLIPBOARD,
                    'text/uri-list',
                    (_, bytes) => resolve(bytes)
                );
            });

            if (uriBytes && uriBytes.get_size() > 0) {
                text = new TextDecoder().decode(uriBytes.get_data());
            }
        }

        if (!text || text.trim() === '') {
            return null;
        }

        const textBytes = new TextEncoder().encode(text);
        const hash = GLib.compute_checksum_for_data(
            GLib.ChecksumType.SHA256,
            textBytes
        );

        return { text, hash, bytes: textBytes };
    }

    /**
     * Saves the text item. If it exceeds the preview length, it saves a file.
     * @param {Object} extractedData - The data returned from extract().
     * @param {string} textsDir - The directory path to store text files.
     * @returns {Object} The final item object to be added to history.
     */
    static save(extractedData, textsDir) {
        const { text, hash, bytes } = extractedData;
        const id = GLib.uuid_string_random();

        // Collapse consecutive spaces/tabs, but preserve newlines
        const preview = text
            .replace(/[ \t]+/g, ' ')
            .trim()
            .substring(0, TEXT_PREVIEW_MAX_LENGTH);

        const has_full_content = text.length > TEXT_PREVIEW_MAX_LENGTH;

        if (has_full_content) {
            try {
                const file = Gio.File.new_for_path(
                    GLib.build_filenamev([textsDir, `${id}.txt`])
                );
                file.replace_contents(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            } catch (e) {
                console.error(`[AIO-Clipboard] Failed to save text file: ${e.message}`);
            }
        }

        return {
            id,
            type: 'text',
            timestamp: Math.floor(Date.now() / 1000),
            preview: has_full_content ? preview : text,
            has_full_content,
            hash
        };
    }
}