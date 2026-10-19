import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { getRangeFromSchema } from '../../../shared/preferences/preferenceUtilities.js';

import { addClipboardListViewSizingPrefs } from './clipboardListViewSizingPrefs.js';

/**
 * Adds the "Clipboard Settings" preferences group to the page.
 *
 * @param {Object} params Configuration parameters.
 * @param {Adw.PreferencesPage} params.page The preferences page to add the group to.
 * @param {Gio.Settings} params.settings The Gio.Settings instance.
 * @param {Adw.PreferencesWindow} params.window The preferences window instance.
 */
export function addPreferenceClipboardSettings({ page, settings, window }) {
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

    // HTML Content Settings
    const htmlExpander = new Adw.ExpanderRow({
        title: _('HTML Content Settings'),
        subtitle: _('Formatting and paste options for HTML items.'),
    });
    group.add(htmlExpander);

    // Paste Format
    const formatModes = [
        { id: 'rich', label: _('Rich HTML') },
        { id: 'plain', label: _('Plain Text') },
    ];

    const pasteFormatRow = new Adw.ComboRow({
        title: _('Paste Format'),
        subtitle: _('Default paste format for HTML items.'),
        model: new Gtk.StringList({ strings: formatModes.map((f) => f.label) }),
    });
    htmlExpander.add_row(pasteFormatRow);

    const currentPasteFormat = settings.get_string('clipboard-html-paste-format') || 'rich';
    const initialFormatIndex = formatModes.findIndex((f) => f.id === currentPasteFormat);
    pasteFormatRow.set_selected(initialFormatIndex > -1 ? initialFormatIndex : 0);

    pasteFormatRow.connect('notify::selected', () => {
        const index = pasteFormatRow.get_selected();
        if (index >= 0 && index < formatModes.length) {
            const newFormat = formatModes[index].id;
            if (settings.get_string('clipboard-html-paste-format') !== newFormat) {
                settings.set_string('clipboard-html-paste-format', newFormat);
            }
        }
    });

    settings.connect('changed::clipboard-html-paste-format', () => {
        const newFormat = settings.get_string('clipboard-html-paste-format');
        const newIndex = formatModes.findIndex((f) => f.id === newFormat);
        if (newIndex > -1 && pasteFormatRow.get_selected() !== newIndex) {
            pasteFormatRow.set_selected(newIndex);
        }
    });

    // Show Format Paste Button
    const showFormatPasteButtonRow = new Adw.SwitchRow({
        title: _('Show Format Paste Button'),
        subtitle: _('Show button to paste alternative format.'),
    });
    htmlExpander.add_row(showFormatPasteButtonRow);
    settings.bind('clipboard-html-show-format-paste-button', showFormatPasteButtonRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    // Show Image Paste Button
    const showImagePasteButtonRow = new Adw.SwitchRow({
        title: _('Show Image Paste Button'),
        subtitle: _('Show button to paste embedded images.'),
    });
    htmlExpander.add_row(showImagePasteButtonRow);
    settings.bind('clipboard-html-show-image-paste-button', showImagePasteButtonRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    // Resource Content Settings
    const resourceExpander = new Adw.ExpanderRow({
        title: _('Resource Content Settings'),
        subtitle: _('Capture and paste options for file and folder items.'),
    });
    group.add(resourceExpander);

    // Capture Files and Folders
    const captureFilesRow = new Adw.SwitchRow({
        title: _('Capture Files and Folders'),
        subtitle: _('Record files and folders copied in file managers.'),
    });
    resourceExpander.add_row(captureFilesRow);
    settings.bind('capture-resource-items', captureFilesRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    // Paste Format
    const resourceFormatModes = [
        { id: 'resource', label: _('Files & Folders') },
        { id: 'uri', label: _('URI Links') },
    ];

    const resourcePasteFormatRow = new Adw.ComboRow({
        title: _('Paste Format'),
        subtitle: _('Default paste format for file and folder items.'),
        model: new Gtk.StringList({ strings: resourceFormatModes.map((f) => f.label) }),
    });
    resourceExpander.add_row(resourcePasteFormatRow);

    const currentResourcePasteFormat = settings.get_string('clipboard-resource-paste-format') || 'resource';
    const initialResourceFormatIndex = resourceFormatModes.findIndex((f) => f.id === currentResourcePasteFormat);
    resourcePasteFormatRow.set_selected(initialResourceFormatIndex > -1 ? initialResourceFormatIndex : 0);

    resourcePasteFormatRow.connect('notify::selected', () => {
        const index = resourcePasteFormatRow.get_selected();
        if (index >= 0 && index < resourceFormatModes.length) {
            const newFormat = resourceFormatModes[index].id;
            if (settings.get_string('clipboard-resource-paste-format') !== newFormat) {
                settings.set_string('clipboard-resource-paste-format', newFormat);
            }
        }
    });

    settings.connect('changed::clipboard-resource-paste-format', () => {
        const newFormat = settings.get_string('clipboard-resource-paste-format');
        const newIndex = resourceFormatModes.findIndex((f) => f.id === newFormat);
        if (newIndex > -1 && resourcePasteFormatRow.get_selected() !== newIndex) {
            resourcePasteFormatRow.set_selected(newIndex);
        }
    });

    // Show Format Paste Button
    const showResourceFormatPasteButtonRow = new Adw.SwitchRow({
        title: _('Show Format Paste Button'),
        subtitle: _('Show button to paste alternative format.'),
    });
    resourceExpander.add_row(showResourceFormatPasteButtonRow);
    settings.bind('clipboard-resource-show-format-paste-button', showResourceFormatPasteButtonRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    const syncResourceSensitivity = () => {
        const captureEnabled = settings.get_boolean('capture-resource-items');
        resourcePasteFormatRow.sensitive = captureEnabled;
        showResourceFormatPasteButtonRow.sensitive = captureEnabled;
    };
    syncResourceSensitivity();
    settings.connect('changed::capture-resource-items', syncResourceSensitivity);

    // Link Content Settings
    const linkExpander = new Adw.ExpanderRow({
        title: _('Link Content Settings'),
        subtitle: _('Capture and action options for web link items.'),
    });
    group.add(linkExpander);

    // Extract Links from Copied Text
    const extractLinksRow = new Adw.SwitchRow({
        title: _('Extract Links from Copied Text'),
        subtitle: _('Automatically extract web links from text into individual link items.'),
    });
    linkExpander.add_row(extractLinksRow);
    settings.bind('clipboard-link-extract-from-text', extractLinksRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    // Maximum Links to Extract
    const extractLimitKey = 'clipboard-link-extract-limit';
    const extractLimitDefault = settings.get_default_value(extractLimitKey).get_int32();
    const extractLimitRange = getRangeFromSchema(settings, extractLimitKey);
    const EXTRACT_LIMIT_INCREMENT = 1;

    const extractLimitRow = new Adw.SpinRow({
        title: _('Maximum Links to Extract'),
        subtitle: _('Maximum number of links to extract from a single copied text item between %d and %d. Default: %d.').format(extractLimitRange.min, extractLimitRange.max, extractLimitDefault),
        adjustment: new Gtk.Adjustment({
            lower: extractLimitRange.min,
            upper: extractLimitRange.max,
            step_increment: EXTRACT_LIMIT_INCREMENT,
        }),
    });
    linkExpander.add_row(extractLimitRow);
    settings.bind(extractLimitKey, extractLimitRow.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);

    // Primary Action
    const linkActionModes = [
        { id: 'paste', label: _('Paste Link') },
        { id: 'launch', label: _('Launch Link') },
    ];

    const linkActionRow = new Adw.ComboRow({
        title: _('Primary Action'),
        subtitle: _('Default action when clicking a link item.'),
        model: new Gtk.StringList({ strings: linkActionModes.map((a) => a.label) }),
    });
    linkExpander.add_row(linkActionRow);

    const currentLinkAction = settings.get_string('clipboard-link-default-action') || 'paste';
    const initialActionIndex = linkActionModes.findIndex((a) => a.id === currentLinkAction);
    linkActionRow.set_selected(initialActionIndex > -1 ? initialActionIndex : 0);

    linkActionRow.connect('notify::selected', () => {
        const index = linkActionRow.get_selected();
        if (index >= 0 && index < linkActionModes.length) {
            const newAction = linkActionModes[index].id;
            if (settings.get_string('clipboard-link-default-action') !== newAction) {
                settings.set_string('clipboard-link-default-action', newAction);
            }
        }
    });

    settings.connect('changed::clipboard-link-default-action', () => {
        const newAction = settings.get_string('clipboard-link-default-action');
        const newIndex = linkActionModes.findIndex((a) => a.id === newAction);
        if (newIndex > -1 && linkActionRow.get_selected() !== newIndex) {
            linkActionRow.set_selected(newIndex);
        }
    });

    // Show Action Button
    const showLinkActionButtonRow = new Adw.SwitchRow({
        title: _('Show Action Button'),
        subtitle: _('Show button to trigger alternative action on link items.'),
    });
    linkExpander.add_row(showLinkActionButtonRow);
    settings.bind('clipboard-link-show-action-button', showLinkActionButtonRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    const syncLinkSensitivity = () => {
        const extractionEnabled = settings.get_boolean('clipboard-link-extract-from-text');
        extractLimitRow.sensitive = extractionEnabled;
    };
    syncLinkSensitivity();
    settings.connect('changed::clipboard-link-extract-from-text', syncLinkSensitivity);

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

    // List View Sizing
    addClipboardListViewSizingPrefs({ group, settings, window });
}
