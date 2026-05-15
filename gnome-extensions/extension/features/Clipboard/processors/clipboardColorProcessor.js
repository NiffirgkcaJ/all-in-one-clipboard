import Cairo from 'cairo';
import GLib from 'gi://GLib';

import { IOFile } from '../../../shared/utilities/utilityIO.js';
import { ServiceJson } from '../../../shared/services/serviceJson.js';

import { ClipboardType } from '../constants/clipboardConstants.js';
import { ProcessorUtils } from '../utilities/clipboardProcessorUtils.js';

// Configuration
const MAX_COLOR_STRING_LENGTH = 200;
const GRADIENT_WIDTH = 48;
const GRADIENT_HEIGHT = 24;

// Validation Patterns
const HEX_REGEX = /^#(?:[0-9a-fA-F]{3,4}){1,2}$/;
const RGB_REGEX = /^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i;
const HSL_REGEX = /^hsla?\(\s*\d+\s*,\s*\d+%\s*,\s*\d+%\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i;
const GRADIENT_REGEX = /^(linear-gradient|radial-gradient|conic-gradient|repeating-linear-gradient|repeating-radial-gradient|repeating-conic-gradient)\(/i;

// Detection Patterns
const COLOR_IN_TEXT_REGEX = /#(?:[0-9a-fA-F]{3,4}){1,2}\b|rgba?\([^)]+\)|hsla?\([^)]+\)|\b(?:red|blue|green|yellow|orange|purple|pink|cyan|magenta|white|black|gray|grey)\b/gi;

// Named colors map
const NAMED_COLORS = {
    red: '#ff0000',
    blue: '#0000ff',
    green: '#008000',
    yellow: '#ffff00',
    orange: '#ffa500',
    purple: '#800080',
    pink: '#ffc0cb',
    cyan: '#00ffff',
    magenta: '#ff00ff',
    white: '#ffffff',
    black: '#000000',
    gray: '#808080',
    grey: '#808080',
};

/**
 * ColorProcessor
 *
 * Detects single colors or palettes and generates linear gradient images for previews.
 */
export class ColorProcessor {
    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Extract color data from the clipboard text and handle gradients or palettes.
     *
     * @param {string} text The text to process.
     * @param {string} imagesDir Directory to save generated gradient images.
     * @returns {Object|null} An object containing color data or null if no color was detected.
     */
    static process(text, imagesDir) {
        if (!text) return null;
        const cleanText = text.trim();

        if (cleanText.includes('\n')) return null;

        if (cleanText.length > MAX_COLOR_STRING_LENGTH) return null;

        // Gradient
        if (GRADIENT_REGEX.test(cleanText)) {
            return this._processGradient(cleanText, imagesDir);
        }

        // Palette
        const paletteResult = this._processPalette(cleanText, imagesDir);
        if (paletteResult) {
            return paletteResult;
        }

        let format = null;

        // Formats
        if (HEX_REGEX.test(cleanText)) {
            format = 'HEX';
        } else if (RGB_REGEX.test(cleanText)) {
            format = cleanText.toLowerCase().startsWith('rgba') ? 'RGBA' : 'RGB';
        } else if (HSL_REGEX.test(cleanText)) {
            format = cleanText.toLowerCase().startsWith('hsla') ? 'HSLA' : 'HSL';
        }

        if (format) {
            const hash = ProcessorUtils.computeHashForString(cleanText);

            return {
                type: ClipboardType.COLOR,
                subtype: 'single',
                color_value: cleanText,
                format_type: format,
                hash: hash,
            };
        }

        return null;
    }

    /**
     * Regenerate the gradient image for a color item during data healing.
     *
     * @param {Object} item The clipboard item to heal.
     * @param {string} imagesDir The directory to save the image to.
     * @returns {boolean} True if regeneration succeeded.
     */
    static regenerateGradient(item, imagesDir) {
        if (!item.gradient_filename || !imagesDir) return false;

        if (item.colors && item.colors.length >= 2) {
            const filename = this._generateGradientImage(item.colors, item.hash, imagesDir);
            return filename !== null;
        }

        if (item.color_value) {
            const colors = this._extractColors(item.color_value);

            if (colors.length >= 2) {
                const filename = this._generateGradientImage(colors, item.hash, imagesDir);
                return filename !== null;
            }
        }

        return false;
    }

    // ========================================================================
    // Internal Helpers
    // ========================================================================

    /**
     * Process a CSS gradient string and generate a preview image.
     *
     * @param {string} text The gradient string.
     * @param {string} imagesDir Directory to save the preview.
     * @returns {Object|null} Color data object or null.
     * @private
     */
    static _processGradient(text, imagesDir) {
        const colors = this._extractColors(text);
        if (colors.length < 2) return null;

        const hash = ProcessorUtils.computeHashForString(text);
        const filename = this._generateGradientImage(colors, hash, imagesDir);

        return {
            type: ClipboardType.COLOR,
            subtype: 'gradient',
            color_value: text,
            colors: colors,
            gradient_filename: filename,
            format_type: 'Gradient',
            hash: hash,
        };
    }

    /**
     * Process a potential color palette from text.
     *
     * @param {string} text Input text.
     * @param {string} imagesDir Directory to save the preview.
     * @returns {Object|null} Color data object or null.
     * @private
     */
    static _processPalette(text, imagesDir) {
        let colors = [];

        // Array
        if (text.startsWith('[') && text.endsWith(']')) {
            try {
                const parsed = ServiceJson.parseText(text);
                if (Array.isArray(parsed)) {
                    colors = parsed.filter((c) => typeof c === 'string' && this._isValidColor(c.trim()));
                }
            } catch {
                // Ignore parsing errors for non-JSON content.
            }
        }

        // List
        if (colors.length === 0) {
            colors = this._extractColors(text);
        }

        if (colors.length >= 2) {
            const hash = ProcessorUtils.computeHashForString(text);
            const filename = this._generateGradientImage(colors, hash, imagesDir);

            return {
                type: ClipboardType.COLOR,
                subtype: 'palette',
                color_value: text,
                colors: colors,
                gradient_filename: filename,
                format_type: `Palette (${colors.length})`,
                hash: hash,
            };
        }

        return null;
    }

    /**
     * Parse a CSS color string into RGB values normalized for Cairo.
     *
     * @param {string} colorStr CSS color string.
     * @returns {Array<number>} Array of [r, g, b, a] values.
     * @private
     */
    static _parseColor(colorStr) {
        colorStr = colorStr.trim().toLowerCase();

        // Named
        if (NAMED_COLORS[colorStr]) {
            colorStr = NAMED_COLORS[colorStr];
        }

        // HEX
        if (colorStr.startsWith('#')) {
            let hex = colorStr.substring(1);

            if (hex.length === 3) {
                hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
            }

            if (hex.length === 6) {
                const r = parseInt(hex.substring(0, 2), 16) / 255;
                const g = parseInt(hex.substring(2, 4), 16) / 255;
                const b = parseInt(hex.substring(4, 6), 16) / 255;
                return [r, g, b, 1.0];
            }
        }

        // RGB/RGBA
        const rgbMatch = colorStr.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/);

        if (rgbMatch) {
            const r = parseInt(rgbMatch[1]) / 255;
            const g = parseInt(rgbMatch[2]) / 255;
            const b = parseInt(rgbMatch[3]) / 255;
            const a = rgbMatch[4] ? parseFloat(rgbMatch[4]) : 1.0;
            return [r, g, b, a];
        }

        return [0, 0, 0, 1];
    }

    /**
     * Extract all valid color strings from the given text.
     *
     * @param {string} text Input text.
     * @returns {Array<string>} List of detected color strings.
     * @private
     */
    static _extractColors(text) {
        const matches = text.match(COLOR_IN_TEXT_REGEX);
        if (!matches) return [];

        const seen = new Set();

        return matches.filter((color) => {
            const normalized = color.toLowerCase();
            if (seen.has(normalized)) return false;
            seen.add(normalized);
            return true;
        });
    }

    /**
     * Check if a string represents a valid CSS color format.
     *
     * @param {string} text Input string.
     * @returns {boolean} True if valid.
     * @private
     */
    static _isValidColor(text) {
        return HEX_REGEX.test(text) || RGB_REGEX.test(text) || HSL_REGEX.test(text);
    }

    // ========================================================================
    // Gradient Generation
    // ========================================================================

    /**
     * Generate a linear gradient preview image using Cairo.
     *
     * @param {Array<string>} colors List of colors for the gradient.
     * @param {string} hash Hash of the content for the filename.
     * @param {string} imagesDir Directory to save the generated image.
     * @returns {string|null} Filename of the generated image or null on failure.
     * @private
     */
    static _generateGradientImage(colors, hash, imagesDir) {
        if (!imagesDir) return null;

        const filename = `gradient_${hash}.png`;
        const filepath = GLib.build_filenamev([imagesDir, filename]);

        if (IOFile.existsSync(filepath)) {
            return filename;
        }

        try {
            const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, GRADIENT_WIDTH, GRADIENT_HEIGHT);
            const cr = new Cairo.Context(surface);

            const pattern = new Cairo.LinearGradient(0, 0, GRADIENT_WIDTH, 0);

            colors.forEach((colorStr, index) => {
                const offset = index / (colors.length - 1);
                const [r, g, b, a] = this._parseColor(colorStr);
                pattern.addColorStopRGBA(offset, r, g, b, a);
            });

            cr.setSource(pattern);
            cr.paint();

            surface.writeToPNG(filepath);

            return filename;
        } catch (e) {
            console.error(`[ColorProcessor] Failed to generate gradient image: ${e}`);
            return null;
        }
    }
}
