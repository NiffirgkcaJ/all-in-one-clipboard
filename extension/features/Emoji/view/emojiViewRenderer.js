import Clutter from 'gi://Clutter';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { createThemedIcon } from '../../../utilities/utilityThemedIcon.js';
import { EmojiCategoryIcons } from '../constants/emojiConstants.js';
import { EmojiModifier } from '../logic/emojiModifier.js';

/**
 * EmojiViewRenderer - Handles rendering of emoji UI components
 *
 * This class encapsulates all view rendering logic for the Emoji tab,
 * including grid items, category buttons, and search filtering.
 */
export class EmojiViewRenderer {
    /**
     * Initialize the view renderer
     *
     * @param {object} context - The parent tab context with necessary data
     */
    constructor(context) {
        this._context = context;
    }

    /**
     * Search filter function for emojis
     *
     * @param {object} item - The emoji data object
     * @param {string} searchText - The user's search text
     * @returns {boolean} True if the item matches the search
     */
    searchFilter(item, searchText) {
        const cleanSearchText = searchText.toLowerCase().replace(/^(u\+|0x)/i, '');

        if (item.name.toLowerCase().includes(cleanSearchText)) {
            return true;
        }

        if (item.keywords && item.keywords.some((k) => k.toLowerCase().includes(cleanSearchText))) {
            return true;
        }

        return false;
    }

    /**
     * Renders a grid item button for an emoji
     *
     * @param {object} itemData - The emoji data object
     * @returns {St.Button} The configured button for the grid
     */
    renderGridItem(itemData) {
        const originalChar = itemData.char || itemData.value;
        if (!originalChar) return new St.Button();

        let displayChar;

        if (this._context._viewer._activeCategory === '##RECENTS##') {
            displayChar = originalChar;
        } else {
            displayChar = EmojiModifier.hasSkinTone(originalChar) ? originalChar : this._context._getModifiedChar({ ...itemData, char: originalChar });
        }

        const button = new St.Button({
            style_class: 'emoji-grid-button button',
            label: displayChar,
            can_focus: true,
            x_expand: false,
        });
        button.tooltip_text = itemData.name || '';
        return button;
    }

    /**
     * Renders a category tab button
     *
     * @param {string} categoryId - The name of the category
     * @returns {St.Button} The configured button for the category tab bar
     */
    renderCategoryButton(categoryId) {
        const lower = categoryId.toLowerCase();
        let iconFile = 'emoji-objects-symbolic.svg';

        for (const m of EmojiCategoryIcons) {
            if (m.keywords.some((k) => lower.includes(k))) {
                iconFile = m.iconFile;
                break;
            }
        }

        const iconWidget = createThemedIcon(iconFile, 16);

        const button = new St.Button({
            style_class: 'emoji-category-tab-button button',
            child: iconWidget,
            can_focus: true,
            x_expand: false,
            x_align: Clutter.ActorAlign.CENTER,
        });

        button.tooltip_text = _(categoryId);
        return button;
    }
}
