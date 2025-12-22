import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { CategorizedItemViewer } from '../../shared/utilities/utilityCategorizedItemViewer.js';
import { AutoPaster, getAutoPaster } from '../../shared/utilities/utilityAutoPaste.js';
import { ResourceItem, FileItem } from '../../shared/constants/storagePaths.js';

import { KaomojiJsonParser } from './parsers/kaomojiJsonParser.js';
import { KaomojiViewRenderer } from './view/kaomojiViewRenderer.js';
import { KaomojiSettings, KaomojiUI } from './constants/kaomojiConstants.js';

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

            this._settings = settings;
            this._alwaysShowTabsSignalId = 0;

            this._viewRenderer = new KaomojiViewRenderer();

            const config = {
                jsonPath: ResourceItem.KAOMOJI,
                parserClass: KaomojiJsonParser,
                recentsPath: FileItem.RECENT_KAOMOJI,
                recentsMaxItemsKey: KaomojiSettings.RECENTS_MAX_ITEMS_KEY,
                itemsPerRow: KaomojiUI.ITEMS_PER_ROW,
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

            this._applyBackButtonPreference();
            this._alwaysShowTabsSignalId = settings.connect('changed::always-show-main-tab', () => this._applyBackButtonPreference());

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

        // ========================================================================
        // Signal Handlers and Callbacks
        // ========================================================================

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
                const kaomojiToCopy = data.kaomoji;
                if (!kaomojiToCopy) return;

                St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, kaomojiToCopy);

                if (AutoPaster.shouldAutoPaste(this._settings, 'auto-paste-kaomoji')) {
                    await getAutoPaster().trigger();
                }

                extension._indicator.menu?.close();
            } catch (e) {
                console.error('[AIO-Clipboard] Error in kaomoji item selection:', e);
            }
        }

        // ========================================================================
        // Public Methods & Lifecycle
        // ========================================================================

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
            if (this._alwaysShowTabsSignalId) {
                this._settings?.disconnect(this._alwaysShowTabsSignalId);
            }
            this._alwaysShowTabsSignalId = 0;

            this._viewer?.destroy();
            super.destroy();
        }
    },
);
