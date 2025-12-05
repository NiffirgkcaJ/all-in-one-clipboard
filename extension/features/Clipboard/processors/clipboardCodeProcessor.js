import { ClipboardType } from '../constants/clipboardConstants.js';
import { ProcessorUtils } from '../utilities/clipboardProcessorUtils.js';

// Configuration
const MAX_TEXT_LENGTH = 50000;
const PREVIEW_LINE_LIMIT = 10;

// Code detection thresholds
const SINGLE_LINE_THRESHOLD = 2.5;
const FEW_LINES_THRESHOLD = 3.5;
const DEFAULT_THRESHOLD = 5.0;
const KEYWORD_DENSITY_THRESHOLD = 0.08;

// Highlighting Colors
const C_KEYWORD = '#ff7b72';
const C_STRING = '#a5d6ff';
const C_COMMENT = '#8b949e';
const C_NUMBER = '#79c0ff';

// Strong Code Patterns
const CODE_PATTERNS = {
    IMPORT_EXPORT: /^\s*(import|export)\s+.+(from\s+['"]|;)/,
    DECLARATION: /^\s*(const|let|var)\s+\w+\s*=/,
    FUNCTION_DEF: /^\s*(function\s+\w+\s*\(|const\s+\w+\s*=\s*\(.*\)\s*=>|=>\s*{)/,
    DESTRUCTURING: /^\s*(const|let|var)\s*[{[].*[}\]]\s*=/,
    METHOD_CHAIN: /\.\w+\s*\(.*\)\s*[.;]/,
    CONTROL_FLOW: /^\s*(if|for|while|switch)\s*\(/,
    RETURN_STATEMENT: /^\s*return\s+[^;]+;/,
};

// Prose Anti-Patterns
const PROSE_PATTERNS = {
    NUMBERED_LIST: /^\s*\d+\.\s+[A-Z]/,
    QUESTION: /\?\s*$/,
    PROPER_NOUNS: /\b[A-Z][a-z]+(\s+[A-Z][a-z]+){2,}\b/,
    SENTENCE_START: /^\s*(Now|Okay|However|Although|But|And|Or|So|These|Those|What|Can|Do|Let me|Right now|Also)\s/,
    NATURAL_WORDS: /\b\w{12,}\b/,
};

// Heuristics & Tokenization
const KEYWORDS = [
    'function',
    'return',
    'var',
    'let',
    'const',
    'if',
    'else',
    'for',
    'while',
    'class',
    'import',
    'export',
    'from',
    'def',
    'public',
    'private',
    'void',
    'int',
    'bool',
    'string',
    'include',
    'async',
    'await',
    'try',
    'catch',
    'switch',
    'case',
    'break',
    'continue',
    'new',
    'this',
    'typeof',
].join('|');

// Regex Patterns
const REGEX_KEYWORDS = new RegExp(`\\b(${KEYWORDS})\\b`);
const REGEX_STRUCTURAL = /[{}[\]();=<>!&|]/g;
const REGEX_INDENTATION = /^\s{2,}/;
const REGEX_TOKENIZER = new RegExp(`(\\/\\/.*)|((['"])(?:(?=(\\\\?))\\4.)*?\\3)|(\\b(?:${KEYWORDS})\\b)|(\\b\\d+\\b)`, 'g');

/**
 * CodeProcessor - Handles code detection and syntax highlighting
 *
 * Pattern: Single-phase (process)
 * - process(): Detects code using heuristics, generates syntax-highlighted preview
 */
export class CodeProcessor {
    /**
     * Processes clipboard text to determine if it's code and generates a highlighted preview.
     * @param {string} text - The clipboard text content.
     * @returns {object|null} Processed code object or null if not code.
     */
    static process(text) {
        if (!text || text.length > MAX_TEXT_LENGTH) return null;
        const cleanText = text.trim();

        if (!this._isLikelyCode(cleanText)) {
            return null;
        }

        const lines = cleanText.split(/\r?\n/);
        const previewLines = lines.slice(0, PREVIEW_LINE_LIMIT);
        const rawPreviewText = previewLines.join('\n');
        const rawLines = previewLines.length;
        const hash = ProcessorUtils.computeHashForString(cleanText);
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
     * Determines if the given text is likely to be code using multi-signal detection.
     * @param {string} text - The text to evaluate.
     * @returns {boolean} True if likely code, false otherwise.
     * @private
     */
    static _isLikelyCode(text) {
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        const totalLines = lines.length;

        // Strong Code Pattern Detection
        if (this._checkStrongPatterns(lines)) return true;

        // Prose Anti-Pattern Detection
        if (this._checkProsePatterns(lines)) return false;

        // Heuristic Scoring
        let score = this._calculateHeuristicScore(lines, text);

        // Dynamic Threshold
        let threshold = DEFAULT_THRESHOLD;

        if (totalLines === 1) {
            threshold = SINGLE_LINE_THRESHOLD;
        } else if (totalLines <= 3) {
            threshold = FEW_LINES_THRESHOLD;
        }

        const density = this._analyzeKeywordDensity(text);
        if (density.isCodeLike) {
            score += 2;
        } else if (density.ratio < KEYWORD_DENSITY_THRESHOLD / 4) {
            score -= 2;
        }

        return score >= threshold;
    }

    /**
     * Checks for strong code patterns in the text.
     * @param {Array<string>} lines - The lines to check.
     * @returns {boolean} True if strong code patterns are found.
     * @private
     */
    static _checkStrongPatterns(lines) {
        let codePatternMatches = 0;
        const totalLines = lines.length;

        for (const line of lines.slice(0, 10)) {
            const trimmed = line.trim();
            for (const pattern of Object.values(CODE_PATTERNS)) {
                if (pattern.test(trimmed)) {
                    codePatternMatches++;
                    break;
                }
            }
        }

        if (totalLines <= 5 && codePatternMatches >= 1) return true;
        if (totalLines > 5 && codePatternMatches / totalLines > 0.3) return true;

        return false;
    }

    /**
     * Checks for prose anti-patterns in the text.
     * @param {Array<string>} lines - The lines to check.
     * @returns {boolean} True if prose patterns are found.
     * @private
     */
    static _checkProsePatterns(lines) {
        let proseSignals = 0;
        for (const line of lines.slice(0, 10)) {
            for (const pattern of Object.values(PROSE_PATTERNS)) {
                if (pattern.test(line)) {
                    proseSignals++;
                    break;
                }
            }
        }
        return proseSignals >= 3;
    }

    /**
     * Calculates a heuristic score for the text based on code characteristics.
     * @param {Array<string>} lines - The lines to analyze.
     * @param {string} text - The full text content.
     * @returns {number} The calculated score.
     * @private
     */
    static _calculateHeuristicScore(lines, text) {
        let score = 0;

        if (text.startsWith('<') && text.endsWith('>')) score += 5;

        const sampleLines = lines.slice(0, 15);

        for (const line of sampleLines) {
            const trimmed = line.trim();

            if (REGEX_INDENTATION.test(line)) score += 0.5;

            const structureCount = (trimmed.match(REGEX_STRUCTURAL) || []).length;
            score += structureCount * 0.3;

            if (trimmed.endsWith(';')) score += 1.5;

            if (REGEX_KEYWORDS.test(trimmed)) {
                const hasCapitalStart = /^[A-Z]/.test(trimmed);
                const hasEndPunctuation = /[.!?]$/.test(trimmed);

                if (hasCapitalStart && hasEndPunctuation) {
                    score -= 0.5;
                } else {
                    score += 1.5;
                }
            }

            if (/^[A-Z].*[.!?]$/.test(trimmed) && trimmed.includes(' ')) {
                score -= 2;
            }
        }

        return score;
    }

    /**
     * Analyzes keyword density to distinguish code from technical prose.
     * @param {string} text - The text to analyze.
     * @returns {Object} { ratio: number, isCodeLike: boolean }
     * @private
     */
    static _analyzeKeywordDensity(text) {
        const words = text.split(/\s+/);
        const keywordMatches = words.filter((w) => REGEX_KEYWORDS.test(w)).length;
        const ratio = keywordMatches / Math.max(words.length, 1);

        return {
            ratio,
            isCodeLike: ratio > KEYWORD_DENSITY_THRESHOLD,
        };
    }

    /**
     * Applies syntax highlighting to code text.
     * @param {string} text - The code text to highlight.
     * @returns {string} Highlighted HTML string.
     * @private
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

    /**
     * Escapes HTML entities in a string.
     * @param {string} str - The string to escape.
     * @returns {string} The escaped string.
     * @private
     */
    static _escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    }
}
