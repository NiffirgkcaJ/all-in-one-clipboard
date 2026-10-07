import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import { CategorizedItemViewer } from '../../shared/utilities/utilityCategorizedItemViewer.js';
import { IOJson } from '../../shared/utilities/utilityIO.js';
import { Logger } from '../../shared/utilities/utilityLogger.js';
import { ResourceItem, FileItem } from '../../shared/constants/storagePaths.js';

import { EmojiJsonParser } from './parsers/emojiJsonParser.js';
import { EmojiModifier } from './logic/emojiModifier.js';
import { EmojiSelectionService } from './services/emojiSelectionService.js';
import { EmojiViewRenderer } from './view/emojiViewRenderer.js';
import { ensureEmojiSearchProviderRegistered } from './integrations/emojiSearchProvider.js';
import { getSkinnableCharSet } from './logic/emojiDataCache.js';
import { EmojiSettings, EmojiUI } from './constants/emojiConstants.js';

/**
 * EmojiTabContent
 *
 * A content widget for the "Emoji" tab.
 * This class acts as a controller that configures and manages a CategorizedItemViewer component to display and interact with emojis.
 * It handles emoji-specific logic such as skin tone modification.
 *
 * @fires set-main-tab-bar-visibility Requests to show or hide the main tab bar.
 */
