import { ClipboardType } from '../constants/clipboardConstants.js';
import { ProcessorUtils } from '../utilities/clipboardProcessorUtils.js';

// Configuration
const PREVIEW_LINE_LIMIT = 10;

// Statistical thresholds for code detection
const STRUCTURAL_CHAR_THRESHOLD = 0.03; // 3% structural chars indicates code
const INDENTATION_THRESHOLD = 0.3; // 30% of lines indented
const CODE_LINE_ENDING_THRESHOLD = 0.15; // 15% lines end with ; { }
const BRACKET_IMBALANCE_THRESHOLD = 5; // Allow up to 5 unbalanced brackets
const NAMING_CONVENTION_THRESHOLD = 0.05; // 5% of words are camelCase/snake_case

// Detection thresholds and scoring
const MIN_TEXT_LENGTH = 5;
const PROSE_REJECTION_THRESHOLD = 3; // Prose score to reject as text
const LARGE_BLOCK_LINE_COUNT = 20; // Lines needed for large block bonus
const SHORT_TEXT_LINE_COUNT = 5; // Lines count for short text threshold
const CODE_SCORE_THRESHOLD = 2.0; // Score needed for code detection
const CODE_SCORE_THRESHOLD_SHORT = 3.5; // Higher threshold for short texts

// Scoring points
const SCORE_STRUCTURAL_BASE = 1;
const SCORE_STRUCTURAL_BONUS = 0.5;
const SCORE_INDENTATION = 1;
const SCORE_LINE_ENDING_BASE = 1;
const SCORE_LINE_ENDING_BONUS = 0.5;
const SCORE_BRACKET_BALANCE = 1.5;
const SCORE_NAMING = 1;
const SCORE_LARGE_BLOCK_BONUS = 0.5;
const PROSE_SCORE_MULTIPLIER = 0.5;

// Prose detection scoring
const PROSE_SCORE_SENTENCE = 1;
const PROSE_SCORE_TITLE = 1;
const PROSE_SCORE_WORDS = 0.5;
const PROSE_SCORE_HEADER = 2;

// Highlighting Colors
const C_KEYWORD = '#ff7b72';
const C_STRING = '#a5d6ff';
const C_COMMENT = '#8b949e';
const C_NUMBER = '#79c0ff';

// Structural characters that appear frequently in code
const STRUCTURAL_CHARS = /[{}[\]();=<>!&|.,:/\\]/g;

// Pattern to detect camelCase or snake_case naming
const CAMEL_CASE_REGEX = /\b[a-z]+[A-Z][a-zA-Z]*\b/g;
const SNAKE_CASE_REGEX = /\b[a-z]+_[a-z_]+\b/g;

// Code line ending patterns - only strong code terminators, NOT ) which appears in prose
const CODE_LINE_ENDING = /[;{}]\s*$/;

// Keywords for syntax highlighting
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

