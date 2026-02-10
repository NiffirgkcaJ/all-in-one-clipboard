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
