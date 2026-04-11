import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

/**
 * Adds the "Data Management" preferences group to the page.
 *
 * @param {Object} params
 * @param {Adw.PreferencesPage} params.page The preferences page to add the group to.
 * @param {Gio.Settings} params.settings The Gio.Settings instance.
 * @param {Adw.PreferencesWindow} params.window The preferences window for dialogs.
 */
export function addPreferenceDataManagement({ page, settings, window }) {
    const group = new Adw.PreferencesGroup({
        title: _('Data Management'),
        description: _('Manage stored data and configure automatic cleanup. Manual actions cannot be undone.'),
    });
    page.add(group);

    // Clear Data at Login
    const clearOnStartupExpander = new Adw.ExpanderRow({
        title: _('Clear Data at Login'),
        subtitle: _('Automatically clear selected data at every login.'),
        show_enable_switch: true,
    });
    group.add(clearOnStartupExpander);

    settings.bind('clear-data-at-login', clearOnStartupExpander, 'enable-expansion', Gio.SettingsBindFlags.DEFAULT);

    const loginClearToggles = [
        { key: 'clear-clipboard-history-at-login', title: _('Clear Clipboard History') },
        { key: 'clear-recent-emojis-at-login', title: _('Clear Recent Emojis') },
        { key: 'clear-recent-gifs-at-login', title: _('Clear Recent GIFs') },
        { key: 'clear-recent-kaomojis-at-login', title: _('Clear Recent Kaomojis') },
        { key: 'clear-recent-symbols-at-login', title: _('Clear Recent Symbols') },
    ];

    loginClearToggles.forEach((toggle) => {
        const row = new Adw.SwitchRow({ title: toggle.title });
        clearOnStartupExpander.add_row(row);
        settings.bind(toggle.key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    });

    const createClearButton = (triggerValue, parentWindow) => {
        const button = new Gtk.Button({
            label: _('Clear'),
            valign: Gtk.Align.CENTER,
        });
        button.add_css_class('destructive-action');
        button.connect('clicked', () => {
            const dialog = new Adw.MessageDialog({
                heading: _('Are you sure?'),
                body: _('The selected data will be permanently deleted.'),
                transient_for: parentWindow,
                modal: true,
            });
            dialog.add_response('cancel', _('Cancel'));
            dialog.add_response('clear', _('Clear'));
            dialog.set_response_appearance('clear', Adw.ResponseAppearance.DESTRUCTIVE);
            dialog.set_default_response('cancel');
            dialog.set_close_response('cancel');
            dialog.connect('response', (self, response) => {
                if (response === 'clear') {
                    settings.set_string('clear-recents-trigger', triggerValue);
                }
            });
            dialog.present();
        });
        return button;
    };

    // Recent Item History
    const recentsExpander = new Adw.ExpanderRow({
        title: _('Recent Item History'),
        subtitle: _('Clear lists of recently used items.'),
    });
    group.add(recentsExpander);

    const recentTypes = [
        {
            key: 'emoji',
            title: _('Recent Emojis'),
            subtitle: _('Permanently clears the list of recent emojis.'),
        },
        {
            key: 'gif',
            title: _('Recent GIFs'),
            subtitle: _('Permanently clears the list of recent GIFs.'),
        },
        {
            key: 'kaomoji',
            title: _('Recent Kaomojis'),
            subtitle: _('Permanently clears the list of recent kaomojis.'),
        },
        {
            key: 'symbols',
            title: _('Recent Symbols'),
            subtitle: _('Permanently clears the list of recent symbols.'),
        },
    ];
    recentTypes.forEach((type) => {
        const row = new Adw.ActionRow({ title: type.title, subtitle: type.subtitle });
        row.add_suffix(createClearButton(type.key, window));
        recentsExpander.add_row(row);
    });
    const clearAllRecentsRow = new Adw.ActionRow({
        title: _('All Recent Items'),
        subtitle: _('Permanently clears all of the above lists at once.'),
    });
    clearAllRecentsRow.add_suffix(createClearButton('all', window));
    recentsExpander.add_row(clearAllRecentsRow);

    // Clipboard Data
    const clipboardExpander = new Adw.ExpanderRow({
        title: _('Clipboard Data'),
        subtitle: _('Permanently delete your saved clipboard history and pinned items.'),
    });
    group.add(clipboardExpander);

    const clearClipboardHistoryRow = new Adw.ActionRow({
        title: _('Clipboard History'),
        subtitle: _('Permanently clears all saved unpinned clipboard items.'),
    });
    clearClipboardHistoryRow.add_suffix(createClearButton('clipboard-history', window));
    clipboardExpander.add_row(clearClipboardHistoryRow);

    const clearPinnedRow = new Adw.ActionRow({
        title: _('Pinned Items'),
        subtitle: _('Permanently clears all saved pinned clipboard items.'),
    });
    clearPinnedRow.add_suffix(createClearButton('clipboard-pinned', window));
    clipboardExpander.add_row(clearPinnedRow);

    // Performance Caches
    const cacheExpander = new Adw.ExpanderRow({
        title: _('Performance Caches'),
        subtitle: _('Clear temporary data used to improve loading speed.'),
    });
    group.add(cacheExpander);

    const clearGifCacheRow = new Adw.ActionRow({
        title: _('GIF Preview Cache'),
        subtitle: _('Permanently clears all downloaded GIF preview images.'),
    });
    clearGifCacheRow.add_suffix(createClearButton('gif-cache', window));
    cacheExpander.add_row(clearGifCacheRow);
}
