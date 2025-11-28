import GLib from 'gi://GLib';

import { ClipboardType } from '../constants/clipboardConstants.js';

// Strict regexes to avoid false positives in normal text
const HEX_REGEX = /^#(?:[0-9a-fA-F]{3,4}){1,2}$/;
const RGB_REGEX = /^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i;
const HSL_REGEX = /^hsla?\(\s*\d+\s*,\s*\d+%\s*,\s*\d+%\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i;

export class ColorProcessor {
    /**
     * Extracts color data from the clipboard text.
     * @param {string} text - The text to process.
     * @returns {Object|null} An object containing color data or null.
     */
    static process(text) {
        if (!text) return null;
        const cleanText = text.trim();

        let format = null;

        if (HEX_REGEX.test(cleanText)) {
            format = 'HEX';
        } else if (RGB_REGEX.test(cleanText)) {
            format = cleanText.toLowerCase().startsWith('rgba') ? 'RGBA' : 'RGB';
        } else if (HSL_REGEX.test(cleanText)) {
            format = cleanText.toLowerCase().startsWith('hsla') ? 'HSLA' : 'HSL';
        }

        if (format) {
            const hash = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, cleanText, -1);

            return {
                type: ClipboardType.COLOR,
                color_value: cleanText,
                format_type: format,
                hash: hash,
            };
        }

        return null;
    }
}
