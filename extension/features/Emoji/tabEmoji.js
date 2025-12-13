import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { CategorizedItemViewer } from '../../shared/utilities/utilityCategorizedItemViewer.js';
import { IOFile } from '../../shared/utilities/utilityIO.js';
import { ServiceJson } from '../../shared/services/serviceJson.js';
import { AutoPaster, getAutoPaster } from '../../shared/utilities/utilityAutoPaste.js';
import { ResourceItem, FileItem } from '../../shared/constants/storagePaths.js';

import { EmojiJsonParser } from './parsers/emojiJsonParser.js';
import { EmojiModifier } from './logic/emojiModifier.js';
import { EmojiSettings, EmojiUI } from './constants/emojiConstants.js';
import { EmojiViewRenderer } from './view/emojiViewRenderer.js';
import { getSkinnableCharSet } from './logic/emojiDataCache.js';

/**
 * A content widget for the "Emoji" tab.
 *
 * This class acts as a controller that configures and manages a
 * `CategorizedItemViewer` component to display and interact with emojis.
 * It handles emoji-specific logic such as skin tone modification.
 *
 * @fires set-main-tab-bar-visibility - Requests to show or hide the main tab bar.
 * @fires navigate-to-main-tab - Requests a navigation to a different main tab.
 */
export const EmojiTabContent = GObject.registerClass(
    {
        Signals: {
            'set-main-tab-bar-visibility': { param_types: [GObject.TYPE_BOOLEAN] },
            'navigate-to-main-tab': { param_types: [GObject.TYPE_STRING] },
        },
    },
    class EmojiTabContent extends St.Bin {
        constructor(extension, settings) {
            super({
                style_class: 'emoji-tab-content',
                x_expand: true,
                y_expand: true,
                x_align: Clutter.ActorAlign.FILL,
                y_align: Clutter.ActorAlign.FILL,
            });

            this._settings = settings;
            this._skinToneableBaseChars = new Set();
            this._skinToneSettingsSignalIds = [];
            this._alwaysShowTabsSignalId = 0;
            this._viewer = null;

            this._setupPromise = this._setup(extension, settings);
            this._setupPromise.catch((e) => {
                console.error('[AIO-Clipboard] Failed to setup Emoji tab:', e);
            });
        }

        /**
         * Performs asynchronous setup tasks.
         * @param {Extension} extension - The main extension instance.
         * @param {Gio.Settings} settings - The GSettings instance for the extension.
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
                itemsPerRow: EmojiUI.ITEMS_PER_ROW,
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

            this._applyBackButtonPreference();
            this._alwaysShowTabsSignalId = settings.connect('changed::always-show-main-tab', () => this._applyBackButtonPreference());

            this._viewer.connect('item-selected', (source, jsonPayload) => {
                this._onItemSelected(jsonPayload, extension);
            });

            this._viewer.connect('back-requested', () => {
                this.emit('navigate-to-main-tab', _('Recently Used'));
            });

            const skinToneKeys = [EmojiSettings.ENABLE_CUSTOM_SKIN_TONES_KEY, EmojiSettings.CUSTOM_SKIN_TONE_PRIMARY_KEY, EmojiSettings.CUSTOM_SKIN_TONE_SECONDARY_KEY];
            skinToneKeys.forEach((key) => {
                const signalId = settings.connect(`changed::${key}`, () => this._onSkinToneSettingsChanged());
                this._skinToneSettingsSignalIds.push(signalId);
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
         * Determines the correct emoji character (with/without skin tone) and
         * copies it to the clipboard.
         * @param {string} jsonPayload - The JSON string payload from the signal.
         * @param {Extension} extension - The main extension instance.
         * @private
         */
        async _onItemSelected(jsonPayload, extension) {
            const data = JSON.parse(jsonPayload);
            const originalChar = data.char || data.value;
            let charToCopy;

            if (this._viewer._activeCategory === '##RECENTS##') {
                charToCopy = originalChar;
            } else {
                charToCopy = this._getModifiedChar({ ...data, char: originalChar });
            }

            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, charToCopy);

            if (AutoPaster.shouldAutoPaste(this._settings, 'auto-paste-emoji')) {
                await getAutoPaster().trigger();
            }

            extension._indicator.menu?.close();
        }

        /**
         * Handles changes in skin tone related GSettings.
         * Updates internal state and commands the viewer to re-render the grid.
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
         * Asynchronously builds a Set of single-codepoint, skinnable emoji characters
         * by parsing the main emoji data file. This Set is a critical dependency
         * for the `EmojiModifier` logic.
         * @param {string} extensionPath - The path to the extension's root directory.
         * @private
         */
        async _buildSkinnableCharSet(extensionPath) {
            const ZWJ_CHAR = '\u200D';
            const VS16_CHAR = '\uFE0F';

            try {
                const filePath = GLib.build_filenamev([extensionPath, 'data', 'emojis.json']);
                const contents = await IOFile.read(filePath);

                if (contents) {
                    const rawData = ServiceJson.parse(contents);

                    const parser = new EmojiJsonParser();
                    const emojiData = parser.parse(rawData);

                    const skinnableChars = new Set();
                    for (const item of emojiData) {
                        // We only care about single characters that support skin tones.
                        if (item.skinToneSupport && !item.char.includes(ZWJ_CHAR)) {
                            // Strip the variation selector to get the true base character.
                            const baseChar = item.char.endsWith(VS16_CHAR) ? item.char.slice(0, -1) : item.char;
                            skinnableChars.add(baseChar);
                        }
                    }
                    this._skinToneableBaseChars = skinnableChars;
                } else {
                    throw new Error(`Failed to load skinnable character set from ${filePath}`);
                }
            } catch (e) {
                console.error(`[AIO-Clipboard] Failed to build skinnable character set in EmojiTabContent: ${e.message}`);
                this._skinToneableBaseChars = new Set(); // Ensure it's a valid Set on failure
            }
        }

        /**
         * Reads skin tone preferences from GSettings and updates the internal state.
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
         * @param {object} itemData - The standardized emoji data object.
         * @returns {string} The final emoji character to display.
         * @private
         */
        _getModifiedChar(itemData) {
            return itemData.skinToneSupport
                ? EmojiModifier.applyCustomTones(itemData.char, this._useCustomTones, this._primarySkinTone, this._secondarySkinTone, this._skinToneableBaseChars)
                : itemData.char;
        }

        // ========================================================================
        // Public Methods & Lifecycle
        // ========================================================================

        /**
         * Called by the parent when this tab is selected.
         */
        async onTabSelected() {
            await this._setupPromise;

            this.emit('set-main-tab-bar-visibility', false);

            this._viewer?.onSelected();
        }

        /**
         * Cleans up resources when the widget is destroyed.
         */
        destroy() {
            this._skinToneSettingsSignalIds.forEach((id) => {
                if (this._settings && id > 0) {
                    this._settings.disconnect(id);
                }
            });

            if (this._alwaysShowTabsSignalId) {
                this._settings?.disconnect(this._alwaysShowTabsSignalId);
            }
            this._alwaysShowTabsSignalId = 0;

            this._viewer?.destroy();
            super.destroy();
        }
    },
);
