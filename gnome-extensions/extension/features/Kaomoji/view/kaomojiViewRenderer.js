import Clutter from 'gi://Clutter';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

// ========================================================================
// Internal Helpers
// ========================================================================

/**
 * Strip whitespace, variation selectors, and invisible Unicode joiners for resilient character matching.
 *
 * @param {string} text Text to normalize.
 * @returns {string} Clean normalized string.
 */
function normalizeCharacterSearch(text) {
    return text.toLowerCase().replace(/[\s\u200B-\u200D\u2060\uFEFF]|[\uFE00-\uFE0F]/gu, '');
}

/**
 * KaomojiViewRenderer
 *
 * This class encapsulates all view rendering logic for the Kaomoji tab, including grid items, category buttons, and search filtering.
 */
export class KaomojiViewRenderer {
    // ========================================================================
    // Rendering
    // ========================================================================

    /**
     * Search filter function for kaomojis.
     *
     * @param {object} item The kaomoji data object.
     * @param {string} searchText The user's search text.
     * @returns {boolean} True if the item matches the search.
     */
    searchFilter(item, searchText) {
        const lowerSearchText = searchText.toLowerCase();

        if (item.keywords?.some((keyword) => keyword.toLowerCase().includes(lowerSearchText))) return true;

        const query = normalizeCharacterSearch(searchText);
        const character = item.kaomoji || item.char || item.value;
        if (query && typeof character === 'string') {
            return normalizeCharacterSearch(character).includes(query);
        }

        return false;
    }

    /**
     * Renders a grid item button for a kaomoji.
     *
     * @param {object} itemData The kaomoji data object.
     * @returns {St.Button} The configured button for the grid.
     */
    renderGridItem(itemData) {
        const displayString = itemData.kaomoji || itemData.char || itemData.value;
        if (!displayString) return new St.Button();

        const button = new St.Button({
            style_class: 'kaomoji-grid-button button',
            label: displayString,
            can_focus: true,
        });

        if (itemData.description) {
            button.tooltip_text = `${itemData.innerCategory}: ${displayString}\n${itemData.description}`;
        } else if (itemData.innerCategory) {
            button.tooltip_text = `${itemData.innerCategory}: ${displayString}`;
        } else {
            button.tooltip_text = displayString;
        }

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
            style_class: 'kaomoji-category-tab-button button',
            can_focus: true,
            label: _(categoryId),
            x_expand: false,
            x_align: Clutter.ActorAlign.START,
        });
        button.tooltip_text = _(categoryId);
        return button;
    }
}
