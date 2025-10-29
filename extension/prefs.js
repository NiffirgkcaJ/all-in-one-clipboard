import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { getGifCacheManager } from './features/GIF/logic/gifCacheManager.js';

export default class AllInOneClipboardPreferences extends ExtensionPreferences {
    /**
     * Populate the preferences window with the settings UI.
     *
     * @param {Adw.PreferencesWindow} window - The preferences window to populate.
     */
    fillPreferencesWindow(window) {
        // Initialize translations
        this.initTranslations('all-in-one-clipboard');

        // Get the Gio.Settings instance for this extension
        const settings = this.getSettings();

        // Create main preferences page
        const page = new Adw.PreferencesPage({
            title: _('All-in-One Clipboard Settings'),
        });
        window.add(page);

        // Add all preference groups
        this._addGeneralGroup(page, settings);
        this._addKeyboardShortcutsGroup(page, settings);
        this._addClipboardHistoryGroup(page, settings);
        this._addRecentItemsGroup(page, settings);
        this._addAutoPasteGroup(page, settings);
        this._addEmojiSettingsGroup(page, settings);
        this._addGifSettingsGroup(page, settings);
        this._addDataManagementGroup(page, settings, window);
    }

    /**
     * Helper to extract the min and max range from a GSettings schema key.
     *
     * @param {Gio.Settings} settings - The Gio.Settings instance.
     * @param {string} key - The key to extract the range for.
     * @returns {Object|null} An object with 'min' and 'max' properties, or null if not a range.
     */
    _getRangeFromSchema(settings, key) {
        const schemaSource = settings.settings_schema;
        const schemaKey = schemaSource.get_key(key);
        const rangeVariant = schemaKey.get_range();

        // The range variant has format: ('range', <(min, max)>)
        const rangeType = rangeVariant.get_child_value(0).get_string()[0];

        if (rangeType === 'range') {
            const limits = rangeVariant.get_child_value(1).get_child_value(0);
            const min = limits.get_child_value(0).get_int32();
            const max = limits.get_child_value(1).get_int32();
            return { min, max };
        }

        return null;
    }

