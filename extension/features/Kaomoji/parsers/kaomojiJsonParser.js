/**
 * Parses the nested `kaomojis.json` format into a flat list of
 * standardized kaomoji objects that the application can easily use.
 */
export class KaomojiJsonParser {
    /**
     * @param {string} [extensionUUID] - The UUID of the extension, for logging purposes.
     */
    constructor(extensionUUID = 'KaomojiJsonParser') {
        this._uuid = extensionUUID;
    }

    /**
     * Transforms the raw parsed data from the `kaomojis.json` file.
     *
     * @param {Array<object>} rawGreaterCategoryData - The array parsed directly from `kaomojis.json`.
     * @returns {Array<object>} A flattened array of standardized kaomoji objects.
     *   Each object includes `char`, `innerCategory`, `greaterCategory`, and `keywords`.
     */
    parse(rawGreaterCategoryData) {
        const standardizedData = [];

        if (!Array.isArray(rawGreaterCategoryData)) {
            console.error(`[AIO-Clipboard] Input data is not an array of greater categories.`);
            return [];
        }

        for (const greaterCategoryEntry of rawGreaterCategoryData) {
            // Validate the structure of each top-level category object.
            if (!greaterCategoryEntry || typeof greaterCategoryEntry.name !== 'string' || !Array.isArray(greaterCategoryEntry.categories)) {
                 continue;
            }

            const greaterCategoryName = greaterCategoryEntry.name.trim();

            for (const innerCategoryEntry of greaterCategoryEntry.categories) {
                // Validate the structure of each sub-category object.
                if (!innerCategoryEntry || typeof innerCategoryEntry.name !== 'string' || !Array.isArray(innerCategoryEntry.emoticons)) {
                    continue;
                }

                const innerCategoryName = innerCategoryEntry.name.trim();

                for (const emoticon of innerCategoryEntry.emoticons) {
                    // Validate the emoticon entry.
                    if (typeof emoticon === 'string' && emoticon.trim() !== '') {
                        // Create a keywords array for better searchability.
                        const keywords = [emoticon, innerCategoryName, greaterCategoryName].filter(Boolean);

                        standardizedData.push({
                            char: emoticon.trim(),
                            innerCategory: innerCategoryName,
                            greaterCategory: greaterCategoryName,
                            keywords: keywords
                        });
                    }
                }
            }
        }
        return standardizedData;
    }
}