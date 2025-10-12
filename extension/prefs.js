import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class AllInOneClipboardPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
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
        this._addDataManagementGroup(page, settings);
    }

    _addGeneralGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: _('General'),
        });
        page.add(group);

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

    _addClipboardHistoryGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Clipboard History'),
        });
        page.add(group);

        // Max clipboard items
        const maxItemsRow = new Adw.SpinRow({
            title: _('Maximum Clipboard History'),
            subtitle: _('Number of items to keep in history (10-200).'),
            adjustment: new Gtk.Adjustment({ lower: 10, upper: 200, step_increment: 5 }),
        });
        group.add(maxItemsRow);
        settings.bind(
            'clipboard-history-max-items',
            maxItemsRow.adjustment, 'value',
            Gio.SettingsBindFlags.DEFAULT
        );

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
    }

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
            const row = new Adw.SpinRow({
                title: item.title,
                subtitle: _('Range: 5-100'),
                adjustment: new Gtk.Adjustment({ lower: 5, upper: 100, step_increment: 1 }),
            });
            group.add(row);
            settings.bind(item.key, row.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
        });
    }

    _addAutoPasteGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Auto-Paste Settings'),
            description: _('Automatically paste selected items instead of just copying to clipboard.')
        });
        page.add(group);

        // Master toggle
        const masterRow = new Adw.SwitchRow({
            title: _('Enable Auto-Paste'),
            subtitle: _('Master toggle for auto-paste functionality.'),
        });
        group.add(masterRow);
        settings.bind('enable-auto-paste', masterRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        // Feature-specific toggles
        const features = [
            { key: 'auto-paste-emoji', title: _('Auto-Paste Emojis') },
            { key: 'auto-paste-gif', title: _('Auto-Paste GIFs') },
            { key: 'auto-paste-kaomoji', title: _('Auto-Paste Kaomojis') },
            { key: 'auto-paste-symbols', title: _('Auto-Paste Symbols') },
            { key: 'auto-paste-clipboard', title: _('Auto-Paste from Clipboard History') }
        ];

        features.forEach(feature => {
            const row = new Adw.SwitchRow({
                title: feature.title,
            });
            group.add(row);
            settings.bind(feature.key, row, 'active', Gio.SettingsBindFlags.DEFAULT);

            // Bind sensitivity to master toggle
            masterRow.bind_property('active', row, 'sensitive', GObject.BindingFlags.SYNC_CREATE);
        });
    }

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
    }

    _addDataManagementGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Data Management'),
            description: _('Permanently delete cached recent items. This action cannot be undone.')
        });
        page.add(group);

        // Helper function to create a clear button with a confirmation dialog
        const createClearButton = (triggerValue, parentWindow) => {
            const button = new Gtk.Button({
                label: _('Clear'),
                valign: Gtk.Align.CENTER,
            });
            button.add_css_class('destructive-action');

            button.connect('clicked', () => {
                const dialog = new Adw.MessageDialog({
                    heading: _('Are you sure?'),
                    body: _('The selected recent items history will be permanently deleted.'),
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
                        // Set the trigger key to signal the main extension
                        settings.set_string('clear-recents-trigger', triggerValue);
                    }
                });

                dialog.present();
            });

            return button;
        };

        const parentWindow = page.get_root();

        // Define the rows for each recent type
        const recentTypes = [
            { key: 'emoji', title: _('Recent Emojis') },
            { key: 'gif', title: _('Recent GIFs') },
            { key: 'kaomoji', title: _('Recent Kaomojis') },
            { key: 'symbols', title: _('Recent Symbols') },
        ];

        recentTypes.forEach(type => {
            const row = new Adw.ActionRow({ title: type.title });
            row.add_suffix(createClearButton(type.key, parentWindow));
            group.add(row);
        });

        // Add the "Clear All" row
        const clearAllRow = new Adw.ActionRow({
            title: _('All Recent Items'),
            subtitle: _('Clears all of the above recent items lists at once.')
        });
        clearAllRow.add_suffix(createClearButton('all', parentWindow));
        group.add(clearAllRow);
    }
}