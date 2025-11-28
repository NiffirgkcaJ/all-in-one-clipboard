import { dgettext } from 'gettext';

const DATA_DOMAIN = 'all-in-one-clipboard-content';

/**
 * Parses the categorized `emojis.json` format into a flat list of
 * standardized emoji objects that the application can easily use.
 * Applies localization to category names, emoji names, and keywords.
 */
export class EmojiJsonParser {
    /**
     * @param {string} [extensionUUID] - The UUID of the extension, for logging purposes.
     */
    constructor(extensionUUID = 'EmojiJsonParser') {
        this._uuid = extensionUUID;
    }

    /**
     * Transforms the raw parsed data from the `emojis.json` file.
     *
     * @param {Array<object>} rawCategoryData - The array parsed directly from `emojis.json`.
     * @returns {Array<object>} A flattened array of standardized emoji objects.
     *   Each object includes `category`, `char`, `name`, `skinToneSupport`, and `keywords`.
     */
    parse(jsonData) {
        // Access the 'data' key to get the array we need to process.
        const rawCategoryData = jsonData.data;
        const standardizedData = [];

        if (!Array.isArray(rawCategoryData)) {
            console.error(`[AIO-Clipboard] Input data is not an array of categories.`);
            return [];
        }

        for (const category of rawCategoryData) {
            // Validate the structure of each category object.
            if (!category || typeof category.name !== 'string' || !Array.isArray(category.emojis)) {
                continue; // Skip invalid category entries silently.
            }

            const categoryName = dgettext(DATA_DOMAIN, category.name.trim());

            for (const rawEmojiEntry of category.emojis) {
                // Validate the structure of each emoji entry within the category.
                if (rawEmojiEntry && typeof rawEmojiEntry.emoji === 'string' && typeof rawEmojiEntry.name === 'string') {
                    // Prepare codepoints for keyword inclusion
                    const codepoints = rawEmojiEntry.codepoints || [];
                    const strippedCodepoints = codepoints.map((c) => c.replace(/^u\+/i, ''));

                    standardizedData.push({
                        char: rawEmojiEntry.emoji,
                        name: dgettext(DATA_DOMAIN, rawEmojiEntry.name),
                        category: categoryName,
                        skinToneSupport: rawEmojiEntry.skin_tone_support || false,
                        keywords: [
                            // Add all codepoint variations to keywords
                            ...codepoints,
                            ...strippedCodepoints,
                            ...(Array.isArray(rawEmojiEntry.keywords) ? rawEmojiEntry.keywords.map((k) => dgettext(DATA_DOMAIN, k)) : []),
                        ],
                        codepoints: codepoints,
                    });
                }
            }
        }
        return standardizedData;
    }
}
