import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

/**
 * Adds the "Settings Management" preferences group to the page.
 *
 * @param {Object} params
 * @param {Adw.PreferencesPage} params.page The preferences page to add the group to.
 * @param {Gio.Settings} params.settings The Gio.Settings instance.
 * @param {Adw.PreferencesWindow} params.window The preferences window for dialogs.
 */
export function addPreferenceSettingsManagement({ page, settings, window }) {
    const group = new Adw.PreferencesGroup({
        title: _('Settings Management'),
        description: _('Manage your extension preferences.'),
    });
    page.add(group);

    // Export Settings
    const exportRow = new Adw.ActionRow({
        title: _('Export Settings'),
        subtitle: _('Export your preferences to a JSON file.'),
    });
    const exportButton = new Gtk.Button({
        label: _('Export'),
        valign: Gtk.Align.CENTER,
    });
    exportButton.connect('clicked', () => handleExportSettings(settings, window));
    exportRow.add_suffix(exportButton);
    group.add(exportRow);

    // Import Settings
    const importRow = new Adw.ActionRow({
        title: _('Import Settings'),
        subtitle: _('Import your preferences from a JSON file.'),
    });
    const importButton = new Gtk.Button({
        label: _('Import'),
        valign: Gtk.Align.CENTER,
    });
    importButton.connect('clicked', () => handleImportSettings(settings, window));
    importRow.add_suffix(importButton);
    group.add(importRow);

    // Reset Settings
    const resetRow = new Adw.ActionRow({
        title: _('Reset Settings'),
        subtitle: _('Restore all extension settings back to their default values.'),
    });
    const resetButton = new Gtk.Button({
        label: _('Reset'),
        valign: Gtk.Align.CENTER,
    });
    resetButton.add_css_class('destructive-action');
    resetButton.connect('clicked', () => handleResetSettings(settings, window));
    resetRow.add_suffix(resetButton);
    group.add(resetRow);
}

/**
 * Handles exporting all GSettings values to a user-selected JSON file.
 *
 * @param {Gio.Settings} settings
 * @param {Adw.PreferencesWindow} window
 */
function handleExportSettings(settings, window) {
    const dialog = new Gtk.FileDialog({
        title: _('Export Settings'),
        initial_name: 'aio-clipboard-settings.json',
    });

    try {
        const filters = new Gio.ListStore({ item_type: Gtk.FileFilter });
        const jsonFilter = new Gtk.FileFilter();
        jsonFilter.set_name(_('JSON Files'));
        jsonFilter.add_mime_type('application/json');
        jsonFilter.add_pattern('*.json');
        filters.append(jsonFilter);
        dialog.set_filters(filters);
    } catch (e) {
        console.warn(`[AIO-Clipboard] Could not setup file filter: ${e.message}`);
    }

    dialog.save(window, null, (source, result) => {
        try {
            const file = dialog.save_finish(result);
            if (!file) {
                return;
            }

            const dataToExport = {};
            const keys = settings.list_keys().sort();
            for (const key of keys) {
                if (key === 'clear-recents-trigger') {
                    continue;
                }
                const gvar = settings.get_value(key);
                dataToExport[key] = gvar.deep_unpack();
            }

            const jsonStr = JSON.stringify(dataToExport, null, 4);
            const bytes = new GLib.Bytes(jsonStr);

            file.replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.NONE, null, (fileSource, saveResult) => {
                try {
                    fileSource.replace_contents_finish(saveResult);
                    showToast(window, _('Settings successfully exported.'));
                } catch (err) {
                    console.error(`[AIO-Clipboard] Failed to write settings file: ${err.message}`);
                    showToast(window, _('Failed to export settings.'));
                }
            });
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                console.error(`[AIO-Clipboard] Error during export dialog: ${e.message}`);
            }
        }
    });
}

/**
 * Handles importing GSettings values from a user-selected JSON file.
 *
 * @param {Gio.Settings} settings
 * @param {Adw.PreferencesWindow} window
 */
