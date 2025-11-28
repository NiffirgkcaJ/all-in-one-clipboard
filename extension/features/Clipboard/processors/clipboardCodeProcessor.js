import GLib from 'gi://GLib';

import { ClipboardType } from '../constants/clipboardConstants.js';

// Configuration
const PREVIEW_LINE_LIMIT = 10;
const MIN_SCORE_THRESHOLD = 5;

// Highlighting Colors
const C_KEYWORD = '#ff7b72';
const C_STRING = '#a5d6ff';
const C_COMMENT = '#8b949e';
const C_NUMBER = '#79c0ff';

// Regex Definitions
const REGEX_KEYWORDS =
    /\b(function|return|var|let|const|if|else|for|while|class|import|export|from|def|public|private|void|int|bool|string|include|async|await|try|catch|switch|case|break|continue|new|this|typeof)\b/;
const REGEX_STRUCTURAL = /[{}[\]();=<>!&|]/g; // Added 'g' flag for counting
const REGEX_INDENTATION = /^\s{2,}/;
const REGEX_TOKENIZER =
    /(\/\/.*)|((['"])(?:(?=(\\?))\4.)*?\3)|(\b(?:function|return|var|let|const|if|else|for|while|class|import|export|from|def|public|private|void|int|bool|string|include|async|await|try|catch|switch|case|break|continue|new|this|typeof)\b)|(\b\d+\b)/g;

export class CodeProcessor {
    /**
     * Processes clipboard text to determine if it's code and generates a highlighted preview.
     * @param {string} text - The clipboard text content.
     * @returns {object|null} Processed code object or null if not code.
     */
    static process(text) {
        if (!text || text.length > 50000) return null;
        const cleanText = text.trim();

        if (!this._isLikelyCode(cleanText)) {
            return null;
        }

        const lines = cleanText.split(/\r?\n/);
        const previewLines = lines.slice(0, PREVIEW_LINE_LIMIT);
        const rawPreviewText = previewLines.join('\n');
        const rawLines = previewLines.length;

        const hash = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, cleanText, -1);

        const highlightedPreview = this._highlight(rawPreviewText);

        return {
            type: ClipboardType.CODE,
            text: cleanText,
            preview: highlightedPreview,
            raw_lines: rawLines,
            hash: hash,
        };
    }

    /**
     * Determines if the given text is likely to be code based on heuristics.
     * @param {string} text - The text to evaluate.
     * @returns {boolean} True if likely code, false otherwise.
     */
    static _isLikelyCode(text) {
        const lines = text.split(/\r?\n/).slice(0, 15);
        let score = 0;

        if (text.startsWith('<') && text.endsWith('>')) score += 5;

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.length === 0) continue;

            if (REGEX_INDENTATION.test(line)) score += 0.5;

            const structureCount = (trimmed.match(REGEX_STRUCTURAL) || []).length;
            if (structureCount > 0) score += structureCount * 0.2;

            if (REGEX_KEYWORDS.test(trimmed)) score += 2;

            if (/^[A-Z].*\.$/.test(trimmed) && trimmed.includes(' ')) score -= 1;
        }

        return score >= MIN_SCORE_THRESHOLD;
    }

    /**
     * Escapes HTML entities in a string.
     * @param {string} str - The string to escape.
     * @returns {string} The escaped string.
     */
    static _escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    }

    /**
     * Applies syntax highlighting to code text.
     * @param {string} text - The code text to highlight.
     * @returns {string} Highlighted HTML string.
     */
    static _highlight(text) {
        let output = '';
        let lastIndex = 0;
        let match;

        REGEX_TOKENIZER.lastIndex = 0;

        while ((match = REGEX_TOKENIZER.exec(text)) !== null) {
            output += this._escapeHtml(text.slice(lastIndex, match.index));

            const fullMatch = match[0];
            const escapedMatch = this._escapeHtml(fullMatch);

            if (match[1]) {
                output += `<span foreground="${C_COMMENT}">${escapedMatch}</span>`;
            } else if (match[2]) {
                output += `<span foreground="${C_STRING}">${escapedMatch}</span>`;
            } else if (match[5]) {
                output += `<span foreground="${C_KEYWORD}"><b>${escapedMatch}</b></span>`;
            } else if (match[6]) {
                output += `<span foreground="${C_NUMBER}">${escapedMatch}</span>`;
            } else {
                output += escapedMatch;
            }

            lastIndex = REGEX_TOKENIZER.lastIndex;
        }

        output += this._escapeHtml(text.slice(lastIndex));

        return output;
    }
}
