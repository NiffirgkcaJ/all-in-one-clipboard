import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

/**
 * Adds the "Tab Management" preferences group to the page.
 *
 * @param {Object} params
 * @param {Adw.PreferencesPage} params.page The preferences page to add the group to.
 * @param {Gio.Settings} params.settings The Gio.Settings instance.
 */
export function addPreferenceTabManagement({ page, settings }) {
    const group = new Adw.PreferencesGroup({
        title: _('Tab Management'),
        description: _('Customize the visibility, order, and default tab.'),
    });
    page.add(group);

    const signalIds = [];
    page.connect('unmap', () => {
        signalIds.forEach((id) => {
            if (settings) settings.disconnect(id);
        });
        signalIds.length = 0;
    });

    const TAB_VISIBILITY_CONFIG = {
        'Recently Used': {
            key: 'enable-recents-tab',
            title: _('Recently Used Tab'),
            subtitle: _('Required when Always Show Main Tabs is off.'),
        },
        Emoji: { key: 'enable-emoji-tab', title: _('Emoji Tab') },
        GIF: { key: 'enable-gif-tab', title: _('GIF Tab') },
        Kaomoji: { key: 'enable-kaomoji-tab', title: _('Kaomoji Tab') },
        Symbols: { key: 'enable-symbols-tab', title: _('Symbols Tab') },
        Clipboard: { key: 'enable-clipboard-tab', title: _('Clipboard Tab') },
    };

    // Visible Tabs
    const visibleTabsExpander = new Adw.ExpanderRow({
        title: _('Visible Tabs'),
        subtitle: _('Show or hide individual tabs from the main bar.'),
    });
    group.add(visibleTabsExpander);

    const tabVisibilityRows = [];
    for (const [name, config] of Object.entries(TAB_VISIBILITY_CONFIG)) {
        const row = new Adw.SwitchRow({
            title: config.title,
            subtitle: config.subtitle || '',
            activatable: true,
        });
        visibleTabsExpander.add_row(row);
        tabVisibilityRows.push({ name, config, row });
        settings.bind(config.key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    }

    // Tab Bar Behavior
    const tabBarExpander = new Adw.ExpanderRow({
        title: _('Tab Bar Behavior'),
        subtitle: _('Configure when the top tab bar is visible.'),
    });
    group.add(tabBarExpander);

    // Always Show Main Tabs
    const alwaysShowMainTabsRow = new Adw.SwitchRow({
        title: _('Always Show Main Tabs'),
        subtitle: _('Keep the main tab buttons visible in every tab.'),
    });
    settings.bind('always-show-main-tab', alwaysShowMainTabsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    tabBarExpander.add_row(alwaysShowMainTabsRow);

    // Hide Last Main Tab
    const hideLastMainTabRow = new Adw.SwitchRow({
        title: _('Hide Last Main Tab'),
        subtitle: _('Automatically hide the last main tab visible.'),
    });
    settings.bind('hide-last-main-tab', hideLastMainTabRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    tabBarExpander.add_row(hideLastMainTabRow);

    // Default Tab
    const defaultTabRow = new Adw.ComboRow({
        title: _('Default Tab'),
        subtitle: _('The tab that opens when you first open the menu.'),
    });
    group.add(defaultTabRow);

    const recentsRowData = tabVisibilityRows.find((r) => r.name === 'Recently Used');
    const recentsRowWidget = recentsRowData?.row;
    const recentsKey = recentsRowData?.config.key;

    let visibleTabsForModel = [];

    const updateTabToggleSensitivity = () => {
        const states = tabVisibilityRows.map((item) => ({
            row: item.row,
            enabled: settings.get_boolean(item.config.key),
            isRecents: item.row === recentsRowWidget,
        }));

        const enabledCount = states.filter((state) => state.enabled).length;

        states.forEach((state) => {
            const isLastOneEnabled = enabledCount === 1 && state.enabled;

            if (state.isRecents) {
                const alwaysShowTabs = settings.get_boolean('always-show-main-tab');
                state.row.set_sensitive(!isLastOneEnabled && alwaysShowTabs);
            } else {
                state.row.set_sensitive(!isLastOneEnabled);
            }
        });
    };

    const updateDefaultTabModel = () => {
        const currentDefault = settings.get_string('default-tab');
        const tabOrder = settings.get_strv('tab-order');
        visibleTabsForModel = [];

        tabOrder.forEach((originalTabName) => {
            const config = TAB_VISIBILITY_CONFIG[originalTabName];
            if (!config || settings.get_boolean(config.key)) {
                visibleTabsForModel.push({
                    original: originalTabName,
                    translated: _(originalTabName),
                });
            }
        });

        defaultTabRow.set_model(new Gtk.StringList({ strings: visibleTabsForModel.map((t) => t.translated) }));
        const newIndex = visibleTabsForModel.findIndex((t) => t.original === currentDefault);

        if (newIndex > -1) {
            defaultTabRow.set_selected(newIndex);
        } else if (visibleTabsForModel.length > 0) {
            const newDefault = visibleTabsForModel[0].original;
            settings.set_string('default-tab', newDefault);
            defaultTabRow.set_selected(0);
        }
    };

    const handleSettingsChange = () => {
        if (!settings.get_boolean('always-show-main-tab') && recentsKey) {
            settings.set_boolean(recentsKey, true);
        }
        updateTabToggleSensitivity();
        updateDefaultTabModel();
    };

    Object.values(TAB_VISIBILITY_CONFIG).forEach((config) => {
        signalIds.push(settings.connect(`changed::${config.key}`, handleSettingsChange));
    });
    signalIds.push(settings.connect('changed::always-show-main-tab', handleSettingsChange));
    signalIds.push(settings.connect('changed::tab-order', updateDefaultTabModel));

    defaultTabRow.connect('notify::selected', () => {
        const selectedIndex = defaultTabRow.get_selected();
        if (selectedIndex >= 0 && selectedIndex < visibleTabsForModel.length) {
            const selectedOriginalName = visibleTabsForModel[selectedIndex].original;
            if (settings.get_string('default-tab') !== selectedOriginalName) {
                settings.set_string('default-tab', selectedOriginalName);
            }
        }
    });

    handleSettingsChange();

    // Tab Order
    const tabOrderExpander = new Adw.ExpanderRow({
        title: _('Tab Order'),
        subtitle: _('Use the buttons to reorder tabs in the main bar.'),
    });
    group.add(tabOrderExpander);

    let managedRows = [];

    const populateTabOrderList = () => {
        managedRows.forEach((row) => tabOrderExpander.remove(row));
        managedRows = [];

        const tabOrder = settings.get_strv('tab-order');

        tabOrder.forEach((tabName, index) => {
            const config = TAB_VISIBILITY_CONFIG[tabName];
            const isVisible = config ? settings.get_boolean(config.key) : true;

            const row = new Adw.ActionRow({
                title: isVisible ? _(tabName) : `${_(tabName)} (Hidden)`,
            });

            if (!isVisible) {
                row.add_css_class('dim-label');
            }

            const buttonBox = new Gtk.Box({ spacing: 6, valign: Gtk.Align.CENTER });
            row.add_suffix(buttonBox);

            const upButton = new Gtk.Button({
                icon_name: 'go-up-symbolic',
                sensitive: index > 0,
            });
            const downButton = new Gtk.Button({
                icon_name: 'go-down-symbolic',
                sensitive: index < tabOrder.length - 1,
            });

            const moveRow = (direction) => {
                const currentOrder = settings.get_strv('tab-order');
                const oldIndex = currentOrder.indexOf(tabName);
                const newIndex = oldIndex + direction;

                if (newIndex >= 0 && newIndex < currentOrder.length) {
                    [currentOrder[oldIndex], currentOrder[newIndex]] = [currentOrder[newIndex], currentOrder[oldIndex]];
                    settings.set_strv('tab-order', currentOrder);
                }
            };

            upButton.connect('clicked', () => moveRow(-1));
            downButton.connect('clicked', () => moveRow(1));

            buttonBox.append(upButton);
            buttonBox.append(downButton);

            tabOrderExpander.add_row(row);
            managedRows.push(row);
        });

        const resetRow = new Adw.ActionRow({
            title: _('Reset Order'),
            subtitle: _('Restore the original tab order.'),
        });
        tabOrderExpander.add_row(resetRow);
        managedRows.push(resetRow);

        const resetButton = new Gtk.Button({
            label: _('Reset'),
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });

        resetButton.connect('clicked', () => {
            const defaultValueVariant = settings.get_default_value('tab-order');
            settings.set_strv('tab-order', defaultValueVariant.get_strv());
        });
        resetRow.add_suffix(resetButton);
    };

    signalIds.push(settings.connect('changed::tab-order', populateTabOrderList));

    Object.values(TAB_VISIBILITY_CONFIG).forEach((config) => {
        if (config.key) {
            signalIds.push(settings.connect(`changed::${config.key}`, populateTabOrderList));
        }
    });
    populateTabOrderList();
}
