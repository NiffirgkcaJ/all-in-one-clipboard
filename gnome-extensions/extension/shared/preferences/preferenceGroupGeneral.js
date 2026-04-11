import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { getRangeFromSchema } from './preferenceUtilities.js';

/**
 * Adds the "General" preferences group to the page.
 *
 * @param {Object} params
 * @param {Adw.PreferencesPage} params.page The preferences page to add the group to.
 * @param {Gio.Settings} params.settings The Gio.Settings instance.
 */
export function addPreferenceGeneral({ page, settings }) {
    const group = new Adw.PreferencesGroup({
        title: _('General'),
        description: _('General settings for the extension.'),
    });
    page.add(group);

    // Extension Dimensions
    const dimensionsExpander = new Adw.ExpanderRow({
        title: _('Extension Dimensions'),
        subtitle: _('Set custom width and height for the extension menu.'),
    });
    group.add(dimensionsExpander);

    // Width
    const widthKey = 'extension-width';
    const widthDefault = settings.get_default_value(widthKey).get_int32();
    const widthRange = getRangeFromSchema(settings, widthKey);

    const widthRow = new Adw.SpinRow({
        title: _('Width'),
        subtitle: _('Range: %d-%d. Default: %d.').format(widthRange.min, widthRange.max, widthDefault),
        adjustment: new Gtk.Adjustment({
            lower: widthRange.min,
            upper: widthRange.max,
            step_increment: 10,
        }),
    });
    dimensionsExpander.add_row(widthRow);
    settings.bind(widthKey, widthRow.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);

    // Height
    const heightKey = 'extension-height';
    const heightDefault = settings.get_default_value(heightKey).get_int32();
    const heightRange = getRangeFromSchema(settings, heightKey);

    const heightRow = new Adw.SpinRow({
        title: _('Height'),
        subtitle: _('Range: %d-%d. Default: %d.').format(heightRange.min, heightRange.max, heightDefault),
        adjustment: new Gtk.Adjustment({
            lower: heightRange.min,
            upper: heightRange.max,
            step_increment: 10,
        }),
    });
    dimensionsExpander.add_row(heightRow);
    settings.bind(heightKey, heightRow.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);

    // Hide Panel Icon
    const hideIconRow = new Adw.SwitchRow({
        title: _('Hide Panel Icon'),
        subtitle: _('The menu can still be opened with shortcuts.'),
    });
    group.add(hideIconRow);

    settings.bind('hide-panel-icon', hideIconRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    // Remember Last Opened Tab
    const rememberTabRow = new Adw.SwitchRow({
        title: _('Remember Last Opened Tab'),
        subtitle: _('Re-open the menu to the last used tab.'),
    });
    group.add(rememberTabRow);

    settings.bind('remember-last-tab', rememberTabRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    hideIconRow.bind_property('active', rememberTabRow, 'sensitive', GObject.BindingFlags.SYNC_CREATE | GObject.BindingFlags.INVERT_BOOLEAN);

    // Menu Position
    const positionOptions = {
        cursor: _('Mouse Cursor'),
        center: _('Screen Center'),
        window: _('Active Window'),
    };
    const optionKeys = Object.keys(positionOptions);
    const optionLabels = Object.values(positionOptions);

    const positionRow = new Adw.ComboRow({
        title: _('Menu Position'),
        model: new Gtk.StringList({ strings: optionLabels }),
    });
    group.add(positionRow);

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

    updatePositionFromSettings();

    page.connect('unmap', () => {
        if (settings && settingsSignalId > 0) {
            settings.disconnect(settingsSignalId);
        }
    });

    hideIconRow.bind_property('active', positionRow, 'sensitive', GObject.BindingFlags.SYNC_CREATE);
}
