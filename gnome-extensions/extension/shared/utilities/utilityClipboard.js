import St from 'gi://St';

/**
 * Set text on both CLIPBOARD and PRIMARY selections.
 * This ensures pasting works consistently across all apps, including terminals.
 *
 * @param {string} text - The text to set
 */
export function clipboardSetText(text) {
    const clipboard = St.Clipboard.get_default();
    clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
    clipboard.set_text(St.ClipboardType.PRIMARY, text);
}

/**
 * Set binary content on both CLIPBOARD and PRIMARY selections.
 * Used for images, file URIs, and other non-text content.
 *
 * @param {string} mimeType - The MIME type of the content
 * @param {GLib.Bytes} bytes - The content bytes
 */
export function clipboardSetContent(mimeType, bytes) {
    const clipboard = St.Clipboard.get_default();
    clipboard.set_content(St.ClipboardType.CLIPBOARD, mimeType, bytes);
    clipboard.set_content(St.ClipboardType.PRIMARY, mimeType, bytes);
}

/**
 * Read text from the CLIPBOARD selection.
 * Wraps the callback-based API in a Promise.
 *
 * @returns {Promise<string|null>} The clipboard text, or null if empty
 */
export function clipboardGetText() {
    return new Promise((resolve) => {
        St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD, (_, text) => {
            resolve(text && text.trim().length > 0 ? text : null);
        });
    });
}

/**
 * Read binary content from the CLIPBOARD selection for a given MIME type.
 * Wraps the callback-based API in a Promise.
 *
 * @param {string} mimeType - The MIME type to request
 * @returns {Promise<{data: Uint8Array, size: number}|null>} The content data, or null if empty
 */
export function clipboardGetContent(mimeType) {
    return new Promise((resolve) => {
        St.Clipboard.get_default().get_content(St.ClipboardType.CLIPBOARD, mimeType, (_clipboard, bytes) => {
            if (bytes && bytes.get_size() > 0) {
                resolve({ data: bytes.get_data(), size: bytes.get_size() });
            } else {
                resolve(null);
            }
        });
    });
}
