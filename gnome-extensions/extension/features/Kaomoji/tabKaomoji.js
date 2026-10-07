import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import { CategorizedItemViewer } from '../../shared/utilities/utilityCategorizedItemViewer.js';
import { IOJson } from '../../shared/utilities/utilityIO.js';
import { Logger } from '../../shared/utilities/utilityLogger.js';
import { FileItem, ResourceItem } from '../../shared/constants/storagePaths.js';

import { ensureKaomojiSearchProviderRegistered } from './integrations/kaomojiSearchProvider.js';
import { KaomojiJsonParser } from './parsers/kaomojiJsonParser.js';
import { KaomojiSelectionService } from './services/kaomojiSelectionService.js';
import { KaomojiViewRenderer } from './view/kaomojiViewRenderer.js';
import { KaomojiSettings, KaomojiUI } from './constants/kaomojiConstants.js';

/**
 * KaomojiTabContent
 *
 * A content widget for the "Kaomoji" tab.
 * This class acts as a controller that configures and manages a CategorizedItemViewer component to display and interact with kaomojis.
 *
 * @fires set-main-tab-bar-visibility Requests to show or hide the main tab bar.
 */
export const KaomojiTabContent = GObject.registerClass(
    {
        Signals: {
            'set-main-tab-bar-visibility': { param_types: [GObject.TYPE_BOOLEAN] },
        },
    },
    class KaomojiTabContent extends St.Bin {
        // ========================================================================
        // Initialization
        // ========================================================================

        /**
         * Initialize the Kaomoji tab content.
         *
         * @param {object} extension The main extension instance.
         * @param {Gio.Settings} settings The GSettings instance for the extension.
         */
        constructor(extension, settings) {
            super({
                style_class: 'kaomoji-tab-content',
                x_expand: true,
                y_expand: true,
                x_align: Clutter.ActorAlign.FILL,
                y_align: Clutter.ActorAlign.FILL,
            });

            this._settings = settings;
            this._selectionService = new KaomojiSelectionService(settings);

            ensureKaomojiSearchProviderRegistered({ extensionUuid: extension.uuid });

            this._viewRenderer = new KaomojiViewRenderer();

            const config = {
                jsonPath: ResourceItem.KAOMOJI,
                parserClass: KaomojiJsonParser,
                recentsPath: FileItem.RECENT_KAOMOJI,
                recentsMaxItemsKey: KaomojiSettings.RECENTS_MAX_ITEMS_KEY,
                targetItemWidth: KaomojiUI.TARGET_ITEM_WIDTH,
                limitItemsPerRowKey: KaomojiSettings.GRID_LIMIT_COLUMNS_KEY,
                maxItemsPerRowKey: KaomojiSettings.GRID_MAX_COLUMNS_KEY,
                categoryPropertyName: 'greaterCategory',
                enableTabScrolling: true,
                sortCategories: false,
                // Ensure the payload is consistent for both old and new item formats.
                createSignalPayload: (itemData) => ({
                    kaomoji: itemData.kaomoji || itemData.char || itemData.value || '',
                    description: itemData.description || '',
                }),
                searchFilterFn: (item, searchText) => this._viewRenderer.searchFilter(item, searchText),
                renderGridItemFn: (itemData) => this._viewRenderer.renderGridItem(itemData),
                renderCategoryButtonFn: (categoryId) => this._viewRenderer.renderCategoryButton(categoryId),
            };

            this._viewer = new CategorizedItemViewer(extension, settings, config);
            this.set_child(this._viewer);

            this._viewer.connect('item-selected', (source, jsonPayload) => {
                this._onItemSelected(jsonPayload, extension);
            });
        }

        // ========================================================================
        // Signal Handlers and Callbacks
        // ========================================================================

        /**
         * Handles the 'item-selected' signal from the viewer.
         * Copies the selected kaomoji string to the clipboard.
         *
         * @param {string} jsonPayload The JSON string payload from the signal.
         * @param {Extension} extension The main extension instance.
         * @private
         */
        async _onItemSelected(jsonPayload, extension) {
            try {
                const data = IOJson.parseText(jsonPayload);
                const kaomojiToCopy = data.kaomoji;
                if (!kaomojiToCopy) return;

                await this._selectionService.handleSelection(kaomojiToCopy, extension._indicator?.menu);
            } catch (e) {
                Logger.error('Error in kaomoji item selection', e);
            }
        }

        // ========================================================================
        // Public Methods
        // ========================================================================

        /**
         * Called by the parent when this tab is selected.
         */
        onTabSelected() {
            this.emit('set-main-tab-bar-visibility', false);
            this._viewer.onSelected();
        }

        /**
         * Applies an externally provided search query to this tab.
         *
         * @param {string} query Query text.
         */
        async applyExternalSearch(query) {
            this._viewer.applyExternalSearch(query, { focus: false });
        }

        /**
         * Clears externally provided search state.
         */
        async clearExternalSearch() {
            this._viewer.clearExternalSearch({ focus: false });
        }

        /**
         * Focuses the top-most content element when navigating from the main tab bar.
         *
         * @returns {boolean} True if an element was focused.
         */
        focusTopContent() {
            return this._viewer.focusTopContent();
        }

        /**
         * Focuses the bottom-most content element when navigating backward from the main tab bar.
         *
         * @returns {boolean} True if an element was focused.
         */
        focusBottomContent() {
            return this._viewer.focusBottomContent();
        }

        /**
         * Cleans up view state when the menu is closed.
         */
        onMenuClosed() {
            this._viewer.onMenuClosed();
        }

        // ========================================================================
        // Lifecycle
        // ========================================================================

        /**
         * Cleans up resources when the widget is destroyed.
         */
        destroy() {
            if (this._viewer) {
                this._viewer.destroy();
                this._viewer = null;
            }
            this._viewRenderer = null;
            this._selectionService = null;
            this._settings = null;

            super.destroy();
        }
    },
);
