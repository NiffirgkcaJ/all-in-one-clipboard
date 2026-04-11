import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

/**
 * Adds the "Auto-Paste" preferences group to the page.
 *
 * @param {Object} params
 * @param {Adw.PreferencesPage} params.page The preferences page to add the group to.
 * @param {Gio.Settings} params.settings The Gio.Settings instance.
 */
export function addPreferenceAutoPaste({ page, settings }) {
    const group = new Adw.PreferencesGroup({
        title: _('Auto-Paste Settings'),
        description: _('Automatically paste selected items instead of just copying to clipboard.'),
    });
    page.add(group);

    // Enable Auto-Paste
    const autoPasteExpander = new Adw.ExpanderRow({
        title: _('Enable Auto-Paste'),
        subtitle: _('Automatically paste selected items instead of just copying to clipboard.'),
        show_enable_switch: true,
    });
    group.add(autoPasteExpander);

    settings.bind('enable-auto-paste', autoPasteExpander, 'enable-expansion', Gio.SettingsBindFlags.DEFAULT);

    const features = [
        { key: 'auto-paste-emoji', title: _('Auto-Paste Emojis') },
        { key: 'auto-paste-gif', title: _('Auto-Paste GIFs') },
        { key: 'auto-paste-kaomoji', title: _('Auto-Paste Kaomojis') },
        { key: 'auto-paste-symbols', title: _('Auto-Paste Symbols') },
        { key: 'auto-paste-clipboard', title: _('Auto-Paste from Clipboard History') },
    ];

    features.forEach((feature) => {
        const row = new Adw.SwitchRow({
            title: feature.title,
        });
        autoPasteExpander.add_row(row);
        settings.bind(feature.key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    });
}
