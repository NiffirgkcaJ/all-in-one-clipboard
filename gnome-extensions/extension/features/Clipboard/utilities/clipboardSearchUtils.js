import { ClipboardType } from '../constants/clipboardConstants.js';

/**
 * Utility functions for filtering clipboard items based on search text.
 */
export class ClipboardSearchUtils {
    /**
     * Checks if an item matches the given search text.
     *
     * @param {Object} item - The clipboard item to check.
     * @param {string} searchText - The search term (assumed to be lowercased by caller).
     * @returns {boolean} True if the item matches the search text.
     */
    static isMatch(item, searchText) {
        if (!searchText) return true;
        if (!item) return false;

        const searchString = this.getItemSearchString(item);
        return searchString.includes(searchText);
    }

    /**
     * Generates a comprehensive search string from an item's fields.
     * Concatenates all relevant fields based on the item type to ensure inclusive search.
     *
     * @param {Object} item - The clipboard item.
     * @returns {string} Lowercased string containing all searchable content.
     */
    static getItemSearchString(item) {
        if (!item) return '';

        const parts = [];

        // Add common fields if they exist
        if (item.source_url) parts.push(item.source_url);

        this._appendTypeSpecificFields(item, parts);

        // Filter out null/undefined and join with space
        return parts
            .filter((part) => part)
            .join(' ')
            .toLowerCase();
    }

    /**
     * Helper to append type-specific fields to the parts array.
     * @param {Object} item - The clipboard item.
     * @param {string[]} parts - The array to append fields to.
     * @private
     */
    static _appendTypeSpecificFields(item, parts) {
        switch (item.type) {
            case ClipboardType.IMAGE:
                parts.push(item.image_filename);
                break;
            case ClipboardType.FILE:
                parts.push(item.preview);
                parts.push(item.file_uri);
                break;
            case ClipboardType.URL:
                parts.push(item.title);
                parts.push(item.url);
                break;
            case ClipboardType.COLOR:
                parts.push(item.color_value);
                break;
            case ClipboardType.CODE:
            case ClipboardType.TEXT:
                parts.push(item.text);
                parts.push(item.preview);
                break;
            case ClipboardType.CONTACT:
                parts.push(item.text);
                parts.push(item.preview);
                if (item.metadata) {
                    parts.push(item.metadata.name);
                    parts.push(item.metadata.email);
                }
                break;
            default:
                parts.push(item.text);
                parts.push(item.preview);
                break;
        }
    }
}
