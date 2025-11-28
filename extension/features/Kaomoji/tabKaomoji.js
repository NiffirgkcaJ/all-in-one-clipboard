import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { CategorizedItemViewer } from '../../utilities/utilityCategorizedItemViewer.js';
import { KaomojiJsonParser } from './parsers/kaomojiJsonParser.js';
import { AutoPaster, getAutoPaster } from '../../utilities/utilityAutoPaste.js';

/**
 * A content widget for the "Kaomoji" tab.
 *
 * This class acts as a controller that configures and manages a
 * `CategorizedItemViewer` component to display and interact with kaomojis.
 *
 * @fires set-main-tab-bar-visibility - Requests to show or hide the main tab bar.
 * @fires navigate-to-main-tab - Requests a navigation to a different main tab.
 */
export const KaomojiTabContent = GObject.registerClass(
    {
        Signals: {
            'set-main-tab-bar-visibility': { param_types: [GObject.TYPE_BOOLEAN] },
            'navigate-to-main-tab': { param_types: [GObject.TYPE_STRING] },
        },
    },
    class KaomojiTabContent extends St.Bin {
        constructor(extension, settings) {
            super({
                style_class: 'kaomoji-tab-content',
                x_expand: true,
                y_expand: true,
                x_align: Clutter.ActorAlign.FILL,
                y_align: Clutter.ActorAlign.FILL,
            });

            // Store settings for later use
            this._settings = settings;
            this._alwaysShowTabsSignalId = 0;

            const config = {
                jsonPath: 'assets/data/kaomojis.json',
                parserClass: KaomojiJsonParser,
                recentsFilename: 'recent_kaomojis.json',
                recentsMaxItemsKey: 'kaomoji-recents-max-items',
                itemsPerRow: 4,
                categoryPropertyName: 'greaterCategory',
                enableTabScrolling: true,
                sortCategories: false,
                // Ensure the payload is consistent for both old and new item formats.
                createSignalPayload: (itemData) => ({
                    kaomoji: itemData.kaomoji || itemData.char || itemData.value || '',
                    description: itemData.description || '',
                }),
                searchFilterFn: this._searchFilter.bind(this),
                renderGridItemFn: this._renderGridItem.bind(this),
                renderCategoryButtonFn: this._renderCategoryButton.bind(this),
            };

            this._viewer = new CategorizedItemViewer(extension, settings, config);
            this.set_child(this._viewer);

            this._applyBackButtonPreference();
            this._alwaysShowTabsSignalId = settings.connect('changed::always-show-main-tab', () => this._applyBackButtonPreference());

            // Connect to Viewer Signals
            this._viewer.connect('item-selected', (source, jsonPayload) => {
                this._onItemSelected(jsonPayload, extension);
            });

            this._viewer.connect('back-requested', () => {
                this.emit('navigate-to-main-tab', _('Recently Used'));
            });
        }

        /**
         * Applies the user's preference for always showing the main tab back button.
         * @private
         */
        _applyBackButtonPreference() {
            const shouldShowBackButton = !this._settings.get_boolean('always-show-main-tab');
            this._viewer?.setBackButtonVisible(shouldShowBackButton);
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
                // Get the kaomoji string to copy
                const kaomojiToCopy = data.kaomoji;
                if (!kaomojiToCopy) return;

                St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, kaomojiToCopy);

                // Check if auto-paste is enabled
                if (AutoPaster.shouldAutoPaste(this._settings, 'auto-paste-kaomoji')) {
                    await getAutoPaster().trigger();
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
            const lowerSearchText = searchText.toLowerCase();

            // Check for the new 'keywords' array first for efficient searching.
            if (item.keywords && Array.isArray(item.keywords)) {
                return item.keywords.some((k) => k.toLowerCase().includes(lowerSearchText));
            }

            // Fallback search for very old cache items that might not have a keywords array.
            const kaomojiString = item.kaomoji || item.char || item.value || '';
            return (
                kaomojiString.toLowerCase().includes(lowerSearchText) ||
                (item.innerCategory && item.innerCategory.toLowerCase().includes(lowerSearchText)) ||
                (item.greaterCategory && item.greaterCategory.toLowerCase().includes(lowerSearchText))
            );
        }

        /**
         * Renders a grid item button, passed to the viewer.
         * @param {object} itemData - The kaomoji data object.
         * @returns {St.Button} The configured button for the grid.
         * @private
         */
        _renderGridItem(itemData) {
            // Get the string to display by checking new and old properties.
            const displayString = itemData.kaomoji || itemData.char || itemData.value;
            if (!displayString) return new St.Button();

            const button = new St.Button({
                style_class: 'kaomoji-grid-button button',
                label: displayString,
                can_focus: true,
            });

            // Set tooltip text with description if available
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
                x_align: Clutter.ActorAlign.START,
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
            // Disconnect the shared 'always-show-main-tab' signal
            if (this._alwaysShowTabsSignalId) {
                this._settings?.disconnect(this._alwaysShowTabsSignalId);
            }
            this._alwaysShowTabsSignalId = 0;

            // Destroy the child viewer component
            this._viewer?.destroy();
            super.destroy();
        }
    },
);
