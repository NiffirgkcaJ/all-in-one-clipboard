import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { createNavigationPage, getRangeFromSchema, presentSubpage } from '../../../shared/preferences/preferenceUtilities.js';

// ========================================================================
// Content Preferences Subpage
// ========================================================================

/**
 * Adds the Content Settings row and secondary navigation page.
 *
 * @param {Object} params Configuration parameters.
 * @param {Adw.PreferencesGroup} params.group Parent group where the content row is appended.
 * @param {Gio.Settings} params.settings Extension settings instance.
 * @param {Adw.PreferencesWindow} params.window Preferences window for navigation.
 */
export function addClipboardContentPrefs({ group, settings, window }) {
    const EXTRACT_LIMIT_INCREMENT = 1;

    // Content Settings
    const contentRow = new Adw.ActionRow({
        title: _('Content Settings'),
        subtitle: _('Configure capture, extraction, and formatting for different content types.'),
        activatable: true,
    });
    contentRow.add_suffix(
        new Gtk.Image({
            icon_name: 'go-next-symbolic',
            valign: Gtk.Align.CENTER,
        }),
    );
    group.add(contentRow);

    const contentNav = createNavigationPage({
        title: _('Content Settings'),
        tag: 'clipboard-content-settings',
    });

    contentRow.connect('activated', () => {
        presentSubpage(contentRow, contentNav.page, window);
    });

    // Content Settings
    const contentGroup = new Adw.PreferencesGroup({
        title: _('Content Settings'),
        description: _('Manage extraction limits, paste formats, and action options for clipboard content types.'),
    });
    contentNav.content.add(contentGroup);

    // Image Content Settings
    const imageExpander = new Adw.ExpanderRow({
        title: _('Image Content Settings'),
        subtitle: _('Options for image items.'),
    });
    contentGroup.add(imageExpander);

    const extractImageRow = new Adw.SwitchRow({
        title: _('Extract Image Items from Files'),
        subtitle: _('Automatically extract image items from files.'),
    });
    imageExpander.add_row(extractImageRow);
    settings.bind('clipboard-image-extract-from-resource', extractImageRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    const limitImageRow = new Adw.SwitchRow({
        title: _('Limit Image Items to Extract'),
        subtitle: _('Limit the number of extracted image items.'),
    });
    imageExpander.add_row(limitImageRow);
    settings.bind('clipboard-image-limit-extract', limitImageRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    const imageLimitKey = 'clipboard-image-extract-limit';
    const imageLimitDefault = settings.get_default_value(imageLimitKey).get_int32();
    const imageLimitRange = getRangeFromSchema(settings, imageLimitKey);

    const imageLimitRow = new Adw.SpinRow({
        title: _('Maximum Image Items to Extract'),
        subtitle: _('Maximum image items to extract between %d and %d. Default: %d.').format(imageLimitRange.min, imageLimitRange.max, imageLimitDefault),
        adjustment: new Gtk.Adjustment({
            lower: imageLimitRange.min,
            upper: imageLimitRange.max,
            step_increment: EXTRACT_LIMIT_INCREMENT,
        }),
    });
    imageExpander.add_row(imageLimitRow);
    settings.bind(imageLimitKey, imageLimitRow.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);

    const syncImageSensitivity = () => {
        const extractEnabled = settings.get_boolean('clipboard-image-extract-from-resource');
        limitImageRow.sensitive = extractEnabled;
        imageLimitRow.sensitive = extractEnabled && settings.get_boolean('clipboard-image-limit-extract');
    };
    syncImageSensitivity();
    settings.connect('changed::clipboard-image-extract-from-resource', syncImageSensitivity);
    settings.connect('changed::clipboard-image-limit-extract', syncImageSensitivity);

    // Resource Content Settings
    const resourceExpander = new Adw.ExpanderRow({
        title: _('Resource Content Settings'),
        subtitle: _('Options for resource items.'),
    });
    contentGroup.add(resourceExpander);

    const captureResourceRow = new Adw.SwitchRow({
        title: _('Capture Resource Items from Files'),
        subtitle: _('Automatically capture resource items from files.'),
    });
    resourceExpander.add_row(captureResourceRow);
    settings.bind('clipboard-resource-capture', captureResourceRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    const resourceFormatModes = [
        { id: 'resource', label: _('Files and Folders') },
        { id: 'path', label: _('File Paths') },
        { id: 'uri', label: _('URI Links') },
    ];

    const resourceFormatRow = new Adw.ComboRow({
        title: _('Default Format'),
        subtitle: _('Default format for resource items.'),
        model: new Gtk.StringList({ strings: resourceFormatModes.map((f) => f.label) }),
    });
    resourceExpander.add_row(resourceFormatRow);

    const currentResourceFormat = settings.get_string('clipboard-resource-default-format') || 'resource';
    const initialResourceFormatIndex = resourceFormatModes.findIndex((f) => f.id === currentResourceFormat);
    resourceFormatRow.set_selected(initialResourceFormatIndex > -1 ? initialResourceFormatIndex : 0);

    resourceFormatRow.connect('notify::selected', () => {
        const index = resourceFormatRow.get_selected();
        if (index >= 0 && index < resourceFormatModes.length) {
            const newFormat = resourceFormatModes[index].id;
            if (settings.get_string('clipboard-resource-default-format') !== newFormat) {
                settings.set_string('clipboard-resource-default-format', newFormat);
            }
        }
    });

    settings.connect('changed::clipboard-resource-default-format', () => {
        const newFormat = settings.get_string('clipboard-resource-default-format');
        const newIndex = resourceFormatModes.findIndex((f) => f.id === newFormat);
        if (newIndex > -1 && resourceFormatRow.get_selected() !== newIndex) {
            resourceFormatRow.set_selected(newIndex);
        }
    });

    // Button Settings
    const resourceButtonsRow = new Adw.ActionRow({
        title: _('Button Settings'),
        subtitle: _('Configure button visibility and display order on cards.'),
        activatable: true,
    });
    resourceButtonsRow.add_suffix(
        new Gtk.Image({
            icon_name: 'go-next-symbolic',
            valign: Gtk.Align.CENTER,
        }),
    );
    resourceExpander.add_row(resourceButtonsRow);

    const resourceButtonsNav = createNavigationPage({
        title: _('Resource Button Settings'),
        tag: 'clipboard-resource-button-settings',
    });

    resourceButtonsRow.connect('activated', () => {
        presentSubpage(resourceButtonsRow, resourceButtonsNav.page, window);
    });

    // Button Settings
    const resourceButtonsGroup = new Adw.PreferencesGroup({
        title: _('Button Settings'),
        description: _('Manage visibility and order of action buttons for resource items.'),
    });
    resourceButtonsNav.content.add(resourceButtonsGroup);

    // Visible Buttons
    const visibleResourceButtonsExpander = new Adw.ExpanderRow({
        title: _('Visible Buttons'),
        subtitle: _('Show or hide action buttons on cards.'),
    });
    resourceButtonsGroup.add(visibleResourceButtonsExpander);

    const RESOURCE_BUTTON_CONFIGS = {
        resource: {
            title: _('Files and Folders'),
            subtitle: _('Show files and folders button.'),
            key: 'clipboard-resource-show-resource-button',
        },
        path: {
            title: _('File Paths'),
            subtitle: _('Show file paths button.'),
            key: 'clipboard-resource-show-path-button',
        },
        uri: {
            title: _('URI Links'),
            subtitle: _('Show URI links button.'),
            key: 'clipboard-resource-show-uri-button',
        },
    };

    Object.values(RESOURCE_BUTTON_CONFIGS).forEach((config) => {
        const row = new Adw.SwitchRow({
            title: config.title,
            subtitle: config.subtitle,
        });
        visibleResourceButtonsExpander.add_row(row);
        settings.bind(config.key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    });

    // Button Order
    const resourceOrderExpander = new Adw.ExpanderRow({
        title: _('Button Order'),
        subtitle: _('Use buttons to reorder action buttons on cards.'),
    });
    resourceButtonsGroup.add(resourceOrderExpander);

    let managedResourceOrderRows = [];

    const populateResourceOrderList = () => {
        managedResourceOrderRows.forEach((row) => resourceOrderExpander.remove(row));
        managedResourceOrderRows = [];

        const buttonOrder = settings.get_strv('clipboard-resource-button-order');

        buttonOrder.forEach((buttonId, index) => {
            const config = RESOURCE_BUTTON_CONFIGS[buttonId];
            if (!config) return;

            const isVisible = settings.get_boolean(config.key);
            const row = new Adw.ActionRow({
                title: isVisible ? config.title : `${config.title} (Hidden)`,
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
                sensitive: index < buttonOrder.length - 1,
            });

            const moveRow = (direction) => {
                const currentOrder = settings.get_strv('clipboard-resource-button-order');
                const oldIndex = currentOrder.indexOf(buttonId);
                const newIndex = oldIndex + direction;

                if (newIndex >= 0 && newIndex < currentOrder.length) {
                    [currentOrder[oldIndex], currentOrder[newIndex]] = [currentOrder[newIndex], currentOrder[oldIndex]];
                    settings.set_strv('clipboard-resource-button-order', currentOrder);
                }
            };

            upButton.connect('clicked', () => moveRow(-1));
            downButton.connect('clicked', () => moveRow(1));

            buttonBox.append(upButton);
            buttonBox.append(downButton);

            resourceOrderExpander.add_row(row);
            managedResourceOrderRows.push(row);
        });

        const resetRow = new Adw.ActionRow({
            title: _('Reset Order'),
            subtitle: _('Restore original action button order.'),
        });
        resourceOrderExpander.add_row(resetRow);
        managedResourceOrderRows.push(resetRow);

        const resetButton = new Gtk.Button({
            label: _('Reset'),
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });

        resetButton.connect('clicked', () => {
            const defaultValueVariant = settings.get_default_value('clipboard-resource-button-order');
            settings.set_strv('clipboard-resource-button-order', defaultValueVariant.get_strv());
        });
        resetRow.add_suffix(resetButton);
    };

    settings.connect('changed::clipboard-resource-button-order', populateResourceOrderList);
    Object.values(RESOURCE_BUTTON_CONFIGS).forEach((config) => {
        settings.connect(`changed::${config.key}`, populateResourceOrderList);
    });
    populateResourceOrderList();

    const syncResourceSensitivity = () => {
        const captureEnabled = settings.get_boolean('clipboard-resource-capture');
        resourceFormatRow.sensitive = captureEnabled;
        resourceButtonsRow.sensitive = captureEnabled;
    };
    syncResourceSensitivity();
    settings.connect('changed::clipboard-resource-capture', syncResourceSensitivity);

    // Link Content Settings
    const linkExpander = new Adw.ExpanderRow({
        title: _('Link Content Settings'),
        subtitle: _('Options for link items.'),
    });
    contentGroup.add(linkExpander);

    const extractLinkRow = new Adw.SwitchRow({
        title: _('Extract Link Items from Text'),
        subtitle: _('Automatically extract link items from text.'),
    });
    linkExpander.add_row(extractLinkRow);
    settings.bind('clipboard-link-extract-from-text', extractLinkRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    const limitLinkRow = new Adw.SwitchRow({
        title: _('Limit Link Items to Extract'),
        subtitle: _('Limit the number of extracted link items.'),
    });
    linkExpander.add_row(limitLinkRow);
    settings.bind('clipboard-link-limit-extract', limitLinkRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    const linkLimitKey = 'clipboard-link-extract-limit';
    const linkLimitDefault = settings.get_default_value(linkLimitKey).get_int32();
    const linkLimitRange = getRangeFromSchema(settings, linkLimitKey);

    const linkLimitRow = new Adw.SpinRow({
        title: _('Maximum Link Items to Extract'),
        subtitle: _('Maximum link items to extract between %d and %d. Default: %d.').format(linkLimitRange.min, linkLimitRange.max, linkLimitDefault),
        adjustment: new Gtk.Adjustment({
            lower: linkLimitRange.min,
            upper: linkLimitRange.max,
            step_increment: EXTRACT_LIMIT_INCREMENT,
        }),
    });
    linkExpander.add_row(linkLimitRow);
    settings.bind(linkLimitKey, linkLimitRow.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);

    const linkActionModes = [
        { id: 'paste', label: _('Paste Link') },
        { id: 'launch', label: _('Launch Link') },
    ];

    const linkActionRow = new Adw.ComboRow({
        title: _('Default Action'),
        subtitle: _('Default action for link items.'),
        model: new Gtk.StringList({ strings: linkActionModes.map((a) => a.label) }),
    });
    linkExpander.add_row(linkActionRow);

    const currentLinkAction = settings.get_string('clipboard-link-default-action') || 'paste';
    const initialLinkActionIndex = linkActionModes.findIndex((a) => a.id === currentLinkAction);
    linkActionRow.set_selected(initialLinkActionIndex > -1 ? initialLinkActionIndex : 0);

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

    const linkActionButtonRow = new Adw.SwitchRow({
        title: _('Action Button'),
        subtitle: _('Show action button for link items.'),
    });
    linkExpander.add_row(linkActionButtonRow);
    settings.bind('clipboard-link-show-action-button', linkActionButtonRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    const syncLinkSensitivity = () => {
        const extractEnabled = settings.get_boolean('clipboard-link-extract-from-text');
        limitLinkRow.sensitive = extractEnabled;
        linkLimitRow.sensitive = extractEnabled && settings.get_boolean('clipboard-link-limit-extract');
    };
    syncLinkSensitivity();
    settings.connect('changed::clipboard-link-extract-from-text', syncLinkSensitivity);
    settings.connect('changed::clipboard-link-limit-extract', syncLinkSensitivity);

    // Contact Content Settings
    const contactExpander = new Adw.ExpanderRow({
        title: _('Contact Content Settings'),
        subtitle: _('Options for contact items.'),
    });
    contentGroup.add(contactExpander);

    const extractContactRow = new Adw.SwitchRow({
        title: _('Extract Contact Items from Text'),
        subtitle: _('Automatically extract contact items from text.'),
    });
    contactExpander.add_row(extractContactRow);
    settings.bind('clipboard-contact-extract-from-text', extractContactRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    const limitContactRow = new Adw.SwitchRow({
        title: _('Limit Contact Items to Extract'),
        subtitle: _('Limit the number of extracted contact items.'),
    });
    contactExpander.add_row(limitContactRow);
    settings.bind('clipboard-contact-limit-extract', limitContactRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    const contactLimitKey = 'clipboard-contact-extract-limit';
    const contactLimitDefault = settings.get_default_value(contactLimitKey).get_int32();
    const contactLimitRange = getRangeFromSchema(settings, contactLimitKey);

    const contactLimitRow = new Adw.SpinRow({
        title: _('Maximum Contact Items to Extract'),
        subtitle: _('Maximum contact items to extract between %d and %d. Default: %d.').format(contactLimitRange.min, contactLimitRange.max, contactLimitDefault),
        adjustment: new Gtk.Adjustment({
            lower: contactLimitRange.min,
            upper: contactLimitRange.max,
            step_increment: EXTRACT_LIMIT_INCREMENT,
        }),
    });
    contactExpander.add_row(contactLimitRow);
    settings.bind(contactLimitKey, contactLimitRow.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);

    const syncContactSensitivity = () => {
        const extractEnabled = settings.get_boolean('clipboard-contact-extract-from-text');
        limitContactRow.sensitive = extractEnabled;
        contactLimitRow.sensitive = extractEnabled && settings.get_boolean('clipboard-contact-limit-extract');
    };
    syncContactSensitivity();
    settings.connect('changed::clipboard-contact-extract-from-text', syncContactSensitivity);
    settings.connect('changed::clipboard-contact-limit-extract', syncContactSensitivity);

    // Color Content Settings
    const colorExpander = new Adw.ExpanderRow({
        title: _('Color Content Settings'),
        subtitle: _('Options for color items.'),
    });
    contentGroup.add(colorExpander);

    const extractColorRow = new Adw.SwitchRow({
        title: _('Extract Color Items from Text'),
        subtitle: _('Automatically extract color items from text.'),
    });
    colorExpander.add_row(extractColorRow);
    settings.bind('clipboard-color-extract-from-text', extractColorRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    const limitColorRow = new Adw.SwitchRow({
        title: _('Limit Color Items to Extract'),
        subtitle: _('Limit the number of extracted color items.'),
    });
    colorExpander.add_row(limitColorRow);
    settings.bind('clipboard-color-limit-extract', limitColorRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    const colorLimitKey = 'clipboard-color-extract-limit';
    const colorLimitDefault = settings.get_default_value(colorLimitKey).get_int32();
    const colorLimitRange = getRangeFromSchema(settings, colorLimitKey);

    const colorLimitRow = new Adw.SpinRow({
        title: _('Maximum Color Items to Extract'),
        subtitle: _('Maximum color items to extract between %d and %d. Default: %d.').format(colorLimitRange.min, colorLimitRange.max, colorLimitDefault),
        adjustment: new Gtk.Adjustment({
            lower: colorLimitRange.min,
            upper: colorLimitRange.max,
            step_increment: EXTRACT_LIMIT_INCREMENT,
        }),
    });
    colorExpander.add_row(colorLimitRow);
    settings.bind(colorLimitKey, colorLimitRow.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);

    const syncColorSensitivity = () => {
        const extractEnabled = settings.get_boolean('clipboard-color-extract-from-text');
        limitColorRow.sensitive = extractEnabled;
        colorLimitRow.sensitive = extractEnabled && settings.get_boolean('clipboard-color-limit-extract');
    };
    syncColorSensitivity();
    settings.connect('changed::clipboard-color-extract-from-text', syncColorSensitivity);
    settings.connect('changed::clipboard-color-limit-extract', syncColorSensitivity);

    // Code Content Settings
    const codeExpander = new Adw.ExpanderRow({
        title: _('Code Content Settings'),
        subtitle: _('Options for code items.'),
    });
    contentGroup.add(codeExpander);

    const extractCodeRow = new Adw.SwitchRow({
        title: _('Extract Code Items from Text'),
        subtitle: _('Automatically extract code items from text.'),
    });
    codeExpander.add_row(extractCodeRow);
    settings.bind('clipboard-code-extract-from-text', extractCodeRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    const limitCodeRow = new Adw.SwitchRow({
        title: _('Limit Code Items to Extract'),
        subtitle: _('Limit the number of extracted code items.'),
    });
    codeExpander.add_row(limitCodeRow);
    settings.bind('clipboard-code-limit-extract', limitCodeRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    const codeLimitKey = 'clipboard-code-extract-limit';
    const codeLimitDefault = settings.get_default_value(codeLimitKey).get_int32();
    const codeLimitRange = getRangeFromSchema(settings, codeLimitKey);

    const codeLimitRow = new Adw.SpinRow({
        title: _('Maximum Code Items to Extract'),
        subtitle: _('Maximum code items to extract between %d and %d. Default: %d.').format(codeLimitRange.min, codeLimitRange.max, codeLimitDefault),
        adjustment: new Gtk.Adjustment({
            lower: codeLimitRange.min,
            upper: codeLimitRange.max,
            step_increment: EXTRACT_LIMIT_INCREMENT,
        }),
    });
    codeExpander.add_row(codeLimitRow);
    settings.bind(codeLimitKey, codeLimitRow.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);

    const syncCodeSensitivity = () => {
        const extractEnabled = settings.get_boolean('clipboard-code-extract-from-text');
        limitCodeRow.sensitive = extractEnabled;
        codeLimitRow.sensitive = extractEnabled && settings.get_boolean('clipboard-code-limit-extract');
    };
    syncCodeSensitivity();
    settings.connect('changed::clipboard-code-extract-from-text', syncCodeSensitivity);
    settings.connect('changed::clipboard-code-limit-extract', syncCodeSensitivity);

    // HTML Content Settings
    const htmlExpander = new Adw.ExpanderRow({
        title: _('HTML Content Settings'),
        subtitle: _('Options for HTML items.'),
    });
    contentGroup.add(htmlExpander);

    const htmlFormatModes = [
        { id: 'rich', label: _('Rich HTML') },
        { id: 'plain', label: _('Plain Text') },
    ];

    const htmlFormatRow = new Adw.ComboRow({
        title: _('Default Format'),
        subtitle: _('Default format for HTML items.'),
        model: new Gtk.StringList({ strings: htmlFormatModes.map((f) => f.label) }),
    });
    htmlExpander.add_row(htmlFormatRow);

    const currentHtmlFormat = settings.get_string('clipboard-html-default-format') || 'rich';
    const initialHtmlFormatIndex = htmlFormatModes.findIndex((f) => f.id === currentHtmlFormat);
    htmlFormatRow.set_selected(initialHtmlFormatIndex > -1 ? initialHtmlFormatIndex : 0);

    htmlFormatRow.connect('notify::selected', () => {
        const index = htmlFormatRow.get_selected();
        if (index >= 0 && index < htmlFormatModes.length) {
            const newFormat = htmlFormatModes[index].id;
            if (settings.get_string('clipboard-html-default-format') !== newFormat) {
                settings.set_string('clipboard-html-default-format', newFormat);
            }
        }
    });

    settings.connect('changed::clipboard-html-default-format', () => {
        const newFormat = settings.get_string('clipboard-html-default-format');
        const newIndex = htmlFormatModes.findIndex((f) => f.id === newFormat);
        if (newIndex > -1 && htmlFormatRow.get_selected() !== newIndex) {
            htmlFormatRow.set_selected(newIndex);
        }
    });

    // Button Settings
    const htmlButtonsRow = new Adw.ActionRow({
        title: _('Button Settings'),
        subtitle: _('Configure button visibility and display order on cards.'),
        activatable: true,
    });
    htmlButtonsRow.add_suffix(
        new Gtk.Image({
            icon_name: 'go-next-symbolic',
            valign: Gtk.Align.CENTER,
        }),
    );
    htmlExpander.add_row(htmlButtonsRow);

    const htmlButtonsNav = createNavigationPage({
        title: _('HTML Button Settings'),
        tag: 'clipboard-html-button-settings',
    });

    htmlButtonsRow.connect('activated', () => {
        presentSubpage(htmlButtonsRow, htmlButtonsNav.page, window);
    });

    // Button Settings
    const htmlButtonsGroup = new Adw.PreferencesGroup({
        title: _('Button Settings'),
        description: _('Manage visibility and order of action buttons for HTML items.'),
    });
    htmlButtonsNav.content.add(htmlButtonsGroup);

    // Visible Buttons
    const visibleHtmlButtonsExpander = new Adw.ExpanderRow({
        title: _('Visible Buttons'),
        subtitle: _('Show or hide action buttons on cards.'),
    });
    htmlButtonsGroup.add(visibleHtmlButtonsExpander);

    const HTML_BUTTON_CONFIGS = {
        format: {
            title: _('Format Button'),
            subtitle: _('Show format button for HTML items.'),
            key: 'clipboard-html-show-format-button',
        },
        image: {
            title: _('Image Button'),
            subtitle: _('Show image button for HTML items.'),
            key: 'clipboard-html-show-image-button',
        },
    };

    Object.values(HTML_BUTTON_CONFIGS).forEach((config) => {
        const row = new Adw.SwitchRow({
            title: config.title,
            subtitle: config.subtitle,
        });
        visibleHtmlButtonsExpander.add_row(row);
        settings.bind(config.key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    });

    // Button Order
    const htmlOrderExpander = new Adw.ExpanderRow({
        title: _('Button Order'),
        subtitle: _('Use buttons to reorder action buttons on cards.'),
    });
    htmlButtonsGroup.add(htmlOrderExpander);

    let managedHtmlOrderRows = [];

    const populateHtmlOrderList = () => {
        managedHtmlOrderRows.forEach((row) => htmlOrderExpander.remove(row));
        managedHtmlOrderRows = [];

        const buttonOrder = settings.get_strv('clipboard-html-button-order');

        buttonOrder.forEach((buttonId, index) => {
            const config = HTML_BUTTON_CONFIGS[buttonId];
            if (!config) return;

            const isVisible = settings.get_boolean(config.key);
            const row = new Adw.ActionRow({
                title: isVisible ? config.title : `${config.title} (Hidden)`,
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
                sensitive: index < buttonOrder.length - 1,
            });

            const moveRow = (direction) => {
                const currentOrder = settings.get_strv('clipboard-html-button-order');
                const oldIndex = currentOrder.indexOf(buttonId);
                const newIndex = oldIndex + direction;

                if (newIndex >= 0 && newIndex < currentOrder.length) {
                    [currentOrder[oldIndex], currentOrder[newIndex]] = [currentOrder[newIndex], currentOrder[oldIndex]];
                    settings.set_strv('clipboard-html-button-order', currentOrder);
                }
            };

            upButton.connect('clicked', () => moveRow(-1));
            downButton.connect('clicked', () => moveRow(1));

            buttonBox.append(upButton);
            buttonBox.append(downButton);

            htmlOrderExpander.add_row(row);
            managedHtmlOrderRows.push(row);
        });

        const resetRow = new Adw.ActionRow({
            title: _('Reset Order'),
            subtitle: _('Restore original action button order.'),
        });
        htmlOrderExpander.add_row(resetRow);
        managedHtmlOrderRows.push(resetRow);

        const resetButton = new Gtk.Button({
            label: _('Reset'),
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });

        resetButton.connect('clicked', () => {
            const defaultValueVariant = settings.get_default_value('clipboard-html-button-order');
            settings.set_strv('clipboard-html-button-order', defaultValueVariant.get_strv());
        });
        resetRow.add_suffix(resetButton);
    };

    settings.connect('changed::clipboard-html-button-order', populateHtmlOrderList);
    Object.values(HTML_BUTTON_CONFIGS).forEach((config) => {
        settings.connect(`changed::${config.key}`, populateHtmlOrderList);
    });
    populateHtmlOrderList();
}
