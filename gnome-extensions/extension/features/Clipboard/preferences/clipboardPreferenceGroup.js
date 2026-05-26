import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { getRangeFromSchema } from '../../../shared/preferences/preferenceUtilities.js';

/**
 * Adds the "Clipboard Settings" preferences group to the page.
 *
 * @param {Object} params
 * @param {Adw.PreferencesPage} params.page The preferences page to add the group to.
 * @param {Gio.Settings} params.settings The Gio.Settings instance.
 */
export function addPreferenceClipboardSettings({ page, settings }) {
    const group = new Adw.PreferencesGroup({
        title: _('Clipboard Settings'),
        description: _('Settings for the clipboard feature.'),
    });
    page.add(group);

    // Maximum Clipboard History
    const key = 'clipboard-history-max-items';
    const historyDefault = settings.get_default_value(key).get_int32();
    const historyRange = getRangeFromSchema(settings, key);
    const HISTORY_INCREMENT_NUMBER = 5;

    const maxItemsRow = new Adw.SpinRow({
        title: _('Maximum Clipboard History'),
        subtitle: _('Number of items to keep in history (%d-%d). Default: %d.').format(historyRange.min, historyRange.max, historyDefault),
        adjustment: new Gtk.Adjustment({
            lower: historyRange.min,
            upper: historyRange.max,
            step_increment: HISTORY_INCREMENT_NUMBER,
        }),
    });
    group.add(maxItemsRow);
    settings.bind(key, maxItemsRow.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);

    // Move to Top on Copy
    const updateRecencyRow = new Adw.SwitchRow({
        title: _('Move Item to Top on Copy'),
        subtitle: _('When copying an item from history, make it the most recent.'),
    });
    group.add(updateRecencyRow);
    settings.bind('update-recency-on-copy', updateRecencyRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    // Unpin on Paste
    const unpinOnPasteRow = new Adw.SwitchRow({
        title: _('Unpin Item on Paste'),
        subtitle: _('Automatically unpin an item when it is pasted.'),
    });
    group.add(unpinOnPasteRow);
    settings.bind('unpin-on-paste', unpinOnPasteRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    // Show Action Bar
    const showActionBarRow = new Adw.SwitchRow({
        title: _('Show Clipboard Action Bar'),
        subtitle: _('Show the toolbar above the clipboard list.'),
    });
    group.add(showActionBarRow);
    settings.bind('clipboard-show-action-bar', showActionBarRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    // Clipboard Layout Mode
    const layoutModes = [
        { id: 'list', label: _('List') },
        { id: 'grid', label: _('Grid') },
    ];

    const layoutRow = new Adw.ComboRow({
        title: _('Clipboard Layout'),
        subtitle: _('Display clipboard history as a list or a grid.'),
        model: new Gtk.StringList({ strings: layoutModes.map((m) => m.label) }),
    });
    group.add(layoutRow);

    const currentLayout = settings.get_string('clipboard-layout-mode') || 'list';
    const initialLayoutIndex = layoutModes.findIndex((m) => m.id === currentLayout);
    layoutRow.set_selected(initialLayoutIndex > -1 ? initialLayoutIndex : 0);

    layoutRow.connect('notify::selected', () => {
        const index = layoutRow.get_selected();
        if (index >= 0 && index < layoutModes.length) {
            const newMode = layoutModes[index].id;
            if (settings.get_string('clipboard-layout-mode') !== newMode) {
                settings.set_string('clipboard-layout-mode', newMode);
            }
        }
    });

    settings.connect('changed::clipboard-layout-mode', () => {
        const newMode = settings.get_string('clipboard-layout-mode');
        const newIndex = layoutModes.findIndex((m) => m.id === newMode);
        if (newIndex > -1 && layoutRow.get_selected() !== newIndex) {
            layoutRow.set_selected(newIndex);
        }
    });

    // Image Preview Size
    const previewKey = 'clipboard-image-preview-size';
    const previewDefault = settings.get_default_value(previewKey).get_int32();
    const previewRange = getRangeFromSchema(settings, previewKey);

    const previewRow = new Adw.SpinRow({
        title: _('Image Preview Size'),
        subtitle: _('Pixel size for clipboard image thumbnails (%d-%d). Default: %d.').format(previewRange.min, previewRange.max, previewDefault),
        adjustment: new Gtk.Adjustment({
            lower: previewRange.min,
            upper: previewRange.max,
            step_increment: 8,
        }),
    });
    group.add(previewRow);
    settings.bind(previewKey, previewRow.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);

    // Merge Selected Items
    const mergeSelectionExpander = new Adw.ExpanderRow({
        title: _('Merge Selected Items'),
        subtitle: _('Allow selecting and merging multiple items using checkboxes.'),
        show_enable_switch: true,
    });
    group.add(mergeSelectionExpander);

    settings.bind('enable-clipboard-merge-selection', mergeSelectionExpander, 'enable-expansion', Gio.SettingsBindFlags.DEFAULT);

    const syncExpanderSensitivity = () => {
        const sensitive = settings.get_boolean('clipboard-show-action-bar');
        mergeSelectionExpander.sensitive = sensitive;
    };
    syncExpanderSensitivity();
    settings.connect('changed::clipboard-show-action-bar', syncExpanderSensitivity);

    const syncExpandedState = () => {
        if ((!mergeSelectionExpander.enable_expansion || !mergeSelectionExpander.sensitive) && mergeSelectionExpander.expanded) {
            mergeSelectionExpander.expanded = false;
        }
    };
    syncExpandedState();
    mergeSelectionExpander.connect('notify::enable-expansion', syncExpandedState);
    mergeSelectionExpander.connect('notify::sensitive', syncExpandedState);

    // Delimiter
    const delimiterTypes = [
        { id: 'newline', label: _('Newline') },
        { id: 'double-newline', label: _('Double Newline') },
        { id: 'space', label: _('Space') },
        { id: 'comma', label: _('Comma') },
        { id: 'tab', label: _('Tab') },
        { id: 'custom', label: _('Custom') },
    ];

    const delimiterRow = new Adw.ComboRow({
        title: _('Delimiter'),
        subtitle: _('Delimiter used to separate text items when merging.'),
        model: new Gtk.StringList({ strings: delimiterTypes.map((d) => d.label) }),
    });
    mergeSelectionExpander.add_row(delimiterRow);

    const currentDelimiterType = settings.get_string('clipboard-merge-selection-delimiter-type') || 'newline';
    const initialDelimiterIndex = delimiterTypes.findIndex((d) => d.id === currentDelimiterType);
    delimiterRow.set_selected(initialDelimiterIndex > -1 ? initialDelimiterIndex : 0);

    delimiterRow.connect('notify::selected', () => {
        const index = delimiterRow.get_selected();
        if (index >= 0 && index < delimiterTypes.length) {
            const newType = delimiterTypes[index].id;
            if (settings.get_string('clipboard-merge-selection-delimiter-type') !== newType) {
                settings.set_string('clipboard-merge-selection-delimiter-type', newType);
            }
        }
    });

    // Custom Delimiter
    const customDelimiterRow = new Adw.EntryRow({
        title: _('Custom Delimiter'),
    });
    mergeSelectionExpander.add_row(customDelimiterRow);
    settings.bind('clipboard-merge-selection-delimiter-custom', customDelimiterRow, 'text', Gio.SettingsBindFlags.DEFAULT);

    const updateCustomVisibility = () => {
        const isCustom = settings.get_string('clipboard-merge-selection-delimiter-type') === 'custom';
        customDelimiterRow.set_visible(isCustom);
    };

    settings.connect('changed::clipboard-merge-selection-delimiter-type', () => {
        const newType = settings.get_string('clipboard-merge-selection-delimiter-type');
        const newIndex = delimiterTypes.findIndex((d) => d.id === newType);
        if (newIndex > -1 && delimiterRow.get_selected() !== newIndex) {
            delimiterRow.set_selected(newIndex);
        }
        updateCustomVisibility();
    });

    updateCustomVisibility();

    // Insertion Order
    const orderModes = [
        { id: 'selection', label: _('Selection Order') },
        { id: 'chronological', label: _('Chronological Order') },
    ];

    const orderRow = new Adw.ComboRow({
        title: _('Insertion Order'),
        subtitle: _('Order of items when merging selection.'),
        model: new Gtk.StringList({ strings: orderModes.map((o) => o.label) }),
    });
    mergeSelectionExpander.add_row(orderRow);

    const currentOrder = settings.get_string('clipboard-merge-selection-order') || 'selection';
    const initialOrderIndex = orderModes.findIndex((o) => o.id === currentOrder);
    orderRow.set_selected(initialOrderIndex > -1 ? initialOrderIndex : 0);

    orderRow.connect('notify::selected', () => {
        const index = orderRow.get_selected();
        if (index >= 0 && index < orderModes.length) {
            const newOrder = orderModes[index].id;
            if (settings.get_string('clipboard-merge-selection-order') !== newOrder) {
                settings.set_string('clipboard-merge-selection-order', newOrder);
            }
        }
    });

    settings.connect('changed::clipboard-merge-selection-order', () => {
        const newOrder = settings.get_string('clipboard-merge-selection-order');
        const newIndex = orderModes.findIndex((o) => o.id === newOrder);
        if (newIndex > -1 && orderRow.get_selected() !== newIndex) {
            orderRow.set_selected(newIndex);
        }
    });
}
