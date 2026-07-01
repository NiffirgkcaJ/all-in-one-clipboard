/**
 * ClipboardSearchUtils
 *
 * Utility functions for filtering clipboard items based on search text.
 */
export class ClipboardSearchUtils {
    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Check if an item matches the given search text.
     *
     * @param {Object} item The clipboard item to check.
     * @param {string} searchText The search term.
     * @param {ClipboardRegistry} registry The clipboard registry.
     * @returns {boolean} True if the item matches the search text.
     */
    static isMatch(item, searchText, registry) {
        if (!searchText) return true;
        if (!item) return false;

        const searchString = this.getItemSearchString(item, registry);
        return searchString.includes(searchText);
    }

    /**
     * Generate a comprehensive search string from an item's fields.
     *
     * @param {Object} item The clipboard item.
     * @param {ClipboardRegistry} registry The clipboard registry.
     * @returns {string} Lowercased string containing all searchable content.
     */
    static getItemSearchString(item, registry) {
        if (!item) return '';

        const parts = [];

        // Common Fields
        if (item.source_url) parts.push(item.source_url);

        // Type Specific
        if (registry) {
            parts.push(...registry.getSearchTerms(item));
        } else {
            parts.push(item.text, item.preview);
        }

        // Concatenate
        return parts
            .filter((part) => part)
            .join(' ')
            .toLowerCase();
    }
}
