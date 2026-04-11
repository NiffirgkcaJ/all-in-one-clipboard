import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { getRangeFromSchema } from './preferenceUtilities.js';

/**
 * Adds the "Grid Columns" preferences group to the page.
 *
 * @param {Object} params
 * @param {Adw.PreferencesPage} params.page The preferences page to add the group to.
 * @param {Gio.Settings} params.settings The Gio.Settings instance.
 */
export function addPreferenceGridLayout({ page, settings }) {
    const group = new Adw.PreferencesGroup({
        title: _('Grid Columns'),
        description: _('Control column counts for grid and masonry views. Turn off for automatic sizing.'),
    });
    page.add(group);

    const modules = [
        { title: _('Emoji'), limitKey: 'emoji-grid-limit-columns', maxKey: 'emoji-grid-max-columns' },
        { title: _('GIF'), limitKey: 'gif-grid-limit-columns', maxKey: 'gif-grid-max-columns' },
        { title: _('Kaomoji'), limitKey: 'kaomoji-grid-limit-columns', maxKey: 'kaomoji-grid-max-columns' },
        { title: _('Symbols'), limitKey: 'symbols-grid-limit-columns', maxKey: 'symbols-grid-max-columns' },
        { title: _('Clipboard'), limitKey: 'clipboard-grid-limit-columns', maxKey: 'clipboard-grid-max-columns' },
    ];

    modules.forEach((module) => {
        const expander = new Adw.ExpanderRow({
            title: _('%s Columns').format(module.title),
            subtitle: _('Automatic when off.'),
            show_enable_switch: true,
        });
        group.add(expander);
        settings.bind(module.limitKey, expander, 'enable-expansion', Gio.SettingsBindFlags.DEFAULT);

        const maxDefault = settings.get_default_value(module.maxKey).get_int32();
        const maxRange = getRangeFromSchema(settings, module.maxKey);

        const maxRow = new Adw.SpinRow({
            title: _('Maximum Columns'),
            subtitle: _('Range: %d-%d. Default: %d.').format(maxRange.min, maxRange.max, maxDefault),
            adjustment: new Gtk.Adjustment({
                lower: maxRange.min,
                upper: maxRange.max,
                step_increment: 1,
            }),
        });
        expander.add_row(maxRow);
        settings.bind(module.maxKey, maxRow.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);

        const syncExpandedState = () => {
            expander.expanded = expander.enable_expansion;
        };
        syncExpandedState();
        expander.connect('notify::enable-expansion', syncExpandedState);
    });
}
