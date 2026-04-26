import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

/**
 * Adds the "Exclusions" preferences group to the page.
 *
 * @param {Object} params
 * @param {Adw.PreferencesPage} params.page The preferences page to add the group to.
 * @param {Gio.Settings} params.settings The Gio.Settings instance.
 */
export function addPreferenceExclusions({ page, settings }) {
    const group = new Adw.PreferencesGroup({
        title: _('Exclusions'),
        description: _('Manage content that should be ignored by the clipboard manager.'),
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

    // Application Exclusions
    const appExclusionExpander = new Adw.ExpanderRow({
        title: _('Applications'),
        subtitle: _('Prevent specific applications from being captured.'),
    });
    group.add(appExclusionExpander);
    _setupExclusionList(appExclusionExpander, settings, 'excluded-applications', _('Application Name or ID'));

    // Content Exclusions
    const contentExclusionExpander = new Adw.ExpanderRow({
        title: _('Addresses'),
        subtitle: _('Prevent specific links or emails from being crawled.'),
    });
    group.add(contentExclusionExpander);
    _setupExclusionList(contentExclusionExpander, settings, 'excluded-addresses', _('Link or Email Address'));
}

/**
 * Helper to setup an exclusion list management UI.
 * @param {Adw.ExpanderRow} expander The expander row to add list to.
 * @param {Gio.Settings} settings The settings instance.
 * @param {string} key The GSettings key.
 * @param {string} placeholder The placeholder text for the add entry.
 * @private
 */
function _setupExclusionList(expander, settings, key, placeholder) {
    const createRow = (value) => {
        const row = new Adw.ActionRow({
            title: value,
        });

        const removeButton = new Gtk.Button({
            icon_name: 'user-trash-symbolic',
            css_classes: ['destructive-action', 'flat'],
            valign: Gtk.Align.CENTER,
        });

        removeButton.connect('clicked', () => {
            const currentList = settings.get_strv(key);
            const newList = currentList.filter((c) => c !== value);
            settings.set_strv(key, newList);
        });

        row.add_suffix(removeButton);
        return row;
    };

    const rows = [];
    const refreshList = () => {
        rows.forEach((row) => expander.remove(row));
        rows.length = 0;

        const list = settings.get_strv(key);
        list.forEach((value) => {
            const row = createRow(value);
            expander.add_row(row);
            rows.push(row);
        });
    };

    settings.connect(`changed::${key}`, refreshList);

    // Add New Exclusion Row
    const addRow = new Adw.ActionRow({
        title: _('Add New Exclusion'),
    });

    const entry = new Gtk.Entry({
        placeholder_text: placeholder,
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
            const currentList = settings.get_strv(key);
            if (!currentList.includes(text)) {
                settings.set_strv(key, [...currentList, text]);
                entry.set_text('');
            }
        }
    };

    addButton.connect('clicked', addAction);
    entry.connect('activate', addAction);

    addRow.add_prefix(entry);
    addRow.add_suffix(addButton);

    expander.add_row(addRow);

    refreshList();
}