export const EmojiTabContent = GObject.registerClass(
    {
        Signals: {
            'set-main-tab-bar-visibility': { param_types: [GObject.TYPE_BOOLEAN] },
        },
    },
    class EmojiTabContent extends St.Bin {
        // ========================================================================
        // Initialization
        // ========================================================================

        /**
         * Initialize the Emoji tab content.
         *
         * @param {object} extension The main extension instance.
         * @param {Gio.Settings} settings The GSettings instance for the extension.
         */
        constructor(extension, settings) {
            super({
                style_class: 'emoji-tab-content',
                x_expand: true,
                y_expand: true,
                x_align: Clutter.ActorAlign.FILL,
                y_align: Clutter.ActorAlign.FILL,
            });

            this._settings = settings;
            this._selectionService = new EmojiSelectionService(settings);
            this._skinToneableBaseChars = new Set();
            this._skinToneSettingsSignalIds = [];
            this._viewer = null;

            ensureEmojiSearchProviderRegistered({ extensionUuid: extension?.uuid });

            this._setupPromise = this._setup(extension, settings);
            this._setupPromise.catch((e) => {
                Logger.error('Failed to setup Emoji tab', e);
            });
        }

        /**
         * Performs asynchronous setup tasks.
         *
         * @param {Extension} extension The main extension instance.
         * @param {Gio.Settings} settings The GSettings instance for the extension.
         * @private
         */
        async _setup(extension, settings) {
            this._skinToneableBaseChars = await getSkinnableCharSet(extension.path);
            this._viewRenderer = new EmojiViewRenderer(this);
            this._loadAndApplyCustomSkinToneSettings();

            const config = {
                jsonPath: ResourceItem.EMOJI,
                parserClass: EmojiJsonParser,
                recentsPath: FileItem.RECENT_EMOJI,
                recentsMaxItemsKey: EmojiSettings.RECENTS_MAX_ITEMS_KEY,
                targetItemWidth: EmojiUI.TARGET_ITEM_WIDTH,
                limitItemsPerRowKey: EmojiSettings.GRID_LIMIT_COLUMNS_KEY,
                maxItemsPerRowKey: EmojiSettings.GRID_MAX_COLUMNS_KEY,
                categoryPropertyName: 'category',
                enableTabScrolling: false,
                sortCategories: false,
                createSignalPayload: (itemData) => ({
                    char: itemData.char || '',
                    value: itemData.value || '',
                    name: itemData.name || '',
                    skinToneSupport: itemData.skinToneSupport || false,
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

            const skinToneKeys = [EmojiSettings.ENABLE_CUSTOM_SKIN_TONES_KEY, EmojiSettings.CUSTOM_SKIN_TONE_PRIMARY_KEY, EmojiSettings.CUSTOM_SKIN_TONE_SECONDARY_KEY];
            skinToneKeys.forEach((key) => {
                const signalId = settings.connect(`changed::${key}`, () => this._onSkinToneSettingsChanged());
                this._skinToneSettingsSignalIds.push(signalId);
            });
        }

        // ========================================================================
        // Signal Handlers and Callbacks
        // ========================================================================

        /**
         * Handles the 'item-selected' signal from the viewer.
         * Determines the correct emoji character, with or without skin tone, and copies it to the clipboard.
         *
         * @param {string} jsonPayload The JSON string payload from the signal.
         * @param {Extension} extension The main extension instance.
         * @private
         */
        async _onItemSelected(jsonPayload, extension) {
            const data = IOJson.parseText(jsonPayload);
            const originalChar = data.char || data.value;
            let charToCopy;

            if (this._viewer._activeCategory === '##RECENTS##') {
                charToCopy = originalChar;
            } else {
                charToCopy = this._getModifiedChar({ ...data, char: originalChar });
            }

            await this._selectionService.handleSelection(charToCopy, extension._indicator?.menu);
        }

        /**
         * Handles changes in skin tone related GSettings.
         * Updates internal state and commands the viewer to re-render the grid.
         *
         * @private
         */
        _onSkinToneSettingsChanged() {
            this._loadAndApplyCustomSkinToneSettings();
            this._viewer?.rerenderGrid();
        }

        // ========================================================================
        // Emoji-Specific Logic
        // ========================================================================

        /**
         * Reads skin tone preferences from GSettings and updates the internal state.
         *
         * @private
         */
        _loadAndApplyCustomSkinToneSettings() {
            this._useCustomTones = this._settings.get_boolean(EmojiSettings.ENABLE_CUSTOM_SKIN_TONES_KEY);
            this._primarySkinTone = this._settings.get_string(EmojiSettings.CUSTOM_SKIN_TONE_PRIMARY_KEY);
            this._secondarySkinTone = this._settings.get_string(EmojiSettings.CUSTOM_SKIN_TONE_SECONDARY_KEY);
        }

        /**
         * Gets the final display character for an emoji, applying skin tones if applicable.
         * This method is used by the view renderer.
         *
         * @param {object} itemData The standardized emoji data object.
         * @returns {string} The final emoji character to display.
         * @private
         */
        _getModifiedChar(itemData) {
            return itemData.skinToneSupport
                ? EmojiModifier.applyCustomTones(itemData.char, this._useCustomTones, this._primarySkinTone, this._secondarySkinTone, this._skinToneableBaseChars)
                : itemData.char;
        }

        // ========================================================================
        // Public Methods
        // ========================================================================

        /**
         * Called by the parent when this tab is selected.
         */
        onTabSelected() {
            if (this._viewer) {
                this.emit('set-main-tab-bar-visibility', false);
                this._viewer.onSelected();
            } else {
                this._setupPromise
                    .then(() => {
                        this.emit('set-main-tab-bar-visibility', false);
                        this._viewer?.onSelected();
                    })
                    .catch((e) => Logger.error(e));
            }
        }

        /**
         * Applies an externally provided search query to this tab.
         *
         * @param {string} query Query text.
         */
        async applyExternalSearch(query) {
            await this._setupPromise;
            this._viewer?.applyExternalSearch(query, { focus: false });
        }

        /**
         * Clears externally provided search state.
         */
        async clearExternalSearch() {
            await this._setupPromise;
            this._viewer?.clearExternalSearch({ focus: false });
        }

        /**
         * Focuses the top-most content element when navigating from the main tab bar.
         *
         * @returns {boolean} True if an element was focused.
         */
        focusTopContent() {
            return this._viewer ? this._viewer.focusTopContent() : false;
        }

        /**
         * Focuses the bottom-most content element when navigating backward from the main tab bar.
         *
         * @returns {boolean} True if an element was focused.
         */
        focusBottomContent() {
            return this._viewer ? this._viewer.focusBottomContent() : false;
        }

        /**
         * Cleans up view state when the menu is closed.
         */
        onMenuClosed() {
            if (this._viewer) {
                this._viewer.onMenuClosed();
            }
        }

        // ========================================================================
        // Lifecycle
        // ========================================================================

        /**
         * Cleans up resources when the widget is destroyed.
         */
        destroy() {
            this._skinToneSettingsSignalIds.forEach((id) => {
                if (this._settings && id > 0) {
                    this._settings.disconnect(id);
                }
            });
            this._skinToneSettingsSignalIds = [];

            if (this._viewer) {
                this._viewer.destroy();
                this._viewer = null;
            }

            this._selectionService = null;
            this._settings = null;

            super.destroy();
        }
    },
);
