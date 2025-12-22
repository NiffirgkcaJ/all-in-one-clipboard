import Clutter from 'gi://Clutter';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

/**
 * SymbolsViewRenderer - Handles rendering of symbols UI components
 *
 * This class encapsulates all view rendering logic for the Symbols tab,
 * including grid items, category buttons, and search filtering.
 */
export class SymbolsViewRenderer {
    /**
     * Search filter function for symbols
     *
     * @param {object} item - The symbol data object
     * @param {string} searchText - The user's search text
     * @returns {boolean} True if the item matches the search
     */
    searchFilter(item, searchText) {
        // Prepare the user's input once, stripping any prefixes
        const cleanSearchText = searchText.toLowerCase().replace(/^(u\+|0x)/i, '');

        // Check keywords first if available
        if (item.keywords && Array.isArray(item.keywords)) {
            // Compare the clean search text against all keywords
            return item.keywords.some((k) => k.toLowerCase().includes(cleanSearchText));
        }

        // Check symbol string and name
        const symbolString = item.char || item.value || '';
        return symbolString.toLowerCase().includes(cleanSearchText) || (item.name && item.name.toLowerCase().includes(cleanSearchText));
    }

    /**
     * Renders a grid item button for a symbol
     *
     * @param {object} itemData - The symbol data object
     * @returns {St.Button} The configured button for the grid
     */
    renderGridItem(itemData) {
        const displayString = itemData.symbol || itemData.char || itemData.value;
        if (!displayString) return new St.Button();

        const button = new St.Button({
            style_class: 'symbol-grid-button button',
            label: displayString,
            can_focus: true,
            x_expand: false,
        });

        button.tooltip_text = itemData.name || displayString;
        return button;
    }

    /**
     * Renders a category tab button
     *
     * @param {string} categoryId - The name of the category
     * @returns {St.Button} The configured button for the category tab bar
     */
    renderCategoryButton(categoryId) {
        const button = new St.Button({
            style_class: 'symbol-category-tab-button button',
            can_focus: true,
            label: _(categoryId),
            x_expand: false,
            x_align: Clutter.ActorAlign.START,
        });
        button.tooltip_text = _(categoryId);
        return button;
    }
}