    /**
     * Add the "General" preferences group to the page.
     *
     * @param {Adw.PreferencesPage} page - The preferences page to add the group to.
     * @param {Gio.Settings} settings - The Gio.Settings instance.
     */
    _addGeneralGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: _('General'),
        });
        page.add(group);

        // Hide panel icon
        const hideIconRow = new Adw.SwitchRow({
            title: _('Hide Panel Icon'),
            subtitle: _('The menu can still be opened with shortcuts.'),
        });
        group.add(hideIconRow);

        settings.bind(
            'hide-panel-icon',
            hideIconRow, 'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        // Remember last opened tab
        const rememberTabRow = new Adw.SwitchRow({
            title: _('Remember Last Opened Tab'),
            subtitle: _('Re-open the menu to the last used tab.'),
        });
        group.add(rememberTabRow);

        settings.bind(
            'remember-last-tab',
            rememberTabRow, 'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        // Make the "Remember Last Opened Tab" switch sensitive only when the "Hide Panel Icon" switch is off.
        hideIconRow.bind_property(
            'active',
            rememberTabRow,
            'sensitive',
            GObject.BindingFlags.SYNC_CREATE | GObject.BindingFlags.INVERT_BOOLEAN
        );

        // Define our options
        const positionOptions = {
            'cursor': _('Mouse Cursor'),
            'center': _('Screen Center'),
            'window': _('Active Window'),
        };
        const optionKeys = Object.keys(positionOptions);
        const optionLabels = Object.values(positionOptions);

        const positionRow = new Adw.ComboRow({
            title: _('Menu Position'),
            model: new Gtk.StringList({ strings: optionLabels }),
        });
        group.add(positionRow);

        // Custom binding for the ComboRow
        const updatePositionFromSettings = () => {
            const currentMode = settings.get_string('hidden-icon-position-mode');
            const newIndex = optionKeys.indexOf(currentMode);
            if (newIndex > -1 && positionRow.selected !== newIndex) {
                positionRow.selected = newIndex;
            }
        };

        positionRow.connect('notify::selected', () => {
            const selectedMode = optionKeys[positionRow.selected];
            if (selectedMode && settings.get_string('hidden-icon-position-mode') !== selectedMode) {
                settings.set_string('hidden-icon-position-mode', selectedMode);
            }
        });

        const settingsSignalId = settings.connect('changed::hidden-icon-position-mode', updatePositionFromSettings);

        // Set the initial value
        updatePositionFromSettings();

        // Ensure this UI element is destroyed properly
        page.connect('unmap', () => {
            if (settings && settingsSignalId > 0) {
                settings.disconnect(settingsSignalId);
            }
        });

        // Make the dropdown sensitive only when the icon is hidden
        hideIconRow.bind_property(
            'active',
            positionRow,
            'sensitive',
            GObject.BindingFlags.SYNC_CREATE
        );
    }

    /**
     * Add the "Keyboard Shortcuts" preferences group to the page.
     * @param {Adw.PreferencesPage} page - The preferences page to add the group to.
     * @param {Gio.Settings} settings - The Gio.Settings instance.
     */
    _addKeyboardShortcutsGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Keyboard Shortcuts'),
            description: _('Click on a shortcut to change it. Press Backspace to clear.')
        });
        page.add(group);

        const shortcuts = [
            { key: 'shortcut-toggle-main', title: _('Toggle Main Menu') },
            { key: 'shortcut-open-clipboard', title: _('Open Clipboard Tab') },
            { key: 'shortcut-open-emoji', title: _('Open Emoji Tab') },
            { key: 'shortcut-open-gif', title: _('Open GIF Tab') },
            { key: 'shortcut-open-kaomoji', title: _('Open Kaomoji Tab') },
            { key: 'shortcut-open-symbols', title: _('Open Symbols Tab') }
        ];

        shortcuts.forEach(shortcut => {
            const row = this._createShortcutRow(settings, shortcut.key, shortcut.title);
            group.add(row);
        });
    }

    /**
     * Create a row for a keyboard shortcut setting.
     *
     * @param {Gio.Settings} settings - The Gio.Settings instance.
     * @param {string} key - The GSettings key for the shortcut.
     * @param {string} title - The title to display for the shortcut.
     * @returns {Adw.ActionRow} The created action row.
     */
    _createShortcutRow(settings, key, title) {
        const row = new Adw.ActionRow({
            title: title,
            activatable: true
        });

        const currentShortcut = settings.get_strv(key)[0] || _('Disabled');
        const shortcutLabel = new Gtk.ShortcutLabel({
            disabled_text: _('Disabled'),
            accelerator: currentShortcut === _('Disabled') ? '' : currentShortcut,
            valign: Gtk.Align.CENTER
        });
        row.add_suffix(shortcutLabel);

        row.connect('activated', () => {
            const dialog = new Gtk.Dialog({
                title: _('Set Shortcut'),
                modal: true,
                transient_for: row.get_root()
            });

            const content = dialog.get_content_area();
            const label = new Gtk.Label({
                label: _('Press a key combination or Escape to cancel'),
                margin_top: 12,
                margin_bottom: 12,
                margin_start: 12,
                margin_end: 12
            });
            content.append(label);

            const controller = new Gtk.EventControllerKey();

            controller.connect('key-pressed', (controller, keyval, keycode, state) => {
                if (keyval === Gdk.KEY_Escape) {
                    dialog.close();
                    return Gdk.EVENT_STOP;
                }

                if (keyval === Gdk.KEY_BackSpace) {
                    settings.set_strv(key, []);
                    shortcutLabel.set_accelerator('');
                    dialog.close();
                    return Gdk.EVENT_STOP;
                }

                const mask = state & Gtk.accelerator_get_default_mod_mask();

                if (Gtk.accelerator_valid(keyval, mask)) {
                    const shortcut = Gtk.accelerator_name(keyval, mask);
                    settings.set_strv(key, [shortcut]);
                    shortcutLabel.set_accelerator(shortcut);
                    dialog.close();
                }
                return Gdk.EVENT_STOP;
            });

            dialog.add_controller(controller);
            dialog.present();
        });
        return row;
    }

    /**
     * Add the "Clipboard History" preferences group to the page.
     *
     * @param {Adw.PreferencesPage} page - The preferences page to add the group to.
     * @param {Gio.Settings} settings - The Gio.Settings instance.
     */
    _addClipboardHistoryGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Clipboard History'),
        });
        page.add(group);

        // Get the default value dynamically from the GSettings schema.
        const key = 'clipboard-history-max-items';
        const historyDefault = settings.get_default_value(key).get_int32();
        const historyRange = this._getRangeFromSchema(settings, key);
        const HISTORY_INCREMENT_NUMBER = 5;

        const maxItemsRow = new Adw.SpinRow({
            title: _('Maximum Clipboard History'),
            subtitle: _('Number of items to keep in history (%d-%d). Default: %d.').format(
                historyRange.min,
                historyRange.max,
                historyDefault
            ),
            adjustment: new Gtk.Adjustment({
                lower: historyRange.min,
                upper: historyRange.max,
                step_increment: HISTORY_INCREMENT_NUMBER
            }),
        });
        group.add(maxItemsRow);
        settings.bind(key, maxItemsRow.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);

        // Move to top on copy
        const updateRecencyRow = new Adw.SwitchRow({
            title: _('Move Item to Top on Copy'),
            subtitle: _('When copying an item from history, make it the most recent.'),
        });
        group.add(updateRecencyRow);
        settings.bind(
            'update-recency-on-copy',
            updateRecencyRow, 'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        // Unpin on paste
        const unpinOnPasteRow = new Adw.SwitchRow({
            title: _('Unpin Item on Paste'),
            subtitle: _('Automatically unpin an item when it is pasted.'),
        });
        group.add(unpinOnPasteRow);
        settings.bind(
            'unpin-on-paste',
            unpinOnPasteRow, 'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        // Clipboard image preview sizing
        const previewGroup = new Adw.PreferencesGroup({
            title: _('Clipboard Image Previews'),
            description: _('Control how large clipboard images appear in history and recents.')
        });
        page.add(previewGroup);

        const previewKey = 'clipboard-image-preview-size';
        const previewDefault = settings.get_default_value(previewKey).get_int32();
        const previewRange = this._getRangeFromSchema(settings, previewKey);

        const previewRow = new Adw.SpinRow({
            title: _('Image Preview Size'),
            subtitle: _('Pixel size for clipboard image thumbnails (%d-%d). Default: %d.').format(
                previewRange.min,
                previewRange.max,
                previewDefault
            ),
            adjustment: new Gtk.Adjustment({
                lower: previewRange.min,
                upper: previewRange.max,
                step_increment: 8
            }),
        });
        previewGroup.add(previewRow);
        settings.bind(previewKey, previewRow.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
    }

    /**
     * Add the "Recent Items" preferences group to the page.
     *
     * @param {Adw.PreferencesPage} page - The preferences page to add the group to.
     * @param {Gio.Settings} settings - The Gio.Settings instance.
     */
    _addRecentItemsGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Recent Items Limits'),
            description: _('Maximum number of items to keep in "Recents" for each feature.')
        });
        page.add(group);

        const items = [
            { key: 'emoji-recents-max-items', title: _('Maximum Recent Emojis') },
            { key: 'kaomoji-recents-max-items', title: _('Maximum Recent Kaomojis') },
            { key: 'symbols-recents-max-items', title: _('Maximum Recent Symbols') },
            { key: 'gif-recents-max-items', title: _('Maximum Recent GIFs') }
        ];

        items.forEach(item => {
            // Get the default value dynamically from the GSettings schema.
            const recentDefault = settings.get_default_value(item.key).get_int32();
            const recentRange = this._getRangeFromSchema(settings, item.key);
            const RECENT_INCREMENT_NUMBER = 1;

            const row = new Adw.SpinRow({
                title: item.title,
                subtitle: _('Range: %d-%d. Default: %d.').format(
                    recentRange.min,
                    recentRange.max,
                    recentDefault
                ),
                adjustment: new Gtk.Adjustment({
                    lower: recentRange.min,
                    upper: recentRange.max,
                    step_increment: RECENT_INCREMENT_NUMBER
                }),
            });
            group.add(row);
            settings.bind(item.key, row.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
        });
    }

    /**
     * Add the "Auto-Paste" preferences group to the page.
     * @param {Adw.PreferencesPage} page - The preferences page to add the group to.
     * @param {Gio.Settings} settings - The Gio.Settings instance.
     */
    _addAutoPasteGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Auto-Paste Settings'),
        });
        page.add(group);

        // Create a single ExpanderRow with a built-in switch.
        const autoPasteExpander = new Adw.ExpanderRow({
            title: _('Enable Auto-Paste'),
            subtitle: _('Automatically paste selected items instead of just copying to clipboard.'),
            show_enable_switch: true,
        });
        group.add(autoPasteExpander);

        // Bind the expander's switch to the master GSettings key.
        settings.bind(
            'enable-auto-paste',
            autoPasteExpander,
            'enable-expansion', // This property controls the built-in switch
            Gio.SettingsBindFlags.DEFAULT
        );

        // Define the individual toggles that will go inside the expander.
        const features = [
            { key: 'auto-paste-emoji', title: _('Auto-Paste Emojis') },
            { key: 'auto-paste-gif', title: _('Auto-Paste GIFs') },
            { key: 'auto-paste-kaomoji', title: _('Auto-Paste Kaomojis') },
            { key: 'auto-paste-symbols', title: _('Auto-Paste Symbols') },
            { key: 'auto-paste-clipboard', title: _('Auto-Paste from Clipboard History') }
        ];

        // Create and add each individual SwitchRow inside the expander.
        features.forEach(feature => {
            const row = new Adw.SwitchRow({
                title: feature.title,
                // Initially sensitive only if the master switch is on.
            });
            autoPasteExpander.add_row(row);
            settings.bind(feature.key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        });
    }

    /**
     * Add the "Emoji Settings" preferences group to the page.
     *
     * @param {Adw.PreferencesPage} page - The preferences page to add the group to.
     * @param {Gio.Settings} settings - The Gio.Settings instance.
     */
    _addEmojiSettingsGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Emoji Settings'),
            description: _('Configure emoji appearance and behavior.'),
        });
        page.add(group);

        const enableCustomTonesRow = new Adw.SwitchRow({
            title: _('Enable Custom Skin Tones'),
            subtitle: _('If off, skinnable emojis are neutral. If on, use the settings below.'),
        });
        group.add(enableCustomTonesRow);
        settings.bind(
            'enable-custom-skin-tones',
            enableCustomTonesRow, 'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        // Skin tone choices
        const skinTones = [
            { id: 'light', value: "🏻", label: _("Light") },
            { id: 'medium-light', value: "🏼", label: _("Medium-Light") },
            { id: 'medium', value: "🏽", label: _("Medium") },
            { id: 'medium-dark', value: "🏾", label: _("Medium-Dark") },
            { id: 'dark', value: "🏿", label: _("Dark") }
        ];

        const toneLabels = skinTones.map(t => t.label);

        const primaryRow = new Adw.ComboRow({
            title: _('Primary Tone / Single Emoji'),
            subtitle: _('For single emojis and the first person in pairs.'),
            model: new Gtk.StringList({ strings: toneLabels }),
        });
        group.add(primaryRow);

        const secondaryRow = new Adw.ComboRow({
            title: _('Secondary Tone'),
            subtitle: _('For the second person in pairs.'),
            model: new Gtk.StringList({ strings: toneLabels }),
        });
        group.add(secondaryRow);

        // Bind combo rows
        this._bindSkinToneComboRow(settings, primaryRow, 'custom-skin-tone-primary', skinTones);
        this._bindSkinToneComboRow(settings, secondaryRow, 'custom-skin-tone-secondary', skinTones);

        // Bind sensitivity
        enableCustomTonesRow.bind_property(
            'active',
            primaryRow,
            'sensitive',
            GObject.BindingFlags.SYNC_CREATE
        );
        enableCustomTonesRow.bind_property(
            'active',
            secondaryRow,
            'sensitive',
            GObject.BindingFlags.SYNC_CREATE
        );
    }

    /**
     * Bind a ComboRow to a GSettings key.
     * @param {Gio.Settings} settings - The Gio.Settings instance.
     * @param {Adw.ComboRow} comboRow - The ComboRow to bind.
     * @param {string} settingKey - The GSettings key to bind.
     * @param {Array} skinTones - An array of skin tone objects.
     */
    _bindSkinToneComboRow(settings, comboRow, settingKey, skinTones) {
        const currentValue = settings.get_string(settingKey);
        const currentIndex = skinTones.findIndex(t => t.value === currentValue);
        comboRow.set_selected(currentIndex > -1 ? currentIndex : 0);

        comboRow.connect('notify::selected', () => {
            const selectedIndex = comboRow.get_selected();
            if (selectedIndex > -1 && selectedIndex < skinTones.length) {
                settings.set_string(settingKey, skinTones[selectedIndex].value);
            }
        });

        settings.connect(`changed::${settingKey}`, () => {
            const newValue = settings.get_string(settingKey);
            const newIndex = skinTones.findIndex(t => t.value === newValue);
            if (newIndex > -1 && comboRow.get_selected() !== newIndex) {
                comboRow.set_selected(newIndex);
            }
        });
    }

    /**
     * Add the "GIF Settings" preferences group to the page.
     *
     * @param {Adw.PreferencesPage} page - The preferences page to add the group to.
     * @param {Gio.Settings} settings - The Gio.Settings instance.
     */
    _addGifSettingsGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: _('GIF Settings'),
            description: _('To search for GIFs, you must select a provider and provide your own API key.')
        });
        page.add(group);

        // Provider selection
        const providerRow = new Adw.ComboRow({
            title: _('GIF Provider'),
            subtitle: _('Select the service to use for fetching GIFs.'),
            model: new Gtk.StringList({
                strings: [_("Disabled"), _("Tenor"), _("Imgur")]
            }),
        });
        group.add(providerRow);

        const providerMap = { 0: 'none', 1: 'tenor', 2: 'imgur' };

        // Bind provider setting
        const currentProvider = settings.get_string('gif-provider');
        let selectedIndex = 0;
        for (const [index, provider] of Object.entries(providerMap)) {
            if (provider === currentProvider) {
                selectedIndex = parseInt(index, 10);
                break;
            }
        }
        providerRow.set_selected(selectedIndex);

        providerRow.connect('notify::selected', () => {
            const newProvider = providerMap[providerRow.get_selected()];
            if (settings.get_string('gif-provider') !== newProvider) {
                settings.set_string('gif-provider', newProvider);
            }
        });

        // API key rows
        const tenorRow = new Adw.PasswordEntryRow({
            title: _('Tenor API Key'),
            visible: settings.get_string('gif-provider') === 'tenor',
        });
        group.add(tenorRow);
        settings.bind('gif-tenor-api-key', tenorRow, 'text', Gio.SettingsBindFlags.DEFAULT);

        const imgurRow = new Adw.PasswordEntryRow({
            title: _('Imgur Client ID'),
            visible: settings.get_string('gif-provider') === 'imgur',
        });
        group.add(imgurRow);
        settings.bind('gif-imgur-client-id', imgurRow, 'text', Gio.SettingsBindFlags.DEFAULT);

        // Update visibility based on provider
        providerRow.connect('notify::selected', () => {
            const selectedProvider = providerMap[providerRow.get_selected()];
            tenorRow.set_visible(selectedProvider === 'tenor');
            imgurRow.set_visible(selectedProvider === 'imgur');
        });

        // Cache size limit expander
        const cacheLimitExpander = new Adw.ExpanderRow({
            title: _('Limit GIF Preview Cache Size'),
            subtitle: _('Turn off for an unlimited cache size.'),
            // This property adds the switch to the row itself.
            show_enable_switch: true,
        });
        group.add(cacheLimitExpander);

        // Get the default value dynamically from the GSettings schema.
        const cacheKey = 'gif-cache-limit-mb';
        const cacheDefault = settings.get_default_value(cacheKey).get_int32();
        const cacheRange = this._getRangeFromSchema(settings, cacheKey);
        const CACHE_MINIMUM_NUMBER = 25;
        const CACHE_INCREMENT_NUMBER = 25;

        const cacheLimitRow = new Adw.SpinRow({
            title: _('Cache Size Limit (MB)'),
            subtitle: _('Range: %d-%d MB. Default: %d MB.').format(
                CACHE_MINIMUM_NUMBER,
                cacheRange.max,
                cacheDefault
            ),
            adjustment: new Gtk.Adjustment({
                lower: CACHE_MINIMUM_NUMBER,
                upper: cacheRange.max,
                step_increment: CACHE_INCREMENT_NUMBER,
            }),
        });
        // Add the SpinRow inside the expander
        cacheLimitExpander.add_row(cacheLimitRow);

        // Flag to prevent recursive updates
        let isUpdatingFromSettings = false;

        const updateUIFromSettings = () => {
            isUpdatingFromSettings = true;
            const limit = settings.get_int('gif-cache-limit-mb');

            // The 'enable_expansion' property controls the built-in switch.
            cacheLimitExpander.set_enable_expansion(limit > 0);

            // The 'adjustment' property controls the SpinRow.
            if (limit > 0) {
                cacheLimitRow.adjustment.set_value(limit);
            }

            isUpdatingFromSettings = false;
        };

        // When the user toggles the built-in switch on the expander
        cacheLimitExpander.connect('notify::enable-expansion', () => {
            if (isUpdatingFromSettings) return;

            let newLimit;
            if (cacheLimitExpander.enable_expansion) {
                // User toggled it on. Use the spinner's current value.
                newLimit = cacheLimitRow.adjustment.get_value();
            } else {
                // User toggled it off. Use 0 for unlimited.
                newLimit = 0;
            }
            settings.set_int('gif-cache-limit-mb', newLimit);

            // Trigger cleanup immediately.
            const uuid = this.dir.get_parent().get_basename();

            // Initialize the manager if it hasn't been already
            const gifCacheManager = getGifCacheManager(uuid, settings);

            // Trigger the cleanup immediately
            gifCacheManager.runCleanupImmediately();
        });

        // When the user changes the spinner's value...
        cacheLimitRow.adjustment.connect('value-changed', () => {
            if (isUpdatingFromSettings) return;
            // Only update the setting if the main switch is active.
            if (cacheLimitExpander.enable_expansion) {
                const newLimit = cacheLimitRow.adjustment.get_value();
                settings.set_int('gif-cache-limit-mb', newLimit);

                // Use the manager for a consistent, immediate cleanup.
                const uuid = this.dir.get_parent().get_basename();
                getGifCacheManager(uuid, settings).runCleanupImmediately();
            }
        });

        // The handler for the settings signal triggers the cleanup.
        const settingsSignalId = settings.connect('changed::gif-cache-limit-mb', () => {
            // When the setting changes, update the UI.
            updateUIFromSettings();

            // Trigger cleanup immediately.
            const uuid = this.dir.get_parent().get_basename();
            getGifCacheManager(uuid, settings).runCleanupImmediately();
        });

        // Ensure this UI element is destroyed properly
        page.connect('unmap', () => {
            if (settings && settingsSignalId > 0) settings.disconnect(settingsSignalId);
        });

        // Set the initial UI state from settings.
        updateUIFromSettings();
    }

    /**
     * Add the "Data Management" preferences group to the page.
     * @param {Adw.PreferencesPage} page - The preferences page to add the group to.
     * @param {Gio.Settings} settings - The Gio.Settings instance.
     * @param {Adw.PreferencesWindow} window - The preferences window (for dialogs).
     */
    _addDataManagementGroup(page, settings, window) {
        const group = new Adw.PreferencesGroup({
            title: _('Data Management'),
            description: _('Manage stored data and configure automatic cleanup. Manual actions cannot be undone.')
        });
        page.add(group);

        // Clear at login expander
        const clearOnStartupExpander = new Adw.ExpanderRow({
            title: _('Clear Data at Login'),
            subtitle: _('Automatically clear selected data at every login'),
            show_enable_switch: true,
        });
        group.add(clearOnStartupExpander);

        // Bind the expander's switch to the master GSettings key
        settings.bind(
            'clear-data-at-login',
            clearOnStartupExpander,
            'enable-expansion', // This property controls the built-in switch
            Gio.SettingsBindFlags.DEFAULT
        );

        // Define the individual toggles that will go inside the expander
        const loginClearToggles = [
            { key: 'clear-clipboard-history-at-login', title: _('Clear Clipboard History') },
            { key: 'clear-recent-emojis-at-login', title: _('Clear Recent Emojis') },
            { key: 'clear-recent-gifs-at-login', title: _('Clear Recent GIFs') },
            { key: 'clear-recent-kaomojis-at-login', title: _('Clear Recent Kaomojis') },
            { key: 'clear-recent-symbols-at-login', title: _('Clear Recent Symbols') },
        ];

        // Create and add each individual SwitchRow to the expander
        loginClearToggles.forEach(toggle => {
            const row = new Adw.SwitchRow({ title: toggle.title });
            clearOnStartupExpander.add_row(row);
            settings.bind(toggle.key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        });

        // Helper to create a clear button with confirmation dialog
        const createClearButton = (triggerValue, parentWindow) => {
            // Create the clear button
            const button = new Gtk.Button({
                label: _('Clear'),
                valign: Gtk.Align.CENTER,
            });
            button.add_css_class('destructive-action');
            button.connect('clicked', () => {
                const dialog = new Adw.MessageDialog({
                    heading: _('Are you sure?'),
                    body: _('The selected data will be permanently deleted.'),
                    transient_for: parentWindow,
                    modal: true,
                });
                dialog.add_response('cancel', _('Cancel'));
                dialog.add_response('clear', _('Clear'));
                dialog.set_response_appearance('clear', Adw.ResponseAppearance.DESTRUCTIVE);
                dialog.set_default_response('cancel');
                dialog.set_close_response('cancel');
                dialog.connect('response', (self, response) => {
                    if (response === 'clear') {
                        settings.set_string('clear-recents-trigger', triggerValue);
                    }
                });
                dialog.present();
            });
            return button;
        };

        // Recent items expander
        const recentsExpander = new Adw.ExpanderRow({
            title: _('Recent Item History'),
            subtitle: _('Clear lists of recently used emojis, GIFs, etc.')
        });
        group.add(recentsExpander);

        const recentTypes = [
            { key: 'emoji', title: _('Recent Emojis'), subtitle: _('Permanently clears the list of recent emojis.') },
            { key: 'gif', title: _('Recent GIFs'), subtitle: _('Permanently clears the list of recent GIFs.') },
            { key: 'kaomoji', title: _('Recent Kaomojis'), subtitle: _('Permanently clears the list of recent kaomojis.') },
            { key: 'symbols', title: _('Recent Symbols'), subtitle: _('Permanently clears the list of recent symbols.') },
        ];
        recentTypes.forEach(type => {
            const row = new Adw.ActionRow({ title: type.title, subtitle: type.subtitle });
            row.add_suffix(createClearButton(type.key, window));
            recentsExpander.add_row(row);
        });
        const clearAllRecentsRow = new Adw.ActionRow({
            title: _('All Recent Items'),
            subtitle: _('Permanently clears all of the above lists at once.')
        });
        clearAllRecentsRow.add_suffix(createClearButton('all', window));
        recentsExpander.add_row(clearAllRecentsRow);

        // Clipboard data expander
        const clipboardExpander = new Adw.ExpanderRow({
            title: _('Clipboard Data'),
            subtitle: _('Permanently delete your saved clipboard history and pinned items.')
        });
        group.add(clipboardExpander);

        const clearClipboardHistoryRow = new Adw.ActionRow({
            title: _('Clipboard History'),
            subtitle: _('Permanently clears all saved unpinned clipboard items.')
        });
        clearClipboardHistoryRow.add_suffix(createClearButton('clipboard-history', window));
        clipboardExpander.add_row(clearClipboardHistoryRow);

        const clearPinnedRow = new Adw.ActionRow({
            title: _('Pinned Items'),
            subtitle: _('Permanently clears all saved pinned clipboard items.')
        });
        clearPinnedRow.add_suffix(createClearButton('clipboard-pinned', window));
        clipboardExpander.add_row(clearPinnedRow);

        // Cache expander
        const cacheExpander = new Adw.ExpanderRow({
            title: _('Performance Caches'),
            subtitle: _('Clear temporary data used to improve loading speed.')
        });
        group.add(cacheExpander);

        const clearGifCacheRow = new Adw.ActionRow({
            title: _('GIF Preview Cache'),
            subtitle: _('Permanently clears all downloaded GIF preview images.')
        });
        clearGifCacheRow.add_suffix(createClearButton('gif-cache', window));
        cacheExpander.add_row(clearGifCacheRow);
    }
}