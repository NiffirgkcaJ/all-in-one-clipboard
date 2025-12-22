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
        const rawGreaterCategoryData = jsonData.data;
        const standardizedData = [];

        if (!Array.isArray(rawGreaterCategoryData)) {
            console.error(`[AIO-Clipboard] Input data is not an array of greater categories.`);
            return [];
        }

        for (const greaterCategoryEntry of rawGreaterCategoryData) {
            if (!greaterCategoryEntry || typeof greaterCategoryEntry.name !== 'string' || !Array.isArray(greaterCategoryEntry.categories)) {
                continue;
            }

            const greaterCategoryName = dgettext(DATA_DOMAIN, greaterCategoryEntry.name.trim());

            for (const innerCategoryEntry of greaterCategoryEntry.categories) {
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
                    const description = emoticonObject.description ? dgettext(DATA_DOMAIN, emoticonObject.description) : '';

                    const providedKeywords = Array.isArray(emoticonObject.keywords) ? emoticonObject.keywords.map((k) => dgettext(DATA_DOMAIN, k)) : [];

                    const emoticonSlug = emoticonObject.slug || '';

                    const allKeywords = [kaomoji, description, ...providedKeywords, innerCategoryName, greaterCategoryName, innerCategorySlug, emoticonSlug].filter(Boolean);

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
