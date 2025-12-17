import Cairo from 'cairo';
import GLib from 'gi://GLib';

import { IOFile } from '../../../shared/utilities/utilityIO.js';

import { ClipboardType } from '../constants/clipboardConstants.js';
import { ProcessorUtils } from '../utilities/clipboardProcessorUtils.js';

// Configuration
const MAX_COLOR_STRING_LENGTH = 200;

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
 * ColorProcessor - Handles color value detection and gradient generation
 *
 * Pattern: Single-phase (process)
 * - process(): Detects colors, generates gradient images for palettes
 */
export class ColorProcessor {
    /**
     * Extracts color data from the clipboard text.
     * @param {string} text - The text to process.
     * @param {string} imagesDir - Directory to save generated gradient images.
     * @returns {Object|null} An object containing color data or null.
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

        // Single color
        let format = null;
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
     * Process CSS gradient
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
     * Process color palette
     * @private
     */
    static _processPalette(text, imagesDir) {
        let colors = [];

        // Try array format like ["#ff0000", "#00ff00", "#0000ff"]
        if (text.startsWith('[') && text.endsWith(']')) {
            try {
                const parsed = JSON.parse(text);
                if (Array.isArray(parsed)) {
                    colors = parsed.filter((c) => typeof c === 'string' && this._isValidColor(c.trim()));
                }
            } catch {
                // Not valid JSON, continue
            }
        }

        // Try space or comma-separated format
        if (colors.length === 0) {
            colors = this._extractColors(text);
        }

        // Must have at least 2 colors to be a palette
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
     * Parse a CSS color string to RGB values normalized to 0-1 range for Cairo
     * @private
     */
    static _parseColor(colorStr) {
        colorStr = colorStr.trim().toLowerCase();

        // Named colors
        if (NAMED_COLORS[colorStr]) {
            colorStr = NAMED_COLORS[colorStr];
        }

        // Hex colors
        if (colorStr.startsWith('#')) {
            let hex = colorStr.substring(1);

            // Convert 3-digit to 6-digit hex
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

        // Fallback to black
        return [0, 0, 0, 1];
    }

    /**
     * Generate a gradient image using Cairo
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
            // Create 48x24 surface
            const width = 48;
            const height = 24;
            const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, width, height);
            const cr = new Cairo.Context(surface);

            // Create left-to-right linear gradient
            const pattern = new Cairo.LinearGradient(0, 0, width, 0);

            // Add color stops
            colors.forEach((colorStr, index) => {
                const offset = index / (colors.length - 1);
                const [r, g, b, a] = this._parseColor(colorStr);
                pattern.addColorStopRGBA(offset, r, g, b, a);
            });

            // Fill background
            cr.setSource(pattern);
            cr.paint();

            // Save to file
            surface.writeToPNG(filepath);

            return filename;
        } catch (e) {
            console.error(`[ColorProcessor] Failed to generate gradient image: ${e}`);
            return null;
        }
    }

    /**
     * Extract all colors from text
     * @private
     */
    static _extractColors(text) {
        const matches = text.match(COLOR_IN_TEXT_REGEX);
        if (!matches) return [];

        // Deduplicate while preserving order
        const seen = new Set();
        return matches.filter((color) => {
            const normalized = color.toLowerCase();
            if (seen.has(normalized)) return false;
            seen.add(normalized);
            return true;
        });
    }

    /**
     * Check if a string is a valid color
     * @private
     */
    static _isValidColor(text) {
        return HEX_REGEX.test(text) || RGB_REGEX.test(text) || HSL_REGEX.test(text);
    }

    /**
     * Regenerates the gradient image for a color item.
     * @param {Object} item - The clipboard item to heal.
     * @param {string} imagesDir - The directory to save the image to.
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
}
