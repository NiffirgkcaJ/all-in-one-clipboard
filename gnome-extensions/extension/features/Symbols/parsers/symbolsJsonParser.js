import { dgettext } from 'gettext';

// Private Constant
const DATA_DOMAIN = 'all-in-one-clipboard-content';

/**
 * SymbolsJsonParser
 *
 * Parses the symbols.json format into a flat list of standardized symbol objects.
 * Applies localization to category and symbol names.
 */
export class SymbolsJsonParser {
    // ========================================================================
    // Initialization
    // ========================================================================

    /**
     * Initializes the parser.
     *
     * @param {string} [extensionUUID] The UUID of the extension, for logging purposes.
     */
    constructor(extensionUUID = 'SymbolsJsonParser') {
        this._uuid = extensionUUID;
    }

    /**
     * Transforms the raw parsed data from the symbols.json file.
     *
     * @param {Array<object>} jsonData The array parsed directly from symbols.json.
     * @returns {Array<object>} A flattened array of standardized symbol objects. Each object includes symbol, name, category, codepoint, and keywords.
     */
    parse(jsonData) {
        const rawCategoryData = jsonData.data;
        const standardizedData = [];

        if (!Array.isArray(rawCategoryData)) {
            console.error(`[AIO-Clipboard] Symbols data is not an array of categories.`);
            return [];
        }

        for (const categoryEntry of rawCategoryData) {
            if (!categoryEntry || typeof categoryEntry.name !== 'string' || !Array.isArray(categoryEntry.symbols)) {
                continue;
            }

            const categoryName = dgettext(DATA_DOMAIN, categoryEntry.name.trim());

            for (const symbolObject of categoryEntry.symbols) {
                if (!symbolObject || typeof symbolObject.symbol !== 'string' || typeof symbolObject.name !== 'string') {
                    continue;
                }

                const symbolChar = symbolObject.symbol.trim();
                if (symbolChar === '') continue;

                const symbolName = dgettext(DATA_DOMAIN, symbolObject.name);
                const codepoint = symbolObject.codepoint || '';

                const allKeywords = [
                    symbolObject.symbol.trim(),
                    symbolName,
                    categoryName,
                    codepoint,
                    codepoint.replace(/^u\+/i, ''),
                    categoryEntry.slug || '',
                    symbolObject.category_code || '',
                ].filter(Boolean);

                standardizedData.push({
                    symbol: symbolObject.symbol.trim(),
                    name: symbolName,
                    category: categoryName,
                    codepoint: codepoint,
                    keywords: allKeywords,
                });
            }
        }
        return standardizedData;
    }
}
