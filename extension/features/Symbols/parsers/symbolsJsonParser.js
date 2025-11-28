import { dgettext } from 'gettext';

const DATA_DOMAIN = 'all-in-one-clipboard-content';

/**
 * Parses the `symbols.json` format into a flat list of standardized
 * symbol objects that the application can easily use.
 * Applies localization to category and symbol names.
 */
export class SymbolsJsonParser {
    /**
     * @param {string} [extensionUUID] - The UUID of the extension, for logging purposes.
     */
    constructor(extensionUUID = 'SymbolsJsonParser') {
        this._uuid = extensionUUID;
    }

    /**
     * Transforms the raw parsed data from the `symbols.json` file.
     * The input format is an array of objects, where each object has a 'name'
     * for the category and a 'symbols' array of symbol objects.
     *
     * @param {Array<object>} rawCategoryData - The array parsed directly from `symbols.json`.
     * @returns {Array<object>} A flattened array of standardized symbol objects.
     *   Each object includes `symbol`, `name`, `category`, `codepoint`, and `keywords`.
     */
    parse(jsonData) {
        // Access the 'data' key to get the array we need to process.
        const rawCategoryData = jsonData.data;
        const standardizedData = [];

        if (!Array.isArray(rawCategoryData)) {
            console.error(`[AIO-Clipboard] Symbols data is not an array of categories.`);
            return [];
        }

        for (const categoryEntry of rawCategoryData) {
            // Validate the structure of each top-level category object.
            if (!categoryEntry || typeof categoryEntry.name !== 'string' || !Array.isArray(categoryEntry.symbols)) {
                continue;
            }

            const categoryName = dgettext(DATA_DOMAIN, categoryEntry.name.trim());

            // Loop through symbol objects instead of strings.
            for (const symbolObject of categoryEntry.symbols) {
                // Validate the new symbol object structure.
                if (!symbolObject || typeof symbolObject.symbol !== 'string' || typeof symbolObject.name !== 'string') {
                    continue;
                }

                const symbolChar = symbolObject.symbol.trim();
                if (symbolChar === '') continue;

                // Localize the symbol name.
                const symbolName = dgettext(DATA_DOMAIN, symbolObject.name);
                const codepoint = symbolObject.codepoint || '';

                // Collect keywords for searching.
                const allKeywords = [
                    symbolObject.symbol.trim(),
                    symbolName,
                    categoryName,
                    codepoint,
                    codepoint.replace(/^u\+/i, ''), // Search without the "U+" prefix
                    categoryEntry.slug || '',
                    symbolObject.category_code || '',
                ].filter(Boolean); // Filter out any empty/null values

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