function handleImportSettings(settings, window) {
    const dialog = new Gtk.FileDialog({
        title: _('Import Settings'),
    });

    try {
        const filters = new Gio.ListStore({ item_type: Gtk.FileFilter });
        const jsonFilter = new Gtk.FileFilter();
        jsonFilter.set_name(_('JSON Files'));
        jsonFilter.add_mime_type('application/json');
        jsonFilter.add_pattern('*.json');
        filters.append(jsonFilter);
        dialog.set_filters(filters);
    } catch (e) {
        console.warn(`[AIO-Clipboard] Could not setup file filter: ${e.message}`);
    }

    dialog.open(window, null, (source, result) => {
        try {
            const file = dialog.open_finish(result);
            if (!file) {
                return;
            }

            file.load_contents_async(null, (fileSource, readResult) => {
                try {
                    const [success, contents] = fileSource.load_contents_finish(readResult);
                    if (!success) {
                        throw new Error('Failed to read file contents.');
                    }

                    const jsonStr = new TextDecoder('utf-8').decode(contents);
                    const importedData = JSON.parse(jsonStr);
                    applyImportedSettings(settings, importedData);
                    showToast(window, _('Settings successfully imported.'));
                } catch (err) {
                    console.error(`[AIO-Clipboard] Failed to parse imported settings: ${err.message}`);
                    showToast(window, _('Failed to import settings. Invalid file.'));
                }
            });
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                console.error(`[AIO-Clipboard] Error during import dialog: ${e.message}`);
            }
        }
    });
}

/**
 * Handles resetting all GSettings values to their defaults after confirmation.
 *
 * @param {Gio.Settings} settings
 * @param {Adw.PreferencesWindow} window
 */
function handleResetSettings(settings, window) {
    const dialog = new Adw.MessageDialog({
        heading: _('Reset All Settings?'),
        body: _('Are you sure you want to restore all extension settings to their defaults? This action cannot be undone.'),
        transient_for: window,
        modal: true,
    });

    dialog.add_response('cancel', _('Cancel'));
    dialog.add_response('reset', _('Reset'));
    dialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);

    dialog.connect('response', (self, response) => {
        if (response === 'reset') {
            try {
                const keys = settings.list_keys();
                for (const key of keys) {
                    settings.reset(key);
                }
                showToast(window, _('Settings successfully reset to defaults.'));
            } catch (err) {
                console.error(`[AIO-Clipboard] Failed to reset settings: ${err.message}`);
                showToast(window, _('Failed to reset settings.'));
            }
        }
    });

    dialog.present();
}

/**
 * Validates and applies parsed JSON data into Gio.Settings.
 *
 * @param {Gio.Settings} settings
 * @param {Object} importedData
 */
function applyImportedSettings(settings, importedData) {
    if (typeof importedData !== 'object' || importedData === null) {
        throw new Error('Config file root must be an object.');
    }

    const availableKeys = settings.list_keys();
    for (const [key, value] of Object.entries(importedData)) {
        if (key === 'clear-recents-trigger') {
            continue;
        }

        if (!availableKeys.includes(key)) {
            console.warn(`[AIO-Clipboard] Ignoring unknown config key: ${key}`);
            continue;
        }

        try {
            const currentVal = settings.get_value(key);
            const typeStr = currentVal.get_type_string();

            const newVal = new GLib.Variant(typeStr, value);
            settings.set_value(key, newVal);
        } catch (e) {
            console.warn(`[AIO-Clipboard] Failed to set config key ${key}: ${e.message}`);
        }
    }
}

/**
 * Show a simple toast notification on the preferences window.
 *
 * @param {Adw.PreferencesWindow} window
 * @param {string} title
 */
function showToast(window, title) {
    const toast = new Adw.Toast({ title, timeout: 3 });
    window.add_toast(toast);
}
