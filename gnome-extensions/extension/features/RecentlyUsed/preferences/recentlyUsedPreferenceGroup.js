import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { getRangeFromSchema } from '../../../shared/preferences/preferenceUtilities.js';

import { addRecentlyUsedAdvancedOverridesPrefs } from './recentlyUsedAdvancedOverridesPrefs.js';
import { getRecentlyUsedOrder } from '../definitions/recentlyUsedOrder.js';

/**
 * Adds the "Recently Used Settings" preferences group to the page.
 *
 * @param {Object} params
 * @param {Adw.PreferencesPage} params.page The preferences page to add the group to.
 * @param {Gio.Settings} params.settings The Gio.Settings instance.
 * @param {Adw.PreferencesWindow} params.window The preferences window for subpage navigation.
 */
export function addPreferenceRecentlyUsedSettings({ page, settings, window }) {
    const group = new Adw.PreferencesGroup({
        title: _('Recently Used Settings'),
        description: _('Behavior settings for the Recently Used tab.'),
    });
    page.add(group);

    const signalIds = [];
    page.connect('unmap', () => {
        signalIds.forEach((id) => {
            if (settings && id > 0) {
                settings.disconnect(id);
            }
        });
        signalIds.length = 0;
    });

    const addRowToContainer = (container, row) => {
        if (typeof container.add_row === 'function') {
            container.add_row(row);
            return;
        }

        container.add(row);
    };

    const bindComboRowToStringSetting = ({ row, key, options }) => {
        const syncFromSettings = () => {
            const currentValue = settings.get_string(key);
            const nextIndex = options.findIndex((option) => option.id === currentValue);
            const safeIndex = nextIndex > -1 ? nextIndex : 0;
            if (row.get_selected() !== safeIndex) {
                row.set_selected(safeIndex);
            }
        };

        row.connect('notify::selected', () => {
            const index = row.get_selected();
            if (index < 0 || index >= options.length) {
                return;
            }

            const nextValue = options[index].id;
            if (settings.get_string(key) !== nextValue) {
                settings.set_string(key, nextValue);
            }
        });

        signalIds.push(settings.connect(`changed::${key}`, syncFromSettings));
        syncFromSettings();
    };

    const createStringComboRow = ({ title, subtitle, key, options }) => {
        const row = new Adw.ComboRow({
            title,
            subtitle,
            model: new Gtk.StringList({ strings: options.map((option) => option.label) }),
        });

        bindComboRowToStringSetting({ row, key, options });
        return row;
    };

    const createSpinRow = ({ key, title, subtitle }) => {
        const range = getRangeFromSchema(settings, key);
        const defaultValue = settings.get_default_value(key).get_int32();

        const row = new Adw.SpinRow({
            title,
            subtitle: _('%s Range: %d-%d. Default: %d.').format(subtitle, range.min, range.max, defaultValue),
            adjustment: new Gtk.Adjustment({
                lower: range.min,
                upper: range.max,
                step_increment: 1,
            }),
        });

        settings.bind(key, row.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
        return row;
    };

    const setupToggleExpander = ({ expander, key }) => {
        settings.bind(key, expander, 'enable-expansion', Gio.SettingsBindFlags.DEFAULT);

        const syncExpandedState = () => {
            if (!expander.enable_expansion && expander.expanded) {
                expander.expanded = false;
            }
        };

        syncExpandedState();
        expander.connect('notify::enable-expansion', syncExpandedState);
    };

    // Enable Search in Recently Used
    const searchToggleRow = new Adw.SwitchRow({
        title: _('Enable Search in Recently Used'),
        subtitle: _('Show a global search bar to filter items across Recently Used sections.'),
    });
    group.add(searchToggleRow);
    settings.bind('enable-recently-used-search', searchToggleRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    // Global Limit Policy
    const globalLimitPolicyRow = createStringComboRow({
        key: 'recently-used-default-limit-mode',
        title: _('Global Limit Policy'),
        subtitle: _('Used when custom limit policy by context is disabled.'),
        options: [
            { id: 'limited', label: _('Limited') },
            { id: 'unlimited', label: _('Unlimited') },
        ],
    });
    group.add(globalLimitPolicyRow);

    // Customize Limit Policy by Context
    const limitPolicyExpander = new Adw.ExpanderRow({
        title: _('Customize Limit Policy by Context'),
        subtitle: _('Configure browse and search limit policy independently.'),
        show_enable_switch: true,
    });
    group.add(limitPolicyExpander);
    setupToggleExpander({ expander: limitPolicyExpander, key: 'recently-used-enable-custom-limit-policy' });
    limitPolicyExpander.bind_property('enable-expansion', globalLimitPolicyRow, 'sensitive', GObject.BindingFlags.SYNC_CREATE | GObject.BindingFlags.INVERT_BOOLEAN);

    const browsePolicyRow = createStringComboRow({
        key: 'recently-used-history-limit-mode',
        title: _('Browse Policy'),
        subtitle: _('Policy applied while browsing (non-search).'),
        options: [
            { id: 'limited', label: _('Limited') },
            { id: 'unlimited', label: _('Unlimited') },
        ],
    });
    addRowToContainer(limitPolicyExpander, browsePolicyRow);

    const searchPolicyRow = createStringComboRow({
        key: 'recently-used-search-limit-mode',
        title: _('Search Policy'),
        subtitle: _('Policy applied only when search is enabled.'),
        options: [
            { id: 'limited', label: _('Limited') },
            { id: 'unlimited', label: _('Unlimited') },
        ],
    });
    addRowToContainer(limitPolicyExpander, searchPolicyRow);
    searchToggleRow.bind_property('active', searchPolicyRow, 'sensitive', GObject.BindingFlags.SYNC_CREATE);

    // Global Display Mode
    const globalDisplayModeRow = createStringComboRow({
        key: 'recently-used-default-display-mode',
        title: _('Global Display Mode'),
        subtitle: _('Used when custom display mode by view is disabled.'),
        options: [
            { id: 'fixed-window', label: _('Fixed Window') },
            { id: 'scroll-window', label: _('Scroll Window') },
        ],
    });
    group.add(globalDisplayModeRow);

    // Customize Display Mode by View
    const displayByViewExpander = new Adw.ExpanderRow({
        title: _('Customize Display Mode by View'),
        subtitle: _('Configure list and grid display mode independently.'),
        show_enable_switch: true,
    });
    group.add(displayByViewExpander);
    setupToggleExpander({ expander: displayByViewExpander, key: 'recently-used-enable-custom-display-mode' });
    displayByViewExpander.bind_property('enable-expansion', globalDisplayModeRow, 'sensitive', GObject.BindingFlags.SYNC_CREATE | GObject.BindingFlags.INVERT_BOOLEAN);

    addRowToContainer(
        displayByViewExpander,
        createStringComboRow({
            key: 'recently-used-list-display-mode',
            title: _('List Display Mode'),
            subtitle: _('Display mode for list view.'),
            options: [
                { id: 'fixed-window', label: _('Fixed Window') },
                { id: 'scroll-window', label: _('Scroll Window') },
            ],
        }),
    );
    addRowToContainer(
        displayByViewExpander,
        createStringComboRow({
            key: 'recently-used-grid-display-mode',
            title: _('Grid Display Mode'),
            subtitle: _('Display mode for grid view.'),
            options: [
                { id: 'fixed-window', label: _('Fixed Window') },
                { id: 'scroll-window', label: _('Scroll Window') },
            ],
        }),
    );

    // Global Visible Items
    const globalVisibleItemsRow = createSpinRow({
        key: 'recently-used-global-visible-items',
        title: _('Global Visible Items'),
        subtitle: _('Global item cap for list and grid when custom visible-items by view is disabled.'),
    });
    group.add(globalVisibleItemsRow);

    // Customize Visible Items by View
    const visibleItemsByViewExpander = new Adw.ExpanderRow({
        title: _('Customize Visible Items by View'),
        subtitle: _('Configure list and grid item caps independently.'),
        show_enable_switch: true,
    });
    group.add(visibleItemsByViewExpander);
    setupToggleExpander({ expander: visibleItemsByViewExpander, key: 'recently-used-enable-custom-visible-items' });
    visibleItemsByViewExpander.bind_property('enable-expansion', globalVisibleItemsRow, 'sensitive', GObject.BindingFlags.SYNC_CREATE | GObject.BindingFlags.INVERT_BOOLEAN);

    addRowToContainer(
        visibleItemsByViewExpander,
        createSpinRow({
            key: 'recently-used-list-visible-items',
            title: _('List Visible Items'),
            subtitle: _('Item cap for list view.'),
        }),
    );
    addRowToContainer(
        visibleItemsByViewExpander,
        createSpinRow({
            key: 'recently-used-grid-visible-items',
            title: _('Grid Visible Items'),
            subtitle: _('Item cap for grid view.'),
        }),
    );

    // Global Window Rows
    const globalWindowRowsRow = createSpinRow({
        key: 'recently-used-global-window-rows',
        title: _('Global Window Rows'),
        subtitle: _('Global row limit for list and grid when custom window limits by view is disabled.'),
    });
    group.add(globalWindowRowsRow);

    // Customize Window Limits by View
    const windowByViewExpander = new Adw.ExpanderRow({
        title: _('Customize Window Limits by View'),
        subtitle: _('Configure list and grid window rows and grid columns independently.'),
        show_enable_switch: true,
    });
    group.add(windowByViewExpander);
    setupToggleExpander({ expander: windowByViewExpander, key: 'recently-used-enable-custom-window-limits' });
    windowByViewExpander.bind_property('enable-expansion', globalWindowRowsRow, 'sensitive', GObject.BindingFlags.SYNC_CREATE | GObject.BindingFlags.INVERT_BOOLEAN);

    addRowToContainer(
        windowByViewExpander,
        createSpinRow({
            key: 'recently-used-list-window-rows',
            title: _('List Window Rows'),
            subtitle: _('Row limit for list view window.'),
        }),
    );
    addRowToContainer(
        windowByViewExpander,
        createSpinRow({
            key: 'recently-used-grid-window-rows',
            title: _('Grid Window Rows'),
            subtitle: _('Row limit for grid view window.'),
        }),
    );
    addRowToContainer(
        windowByViewExpander,
        createSpinRow({
            key: 'recently-used-grid-window-columns',
            title: _('Grid Window Columns'),
            subtitle: _('Column value for grid view window.'),
        }),
    );

    // Unlimited Safety Cap
    group.add(
        createSpinRow({
            key: 'recently-used-unlimited-safety-cap',
            title: _('Unlimited Safety Cap'),
            subtitle: _('Hard cap for unlimited mode to protect shell responsiveness.'),
        }),
    );

    // Advanced Overrides
    addRecentlyUsedAdvancedOverridesPrefs({
        settings,
        window,
        group,
        signalIds,
        sectionDescriptors: getRecentlyUsedOrder(_),
        getRangeFromSchema: (key) => getRangeFromSchema(settings, key),
    });
}
