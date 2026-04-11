import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { getRangeFromSchema } from './preferenceUtilities.js';

/**
 * Adds the "Recent Items Limits" preferences group to the page.
 *
 * @param {Object} params
 * @param {Adw.PreferencesPage} params.page The preferences page to add the group to.
 * @param {Gio.Settings} params.settings The Gio.Settings instance.
 */
export function addPreferenceRecentItems({ page, settings }) {
    const group = new Adw.PreferencesGroup({
        title: _('Recent Items Limits'),
        description: _('Maximum number of items to keep in "Recents" for each feature.'),
    });
    page.add(group);

    const items = [
        { key: 'emoji-recents-max-items', title: _('Maximum Recent Emojis') },
        { key: 'kaomoji-recents-max-items', title: _('Maximum Recent Kaomojis') },
        { key: 'symbols-recents-max-items', title: _('Maximum Recent Symbols') },
        { key: 'gif-recents-max-items', title: _('Maximum Recent GIFs') },
    ];

    items.forEach((item) => {
        const recentDefault = settings.get_default_value(item.key).get_int32();
        const recentRange = getRangeFromSchema(settings, item.key);
        const RECENT_INCREMENT_NUMBER = 1;

        const row = new Adw.SpinRow({
            title: item.title,
            subtitle: _('Range: %d-%d. Default: %d.').format(recentRange.min, recentRange.max, recentDefault),
            adjustment: new Gtk.Adjustment({
                lower: recentRange.min,
                upper: recentRange.max,
                step_increment: RECENT_INCREMENT_NUMBER,
            }),
        });
        group.add(row);
        settings.bind(item.key, row.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
    });
}
