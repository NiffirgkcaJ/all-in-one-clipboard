import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

/**
 * Adds the "Excluded Applications" preferences group to the page.
 *
 * @param {Object} params
 * @param {Adw.PreferencesPage} params.page The preferences page to add the group to.
 * @param {Gio.Settings} params.settings The Gio.Settings instance.
 */
export function addPreferenceExclusions({ page, settings }) {
    const group = new Adw.PreferencesGroup({
        title: _('Excluded Applications'),
        description: _('Manage applications that should be ignored by the clipboard manager.'),
    });
    page.add(group);

    // Enhanced Exclusion Detection
    const atspiRow = new Adw.SwitchRow({
        title: _('Enhanced Exclusion Detection'),
        subtitle: _('Detects excluded applications inside browser windows and enables the system accessibility service if needed.'),
    });
    group.add(atspiRow);
    settings.bind('enable-atspi-exclusion', atspiRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    atspiRow.connect('notify::active', () => {
        const a11ySettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        a11ySettings.set_boolean('toolkit-accessibility', atspiRow.active);
    });

    // Ignored Applications
    const exclusionExpander = new Adw.ExpanderRow({
        title: _('Ignored Applications'),
        subtitle: _('Prevent specific applications from saving content to the clipboard history.'),
    });
    group.add(exclusionExpander);

    const createExcludedAppRow = (appClassName) => {
        const row = new Adw.ActionRow({
            title: appClassName,
        });

        const removeButton = new Gtk.Button({
            icon_name: 'user-trash-symbolic',
            css_classes: ['destructive-action', 'flat'],
            valign: Gtk.Align.CENTER,
        });

        removeButton.connect('clicked', () => {
            const currentList = settings.get_strv('exclusion-list');
            const newList = currentList.filter((c) => c !== appClassName);
            settings.set_strv('exclusion-list', newList);
        });

        row.add_suffix(removeButton);
        return row;
    };

    const exclusionRows = [];
    const refreshList = () => {
        exclusionRows.forEach((row) => exclusionExpander.remove(row));
        exclusionRows.length = 0;

        const list = settings.get_strv('exclusion-list');
        list.forEach((appClass) => {
            const row = createExcludedAppRow(appClass);
            exclusionExpander.add_row(row);
            exclusionRows.push(row);
        });
    };

    settings.connect('changed::exclusion-list', refreshList);

    // Add New Exclusion
    const addRow = new Adw.ActionRow({
        title: _('Add New Exclusion'),
    });

    const entry = new Gtk.Entry({
        placeholder_text: _('Application Name or ID'),
        valign: Gtk.Align.CENTER,
        hexpand: true,
    });

    const addButton = new Gtk.Button({
        icon_name: 'list-add-symbolic',
        css_classes: ['suggested-action', 'flat'],
        valign: Gtk.Align.CENTER,
    });

    const addAction = () => {
        const text = entry.get_text().trim();
        if (text) {
            const currentList = settings.get_strv('exclusion-list');
            if (!currentList.includes(text)) {
                settings.set_strv('exclusion-list', [...currentList, text]);
                entry.set_text('');
            }
        }
    };

    addButton.connect('clicked', addAction);
    entry.connect('activate', addAction);

    addRow.add_prefix(entry);
    addRow.add_suffix(addButton);

    group.add(addRow);

    refreshList();
}
