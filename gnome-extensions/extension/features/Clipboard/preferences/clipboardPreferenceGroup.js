import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { getRangeFromSchema } from '../../../shared/preferences/preferenceUtilities.js';

/**
 * Adds the "Clipboard Settings" preferences group to the page.
 *
 * @param {Object} params
 * @param {Adw.PreferencesPage} params.page The preferences page to add the group to.
 * @param {Gio.Settings} params.settings The Gio.Settings instance.
 */
export function addPreferenceClipboardSettings({ page, settings }) {
    const group = new Adw.PreferencesGroup({
        title: _('Clipboard Settings'),
        description: _('Settings for the clipboard feature.'),
    });
    page.add(group);

    // Maximum Clipboard History
    const key = 'clipboard-history-max-items';
    const historyDefault = settings.get_default_value(key).get_int32();
    const historyRange = getRangeFromSchema(settings, key);
    const HISTORY_INCREMENT_NUMBER = 5;

    const maxItemsRow = new Adw.SpinRow({
        title: _('Maximum Clipboard History'),
        subtitle: _('Number of items to keep in history (%d-%d). Default: %d.').format(historyRange.min, historyRange.max, historyDefault),
        adjustment: new Gtk.Adjustment({
            lower: historyRange.min,
            upper: historyRange.max,
            step_increment: HISTORY_INCREMENT_NUMBER,
        }),
    });
    group.add(maxItemsRow);
    settings.bind(key, maxItemsRow.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);

    // Move to Top on Copy
    const updateRecencyRow = new Adw.SwitchRow({
        title: _('Move Item to Top on Copy'),
        subtitle: _('When copying an item from history, make it the most recent.'),
    });
    group.add(updateRecencyRow);
    settings.bind('update-recency-on-copy', updateRecencyRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    // Unpin on Paste
    const unpinOnPasteRow = new Adw.SwitchRow({
        title: _('Unpin Item on Paste'),
        subtitle: _('Automatically unpin an item when it is pasted.'),
    });
    group.add(unpinOnPasteRow);
    settings.bind('unpin-on-paste', unpinOnPasteRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    // Show Action Bar
    const showActionBarRow = new Adw.SwitchRow({
        title: _('Show Clipboard Action Bar'),
        subtitle: _('Show the toolbar above the clipboard list.'),
    });
    group.add(showActionBarRow);
    settings.bind('clipboard-show-action-bar', showActionBarRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    // Clipboard Layout Mode
    const layoutModes = [
        { id: 'list', label: _('List') },
        { id: 'grid', label: _('Grid') },
    ];

    const layoutRow = new Adw.ComboRow({
        title: _('Clipboard Layout'),
        subtitle: _('Display clipboard history as a list or a grid.'),
        model: new Gtk.StringList({ strings: layoutModes.map((m) => m.label) }),
    });
    group.add(layoutRow);

    const currentLayout = settings.get_string('clipboard-layout-mode') || 'list';
    const initialLayoutIndex = layoutModes.findIndex((m) => m.id === currentLayout);
    layoutRow.set_selected(initialLayoutIndex > -1 ? initialLayoutIndex : 0);

    layoutRow.connect('notify::selected', () => {
        const index = layoutRow.get_selected();
        if (index >= 0 && index < layoutModes.length) {
            const newMode = layoutModes[index].id;
            if (settings.get_string('clipboard-layout-mode') !== newMode) {
                settings.set_string('clipboard-layout-mode', newMode);
            }
        }
    });

    settings.connect('changed::clipboard-layout-mode', () => {
        const newMode = settings.get_string('clipboard-layout-mode');
        const newIndex = layoutModes.findIndex((m) => m.id === newMode);
        if (newIndex > -1 && layoutRow.get_selected() !== newIndex) {
            layoutRow.set_selected(newIndex);
        }
    });

    // Image Preview Size
    const previewKey = 'clipboard-image-preview-size';
    const previewDefault = settings.get_default_value(previewKey).get_int32();
    const previewRange = getRangeFromSchema(settings, previewKey);

    const previewRow = new Adw.SpinRow({
        title: _('Image Preview Size'),
        subtitle: _('Pixel size for clipboard image thumbnails (%d-%d). Default: %d.').format(previewRange.min, previewRange.max, previewDefault),
        adjustment: new Gtk.Adjustment({
            lower: previewRange.min,
            upper: previewRange.max,
            step_increment: 8,
        }),
    });
    group.add(previewRow);
    settings.bind(previewKey, previewRow.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
}
