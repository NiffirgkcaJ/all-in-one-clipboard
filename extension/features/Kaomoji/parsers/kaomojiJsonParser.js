import { dgettext } from 'gettext';

const DATA_DOMAIN = 'all-in-one-clipboard-content';

/**
 * Parses the nested `kaomojis.json` format into a flat list of
 * standardized kaomoji objects that the application can easily use.
 * Applies localization to category names, descriptions, and keywords.
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
     *   Each object includes `kaomoji`, `description`, `innerCategory`, `greaterCategory`, and `keywords`.
     */
    parse(jsonData) {
        // Access the 'data' key to get the array we need to process.
        const rawGreaterCategoryData = jsonData.data;
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

            const greaterCategoryName = dgettext(DATA_DOMAIN, greaterCategoryEntry.name.trim());

            for (const innerCategoryEntry of greaterCategoryEntry.categories) {
                // Validate the structure of each sub-category object.
                if (!innerCategoryEntry || typeof innerCategoryEntry.name !== 'string' || !Array.isArray(innerCategoryEntry.emoticons)) {
                    continue;
                }

                const innerCategoryName = dgettext(DATA_DOMAIN, innerCategoryEntry.name.trim());
                const innerCategorySlug = innerCategoryEntry.slug || '';

                for (const emoticonObject of innerCategoryEntry.emoticons) {
                    if (!emoticonObject || typeof emoticonObject.kaomoji !== 'string' || emoticonObject.kaomoji.trim() === '') {
                        continue;
                    }

                    const kaomoji = emoticonObject.kaomoji.trim();
                    // Apply localization to the description if it exists.
                    const description = emoticonObject.description ? dgettext(DATA_DOMAIN, emoticonObject.description) : '';

                    // Apply localization to each provided keyword.
                    const providedKeywords = Array.isArray(emoticonObject.keywords) ? emoticonObject.keywords.map((k) => dgettext(DATA_DOMAIN, k)) : [];

                    const emoticonSlug = emoticonObject.slug || '';

                    // Combine all relevant keywords into a single array.
                    const allKeywords = [kaomoji, description, ...providedKeywords, innerCategoryName, greaterCategoryName, innerCategorySlug, emoticonSlug].filter(Boolean); // Filter out any empty/null values

                    standardizedData.push({
                        kaomoji: kaomoji,
                        description: description,
                        innerCategory: innerCategoryName,
                        greaterCategory: greaterCategoryName,
                        keywords: allKeywords,
                    });
                }
            }
        }
        return standardizedData;
    }
}
