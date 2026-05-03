import Clutter from 'gi://Clutter';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

/**
 * SymbolsViewRenderer
 *
 * This class encapsulates all view rendering logic for the Symbols tab, including grid items, category buttons, and search filtering.
 */
export class SymbolsViewRenderer {
    // ========================================================================
    // Rendering
    // ========================================================================

    /**
     * Search filter function for symbols.
     *
     * @param {object} item The symbol data object.
     * @param {string} searchText The user's search text.
     * @returns {boolean} True if the item matches the search.
     */
    searchFilter(item, searchText) {
        const cleanSearchText = searchText.toLowerCase().replace(/^(u\+|0x)/i, '');

        if (item.keywords && Array.isArray(item.keywords)) {
            return item.keywords.some((k) => k.toLowerCase().includes(cleanSearchText));
        }

        return false;
    }

    /**
     * Renders a grid item button for a symbol.
     *
     * @param {object} itemData The symbol data object.
     * @returns {St.Button} The configured button for the grid.
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
     * Renders a category tab button.
     *
     * @param {string} categoryId The name of the category.
     * @returns {St.Button} The configured button for the category tab bar.
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
