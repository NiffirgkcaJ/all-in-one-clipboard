/**
 * Parses the `symbols.json` format into a flat list of standardized
 * symbol objects that the application can easily use.
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
     * for the category and a 'symbols' array of character strings.
     *
     * @param {Array<object>} rawCategoryData - The array parsed directly from `symbols.json`.
     * @returns {Array<object>} A flattened array of standardized symbol objects.
     *   Each object includes `char`, `value`, `category`, and `name`.
     */
    parse(rawCategoryData) {
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

            const categoryName = categoryEntry.name.trim();

            for (const symbolChar of categoryEntry.symbols) {
                if (typeof symbolChar === 'string' && symbolChar.trim() !== '') {
                    const trimmedSymbol = symbolChar.trim();

                    // Create the flat object that the viewer needs.
                    standardizedData.push({
                        char: trimmedSymbol,
                        value: trimmedSymbol, // For the recents manager
                        category: categoryName,
                        name: `${categoryName}: ${trimmedSymbol}` // A descriptive name for tooltips and accessibility
                    });
                }
            }
        }
        return standardizedData;
    }
}