// Regex Patterns for highlighting
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
        if (!text) return null;
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
     * Determines if the given text is likely to be code using statistical analysis.
     * @param {string} text - The text to evaluate.
     * @returns {boolean} True if likely code, false otherwise.
     * @private
     */
    static _isLikelyCode(text) {
        if (!text || text.length < MIN_TEXT_LENGTH) return false;

        const lines = text.split(/\r?\n/);
        const nonEmptyLines = lines.filter((l) => l.trim().length > 0);

        // Filter out comment lines for more accurate code metrics
        const codeLines = nonEmptyLines.filter((l) => {
            const trimmed = l.trim();
            return !trimmed.startsWith('/*') && !trimmed.startsWith('*') && !trimmed.startsWith('//');
        });

        if (nonEmptyLines.length === 0) return false;

        // === EARLY CODE DETECTION ===
        // If text contains code-specific comment syntax, it's definitely code
        const hasCodeComments = nonEmptyLines.some((l) => {
            const trimmed = l.trim();
            return (
                trimmed.startsWith('//') || // JS/C/C++/Java/etc.
                trimmed.startsWith('/*') || // Block comments
                trimmed.startsWith('* ') || // JSDoc continuation
                trimmed.startsWith('*/') || // Block comment end
                trimmed.startsWith('#!') || // Shebang
                trimmed.startsWith('# ') || // Python/Shell comments
                trimmed.startsWith('<!--') || // HTML/XML comments
                trimmed.startsWith('"""') || // Python docstrings
                trimmed.startsWith("'''")
            ); // Python docstrings
        });
        if (hasCodeComments) return true;

        // === PROSE REJECTION (early exit for obvious prose) ===
        // Check if text looks like natural language sentences
        // Use codeLines to avoid triggering on JSDoc/comments which contain prose words
        const proseScore = this._calculateProseScore(codeLines.length > 0 ? codeLines : nonEmptyLines);
        if (proseScore >= PROSE_REJECTION_THRESHOLD) return false; // Strong prose signals = not code

        // Calculate statistical metrics
        const structuralRatio = this._calculateStructuralCharRatio(text);
        const indentationRatio = this._calculateIndentationRatio(lines);
        // Use filtered code lines for code ending ratio
        const codeLineEndingRatio = codeLines.length > 0 ? this._calculateCodeLineEndingRatio(codeLines) : this._calculateCodeLineEndingRatio(nonEmptyLines);
        const bracketBalance = this._checkBracketBalance(text);
        const namingRatio = this._calculateNamingConventionRatio(text);

        // Score based on metrics (each contributes 0-1 points)
        let score = 0;

        // Structural characters ({}[];() etc.)
        if (structuralRatio >= STRUCTURAL_CHAR_THRESHOLD) score += SCORE_STRUCTURAL_BASE;
        if (structuralRatio >= STRUCTURAL_CHAR_THRESHOLD * 2) score += SCORE_STRUCTURAL_BONUS;

        // Indentation (code is typically indented)
        if (indentationRatio >= INDENTATION_THRESHOLD) score += SCORE_INDENTATION;

        // Lines ending with code terminators (;, {, })
        if (codeLineEndingRatio >= CODE_LINE_ENDING_THRESHOLD) score += SCORE_LINE_ENDING_BASE;
        if (codeLineEndingRatio >= CODE_LINE_ENDING_THRESHOLD * 2) score += SCORE_LINE_ENDING_BONUS;

        // Balanced brackets (code almost always has balanced brackets)
        if (bracketBalance) score += SCORE_BRACKET_BALANCE;

        // camelCase/snake_case naming conventions
        if (namingRatio >= NAMING_CONVENTION_THRESHOLD) score += SCORE_NAMING;

        // Bonus for larger code blocks (more confidence)
        if (nonEmptyLines.length > LARGE_BLOCK_LINE_COUNT) score += SCORE_LARGE_BLOCK_BONUS;

        // Subtract prose score from total
        score -= proseScore * PROSE_SCORE_MULTIPLIER;

        // Higher threshold for short texts (more likely to be notes/titles)
        const threshold = nonEmptyLines.length <= SHORT_TEXT_LINE_COUNT ? CODE_SCORE_THRESHOLD_SHORT : CODE_SCORE_THRESHOLD;

        // Threshold: need at least threshold points to be considered code
        return score >= threshold;
    }

    /**
     * Calculate prose score - higher means more likely to be natural language.
     * @private
     */
    static _calculateProseScore(lines) {
        let score = 0;

        for (const line of lines) {
            const trimmed = line.trim();

            // Sentence-like: starts with capital, contains spaces, ends with period/punctuation
            if (/^[A-Z][a-z].*\s.*[.!?]?$/.test(trimmed) && !trimmed.includes(';') && !trimmed.includes('{')) {
                score += PROSE_SCORE_SENTENCE;
            }

            // Title-like: all words capitalized
            if (/^([A-Z][a-z]+\s*)+$/.test(trimmed)) {
                score += PROSE_SCORE_TITLE;
            }

            // Contains common prose patterns
            if (/\b(the|a|an|is|are|was|were|for|from|with|this|that)\b/i.test(trimmed)) {
                score += PROSE_SCORE_WORDS;
            }

            // Section headers with symbols (•Title•, **Title**, ==Title==, etc.)
            if (/^[•\-*=>#]+.+[•\-*=<#]+$/.test(trimmed) || /^#{1,6}\s+/.test(trimmed)) {
                score += PROSE_SCORE_HEADER;
            }
        }

        return score;
    }

    /**
     * Calculate ratio of structural characters to total characters.
     * @private
     */
    static _calculateStructuralCharRatio(text) {
        const matches = text.match(STRUCTURAL_CHARS) || [];
        return matches.length / text.length;
    }

    /**
     * Calculate ratio of indented lines to total lines.
     * @private
     */
    static _calculateIndentationRatio(lines) {
        const indentedLines = lines.filter((l) => /^(\t|  +)/.test(l)).length;
        return indentedLines / Math.max(lines.length, 1);
    }

    /**
     * Calculate ratio of lines ending with code terminators.
     * @private
     */
    static _calculateCodeLineEndingRatio(lines) {
        const codeEndingLines = lines.filter((l) => CODE_LINE_ENDING.test(l.trim())).length;
        return codeEndingLines / Math.max(lines.length, 1);
    }

    /**
     * Check if brackets are reasonably balanced.
     * @private
     */
    static _checkBracketBalance(text) {
        let balance = { curly: 0, square: 0, paren: 0 };

        for (const char of text) {
            switch (char) {
                case '{':
                    balance.curly++;
                    break;
                case '}':
                    balance.curly--;
                    break;
                case '[':
                    balance.square++;
                    break;
                case ']':
                    balance.square--;
                    break;
                case '(':
                    balance.paren++;
                    break;
                case ')':
                    balance.paren--;
                    break;
            }
        }

        const totalImbalance = Math.abs(balance.curly) + Math.abs(balance.square) + Math.abs(balance.paren);
        const hasBrackets = text.includes('{') || text.includes('[') || text.includes('(');

        // Balanced if total imbalance is small AND there are actually brackets present
        return hasBrackets && totalImbalance <= BRACKET_IMBALANCE_THRESHOLD;
    }

    /**
     * Calculate ratio of camelCase/snake_case words.
     * @private
     */
    static _calculateNamingConventionRatio(text) {
        const words = text.split(/\s+/).filter((w) => w.length > 2);
        if (words.length === 0) return 0;

        const camelCaseMatches = text.match(CAMEL_CASE_REGEX) || [];
        const snakeCaseMatches = text.match(SNAKE_CASE_REGEX) || [];

        return (camelCaseMatches.length + snakeCaseMatches.length) / words.length;
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
