import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

/**
 * Binds a ComboRow to a GSettings key for skin tone selection.
 *
 * @param {Gio.Settings} settings The Gio.Settings instance.
 * @param {Adw.ComboRow} comboRow The ComboRow to bind.
 * @param {string} settingKey The GSettings key to bind.
 * @param {Array} skinTones An array of skin tone objects.
 */
function bindSkinToneComboRow(settings, comboRow, settingKey, skinTones) {
    const currentValue = settings.get_string(settingKey);
    const currentIndex = skinTones.findIndex((t) => t.value === currentValue);
    comboRow.set_selected(currentIndex > -1 ? currentIndex : 0);

    comboRow.connect('notify::selected', () => {
        const selectedIndex = comboRow.get_selected();
        if (selectedIndex > -1 && selectedIndex < skinTones.length) {
            settings.set_string(settingKey, skinTones[selectedIndex].value);
        }
    });

    settings.connect(`changed::${settingKey}`, () => {
        const newValue = settings.get_string(settingKey);
        const newIndex = skinTones.findIndex((t) => t.value === newValue);
        if (newIndex > -1 && comboRow.get_selected() !== newIndex) {
            comboRow.set_selected(newIndex);
        }
    });
}

/**
 * Adds the "Emoji Settings" preferences group to the page.
 *
 * @param {Object} params
 * @param {Adw.PreferencesPage} params.page The preferences page to add the group to.
 * @param {Gio.Settings} params.settings The Gio.Settings instance.
 */
export function addPreferenceEmojiSettings({ page, settings }) {
    const group = new Adw.PreferencesGroup({
        title: _('Emoji Settings'),
        description: _('Configure emoji appearance and behavior.'),
    });
    page.add(group);

    // Enable Custom Skin Tones
    const enableCustomTonesRow = new Adw.SwitchRow({
        title: _('Enable Custom Skin Tones'),
        subtitle: _('If off, skinnable emojis are neutral. If on, use the settings below.'),
    });
    group.add(enableCustomTonesRow);
    settings.bind('enable-custom-skin-tones', enableCustomTonesRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    // Skin Tone Choices
    const skinTones = [
        { id: 'light', value: '🏻', label: _('Light') },
        { id: 'medium-light', value: '🏼', label: _('Medium-Light') },
        { id: 'medium', value: '🏽', label: _('Medium') },
        { id: 'medium-dark', value: '🏾', label: _('Medium-Dark') },
        { id: 'dark', value: '🏿', label: _('Dark') },
    ];

    const toneLabels = skinTones.map((t) => t.label);

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

    bindSkinToneComboRow(settings, primaryRow, 'custom-skin-tone-primary', skinTones);
    bindSkinToneComboRow(settings, secondaryRow, 'custom-skin-tone-secondary', skinTones);

    enableCustomTonesRow.bind_property('active', primaryRow, 'sensitive', GObject.BindingFlags.SYNC_CREATE);
    enableCustomTonesRow.bind_property('active', secondaryRow, 'sensitive', GObject.BindingFlags.SYNC_CREATE);
}
