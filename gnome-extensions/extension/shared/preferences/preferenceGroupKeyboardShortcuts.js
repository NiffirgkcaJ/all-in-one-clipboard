import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

/**
 * Creates a row for a keyboard shortcut setting.
 *
 * @param {import('gi://Gio').Settings} settings The Gio.Settings instance.
 * @param {string} key The GSettings key for the shortcut.
 * @param {string} title The title to display for the shortcut.
 * @param {boolean} [isSingleString=false] Whether the key stores a single string instead of an array of strings.
 * @returns {Adw.ActionRow} The created action row.
 */
function createShortcutRow(settings, key, title, isSingleString = false) {
    const row = new Adw.ActionRow({
        title: title,
        activatable: true,
    });

    const getShortcutValue = () => {
        if (isSingleString) {
            return settings.get_string(key);
        }
        const values = settings.get_strv(key);
        return values[0] || '';
    };

    const setShortcutValue = (shortcut) => {
        if (isSingleString) {
            settings.set_string(key, shortcut);
        } else {
            settings.set_strv(key, shortcut ? [shortcut] : []);
        }
    };

    const currentShortcut = getShortcutValue() || _('Disabled');
    const shortcutLabel = new Gtk.ShortcutLabel({
        disabled_text: _('Disabled'),
        accelerator: currentShortcut === _('Disabled') ? '' : currentShortcut,
        valign: Gtk.Align.CENTER,
    });
    row.add_suffix(shortcutLabel);

    row.connect('activated', () => {
        const dialog = new Gtk.Dialog({
            title: _('Set Shortcut'),
            modal: true,
            transient_for: row.get_root(),
        });

        const content = dialog.get_content_area();
        const label = new Gtk.Label({
            label: _('Press a key combination\nBackspace to Clear, Escape to Cancel'),
            justify: Gtk.Justification.CENTER,
            margin_top: 12,
            margin_bottom: 12,
            margin_start: 12,
            margin_end: 12,
        });
        content.append(label);

        const widgetController = new Gtk.EventControllerKey({
            propagation_phase: Gtk.PropagationPhase.CAPTURE,
        });
        widgetController.connect('key-pressed', (c, keyval, keycode, state) => {
            // Cancel
            if (keyval === Gdk.KEY_Escape) {
                dialog.close();
                return Gdk.EVENT_STOP;
            }

            // Clear
            if (keyval === Gdk.KEY_BackSpace) {
                setShortcutValue('');
                shortcutLabel.set_accelerator('');
                dialog.close();
                return Gdk.EVENT_STOP;
            }

            // Standalone Modifiers
            const isModifier =
                keyval === Gdk.KEY_Control_L ||
                keyval === Gdk.KEY_Control_R ||
                keyval === Gdk.KEY_Shift_L ||
                keyval === Gdk.KEY_Shift_R ||
                keyval === Gdk.KEY_Alt_L ||
                keyval === Gdk.KEY_Alt_R ||
                keyval === Gdk.KEY_Super_L ||
                keyval === Gdk.KEY_Super_R ||
                keyval === Gdk.KEY_Meta_L ||
                keyval === Gdk.KEY_Meta_R;

            if (isModifier) return Gdk.EVENT_PROPAGATE;

            // ISO Left Tab
            let finalKeyval = keyval;
            if (keyval === Gdk.KEY_ISO_Left_Tab) finalKeyval = Gdk.KEY_Tab;

            // Save
            const mask = state & Gtk.accelerator_get_default_mod_mask();
            const shortcut = Gtk.accelerator_name(finalKeyval, mask);

            if (shortcut) {
                setShortcutValue(shortcut);
                shortcutLabel.set_accelerator(shortcut);
                dialog.close();
            }

            return Gdk.EVENT_STOP;
        });

        dialog.add_controller(widgetController);
        dialog.present();
    });
    return row;
}

/**
 * Adds the "Keyboard Shortcuts" preferences group to the page.
 *
 * @param {Object} params
 * @param {Adw.PreferencesPage} params.page The preferences page to add the group to.
 * @param {import('gi://Gio').Settings} params.settings The Gio.Settings instance.
 */
export function addPreferenceKeyboardShortcuts({ page, settings }) {
    const group = new Adw.PreferencesGroup({
        title: _('Keyboard Shortcuts'),
        description: _('Click on a shortcut to change it. Press Backspace to clear.'),
    });
    page.add(group);

    // Global Shortcuts
    const globalExpander = new Adw.ExpanderRow({
        title: _('Global Shortcuts'),
        subtitle: _('These work even when the menu is closed.'),
    });
    group.add(globalExpander);

    const globalShortcuts = [
        { key: 'shortcut-toggle-main', title: _('Toggle Main Menu') },
        { key: 'shortcut-open-emoji', title: _('Open Emoji Tab') },
        { key: 'shortcut-open-gif', title: _('Open GIF Tab') },
        { key: 'shortcut-open-kaomoji', title: _('Open Kaomoji Tab') },
        { key: 'shortcut-open-symbols', title: _('Open Symbols Tab') },
        { key: 'shortcut-open-clipboard', title: _('Open Clipboard Tab') },
    ];

    globalShortcuts.forEach((shortcut) => {
        const row = createShortcutRow(settings, shortcut.key, shortcut.title);
        globalExpander.add_row(row);
    });

    // Main Tab Navigation
    const mainTabExpander = new Adw.ExpanderRow({
        title: _('Main Tab Navigation'),
        subtitle: _('Switch between the main tabs within the menu.'),
    });
    group.add(mainTabExpander);

    const mainTabShortcuts = [
        { key: 'shortcut-next-tab', title: _('Next Tab') },
        { key: 'shortcut-prev-tab', title: _('Previous Tab') },
    ];

    mainTabShortcuts.forEach((shortcut) => {
        const row = createShortcutRow(settings, shortcut.key, shortcut.title);
        mainTabExpander.add_row(row);
    });

    // Category Navigation
    const categoryExpander = new Adw.ExpanderRow({
        title: _('Category Navigation'),
        subtitle: _('Switch between the categories within the tabs.'),
    });
    group.add(categoryExpander);

    const categoryShortcuts = [
        { key: 'shortcut-next-category', title: _('Next Category') },
        { key: 'shortcut-prev-category', title: _('Previous Category') },
    ];

    categoryShortcuts.forEach((shortcut) => {
        const row = createShortcutRow(settings, shortcut.key, shortcut.title);
        categoryExpander.add_row(row);
    });

    // Clipboard Item Actions
    const itemActionExpander = new Adw.ExpanderRow({
        title: _('Clipboard Item Actions'),
        subtitle: _('Shortcuts for items in the grid/list view.'),
    });
    group.add(itemActionExpander);

    const itemActionShortcuts = [
        { key: 'clipboard-key-toggle-select', title: _('Select Item'), isSingle: true },
        { key: 'clipboard-key-toggle-pin', title: _('Pin Item'), isSingle: true },
        { key: 'clipboard-key-delete', title: _('Delete Item'), isSingle: true },
    ];

    itemActionShortcuts.forEach((shortcut) => {
        const row = createShortcutRow(settings, shortcut.key, shortcut.title, shortcut.isSingle);
        itemActionExpander.add_row(row);
    });
}
