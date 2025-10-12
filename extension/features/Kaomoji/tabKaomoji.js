import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { CategorizedItemViewer } from '../../utilities/utilityCategorizedItemViewer.js';
import { KaomojiJsonParser } from './parsers/kaomojiJsonParser.js';

/**
 * A content widget for the "Kaomoji" tab.
 *
 * This class acts as a controller that configures and manages a
 * `CategorizedItemViewer` component to display and interact with kaomojis.
 *
 * @fires set-main-tab-bar-visibility - Requests to show or hide the main tab bar.
 * @fires navigate-to-main-tab - Requests a navigation to a different main tab.
 */
export const KaomojiTabContent = GObject.registerClass({
    Signals: {
        'set-main-tab-bar-visibility': { param_types: [GObject.TYPE_BOOLEAN] },
        'navigate-to-main-tab': { param_types: [GObject.TYPE_STRING] }
    },
},
class KaomojiTabContent extends St.Bin {
    _init(extension, settings) {
        super._init({
            style_class: 'kaomoji-tab-content',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL
        });

        // Store settings for later use
        this._settings = settings;

        const config = {
            jsonPath: 'data/kaomojis.json',
            parserClass: KaomojiJsonParser,
            recentsFilename: 'recent_kaomojis.json',
            recentsMaxItemsKey: 'kaomoji-recents-max-items',
            itemsPerRow: 4,
            categoryPropertyName: 'greaterCategory',
            sortCategories: false,
            createSignalPayload: itemData => ({
                'char': itemData.char || '',
                'value': itemData.value || '',
                'name': itemData.name || ''
            }),
            searchFilterFn: this._searchFilter.bind(this),
            renderGridItemFn: this._renderGridItem.bind(this),
            renderCategoryButtonFn: this._renderCategoryButton.bind(this),
        };

        this._viewer = new CategorizedItemViewer(extension, settings, config);
        this.set_child(this._viewer);

        // Connect to Viewer Signals
        this._viewer.connect('item-selected', (source, jsonPayload) => {
            this._onItemSelected(jsonPayload, extension);
        });

        this._viewer.connect('back-requested', () => {
            this.emit('navigate-to-main-tab', _("Recently Used"));
        });
    }

    // =====================================================================
    // Signal Handlers and Callbacks
    // =====================================================================

    /**
     * Handles the 'item-selected' signal from the viewer.
     * Copies the selected kaomoji string to the clipboard.
     * @param {string} jsonPayload - The JSON string payload from the signal.
     * @param {Extension} extension - The main extension instance.
     * @private
     */
    async _onItemSelected(jsonPayload, extension) {
        try {
            const data = JSON.parse(jsonPayload);
            const charToCopy = data.char || data.value;

            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, charToCopy);

            // Check if auto-paste is enabled
            const { shouldAutoPaste, triggerPaste } = await import('../../utilities/utilityAutoPaste.js');
            if (shouldAutoPaste(this._settings, 'auto-paste-kaomoji')) {
                await triggerPaste();
            }

            extension._indicator.menu?.close();
        } catch (e) {
            console.error('[AIO-Clipboard] Error in kaomoji item selection:', e);
        }
    }

    // =====================================================================
    // Functions for Viewer Configuration
    // =====================================================================

    /**
     * Search filter function passed to the viewer.
     * @param {object} item - The kaomoji data object.
     * @param {string} searchText - The user's search text.
     * @returns {boolean} True if the item matches the search.
     * @private
     */
    _searchFilter(item, searchText) {
        return item.char.toLowerCase().includes(searchText) ||
               (item.innerCategory && item.innerCategory.toLowerCase().includes(searchText)) ||
               (item.greaterCategory && item.greaterCategory.toLowerCase().includes(searchText)) ||
               (item.keywords && item.keywords.some(k => k.toLowerCase().includes(searchText)));
    }

    /**
     * Renders a grid item button, passed to the viewer.
     * @param {object} itemData - The kaomoji data object.
     * @returns {St.Button} The configured button for the grid.
     * @private
     */
    _renderGridItem(itemData) {
        const displayString = itemData.char || itemData.value;
        if (!displayString) return new St.Button();

        const button = new St.Button({
            style_class: 'kaomoji-grid-button button',
            label: displayString,
            can_focus: true
        });
        button.tooltip_text = itemData.innerCategory
            ? `${itemData.innerCategory}: ${displayString}`
            : displayString;
        return button;
    }

    /**
     * Renders a category tab button, passed to the viewer.
     * @param {string} categoryId - The name of the category.
     * @returns {St.Button} The configured button for the category tab bar.
     * @private
     */
    _renderCategoryButton(categoryId) {
        const button = new St.Button({
            style_class: 'kaomoji-category-tab-button button',
            can_focus: true,
            label: _(categoryId),
            x_expand: false,
            x_align: Clutter.ActorAlign.START
        });
        button.tooltip_text = _(categoryId);
        return button;
    }

    // =====================================================================
    // Public Methods & Lifecycle
    // =====================================================================

    /**
     * Called by the parent when this tab is selected.
     */
    onTabSelected() {
        this.emit('set-main-tab-bar-visibility', false);
        this._viewer?.onSelected();
    }

    /**
     * Cleans up resources when the widget is destroyed.
     */
    destroy() {
        this._viewer?.destroy();
        super.destroy();
    }
});