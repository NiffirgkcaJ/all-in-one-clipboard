import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { CategorizedItemViewer } from '../../utilities/utilityCategorizedItemViewer.js';
import { createThemedIcon } from '../../utilities/utilityThemedIcon.js';
import { EmojiJsonParser } from './parsers/emojiJsonParser.js';
import { EmojiModifier } from './logic/emojiModifier.js';

// GSettings keys for skin tone preferences.
const ENABLE_CUSTOM_SKIN_TONES_KEY = 'enable-custom-skin-tones';
const CUSTOM_SKIN_TONE_PRIMARY_KEY = 'custom-skin-tone-primary';
const CUSTOM_SKIN_TONE_SECONDARY_KEY = 'custom-skin-tone-secondary';

// Map of category keywords to their corresponding icon filenames.
const CATEGORY_ICONS_MAP = [
    { keywords: ['smileys', 'emotion'], iconFile: 'emoji-smileys_emotion-symbolic.svg' },
    { keywords: ['people', 'body'], iconFile: 'emoji-people_body-symbolic.svg' },
    { keywords: ['animals', 'nature'], iconFile: 'emoji-animals_nature-symbolic.svg' },
    { keywords: ['food', 'drink'], iconFile: 'emoji-food_drink-symbolic.svg' },
    { keywords: ['travel', 'places'], iconFile: 'emoji-travel_places-symbolic.svg' },
    { keywords: ['activities'], iconFile: 'emoji-activities-symbolic.svg' },
    { keywords: ['objects'], iconFile: 'emoji-objects-symbolic.svg' },
    { keywords: ['symbols'], iconFile: 'emoji-symbols-symbolic.svg' },
    { keywords: ['flags'], iconFile: 'emoji-flags-symbolic.svg' }
];

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
export const EmojiTabContent = GObject.registerClass({
    Signals: {
        'set-main-tab-bar-visibility': { param_types: [GObject.TYPE_BOOLEAN] },
        'navigate-to-main-tab': { param_types: [GObject.TYPE_STRING] }
    },
},
class EmojiTabContent extends St.Bin {
    _init(extension, settings) {
        super._init({
            style_class: 'emoji-tab-content',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL
        });

        this._settings = settings;
        this._skinToneableBaseChars = new Set();
        this._skinToneSettingsSignalIds = [];
        this._viewer = null;

        this._loadAndApplyCustomSkinToneSettings();
        this._buildSkinnableCharSet(extension.path);

        const config = {
            jsonPath: 'data/emojis.json',
            parserClass: EmojiJsonParser,
            recentsFilename: 'recent_emojis.json',
            recentsMaxItemsKey: 'emoji-recents-max-items',
            itemsPerRow: 9,
            categoryPropertyName: 'category',
            sortCategories: false,
            createSignalPayload: itemData => ({
                'char': itemData.char || '',
                'value': itemData.value || '',
                'name': itemData.name || '',
                'skinToneSupport': itemData.skinToneSupport || false
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

        // Connect to GSettings Signals
        const skinToneKeys = [
            ENABLE_CUSTOM_SKIN_TONES_KEY,
            CUSTOM_SKIN_TONE_PRIMARY_KEY,
            CUSTOM_SKIN_TONE_SECONDARY_KEY
        ];
        skinToneKeys.forEach(key => {
            const signalId = settings.connect(`changed::${key}`, () => this._onSkinToneSettingsChanged());
            this._skinToneSettingsSignalIds.push(signalId);
        });
    }

    // =====================================================================
    // Signal Handlers and Callbacks
    // =====================================================================

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

        // If the click is from "Recents", use the character as-is.
        // Otherwise, apply the dynamic skin tone logic.
        if (this._viewer._activeCategory === '##RECENTS##') {
            charToCopy = originalChar;
        } else {
            charToCopy = this._getModifiedChar({ ...data, char: originalChar });
        }

        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, charToCopy);

        // Check if auto-paste is enabled
        const { shouldAutoPaste, triggerPaste } = await import('../../utilities/utilityAutoPaste.js');
        if (shouldAutoPaste(this._settings, 'auto-paste-emoji')) {
            await triggerPaste();
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

    // =====================================================================
    // Emoji-Specific Logic
    // =====================================================================

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
            const file = Gio.File.new_for_path(filePath);

            // Wrap the callback-based function in a native Promise
            const bytes = await new Promise((resolve, reject) => {
                file.load_contents_async(null, (source, res) => {
                    try {
                        const [ok, contents] = source.load_contents_finish(res);
                        if (ok) {
                            resolve(contents);
                        } else {
                            reject(new Error(`Failed to load skinnable character set from ${filePath}`));
                        }
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            const jsonString = new TextDecoder('utf-8').decode(bytes);
            const rawData = JSON.parse(jsonString);

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
        this._useCustomTones = this._settings.get_boolean(ENABLE_CUSTOM_SKIN_TONES_KEY);
        this._primarySkinTone = this._settings.get_string(CUSTOM_SKIN_TONE_PRIMARY_KEY);
        this._secondarySkinTone = this._settings.get_string(CUSTOM_SKIN_TONE_SECONDARY_KEY);
    }

    /**
     * Gets the final display character for an emoji, applying skin tones if applicable.
     * @param {object} itemData - The standardized emoji data object.
     * @returns {string} The final emoji character to display.
     * @private
     */
    _getModifiedChar(itemData) {
        return itemData.skinToneSupport
            ? EmojiModifier.applyCustomTones(itemData.char, this._useCustomTones, this._primarySkinTone, this._secondarySkinTone, this._skinToneableBaseChars)
            : itemData.char;
    }

    // =====================================================================
    // Functions for Viewer Configuration
    // =====================================================================

    /**
     * Search filter function passed to the viewer.
     * @param {object} item - The emoji data object.
     * @param {string} searchText - The user's search text.
     * @returns {boolean} True if the item matches the search.
     * @private
     */
    _searchFilter(item, searchText) {
        return item.name.toLowerCase().includes(searchText) ||
               (item.keywords && item.keywords.some(k => k.toLowerCase().includes(searchText)));
    }

    /**
     * Renders a grid item button, passed to the viewer.
     * @param {object} itemData - The emoji data object.
     * @returns {St.Button} The configured button for the grid.
     * @private
     */
    _renderGridItem(itemData) {
        const originalChar = itemData.char || itemData.value;
        if (!originalChar) return new St.Button();

        let displayChar;

        // If rendering "Recents", display the character as-is (immutable history).
        // Otherwise, apply dynamic skin tone logic.
        if (this._viewer._activeCategory === '##RECENTS##') {
            displayChar = originalChar;
        } else {
            displayChar = EmojiModifier.hasSkinTone(originalChar)
                ? originalChar
                : this._getModifiedChar({ ...itemData, char: originalChar });
        }

        const button = new St.Button({
            style_class: 'emoji-grid-button button',
            label: displayChar,
            can_focus: true,
            x_expand: false
        });
        button.tooltip_text = itemData.name || '';
        return button;
    }

    /**
     * Renders a category tab button, passed to the viewer.
     * @param {string} categoryId - The name of the category.
     * @param {string} extensionPath - Path to the extension's root.
     * @returns {St.Button} The configured button for the category tab bar.
     * @private
     */
    _renderCategoryButton(categoryId, extensionPath) {
        const lower = categoryId.toLowerCase();
        let iconFile = 'emoji-objects-symbolic.svg'; // Fallback icon

        for (const m of CATEGORY_ICONS_MAP) {
            if (m.keywords.some(k => lower.includes(k))) {
                iconFile = m.iconFile;
                break;
            }
        }

        // Use the helper function to create themed icon
        const iconWidget = createThemedIcon(extensionPath, iconFile, 16);

        const button = new St.Button({
            style_class: 'emoji-category-tab-button button',
            child: iconWidget,
            can_focus: true,
            x_expand: false,
            x_align: Clutter.ActorAlign.CENTER
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
        this._skinToneSettingsSignalIds.forEach(id => {
            if (this._settings && id > 0) {
                try { this._settings.disconnect(id); } catch (e) { /* Ignore */ }
            }
        });
        this._viewer?.destroy();
        super.destroy();
    }
});