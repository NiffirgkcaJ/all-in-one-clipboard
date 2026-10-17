import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { createNavigationPage, getRangeFromSchema, presentSubpage } from '../../../shared/preferences/preferenceUtilities.js';

// ========================================================================
// Sizing Preferences Subpage
// ========================================================================

/**
 * Adds the List View Sizing row and secondary navigation page.
 *
 * @param {Object} params Configuration parameters.
 * @param {Adw.PreferencesGroup} params.group Parent group where the sizing row is appended.
 * @param {Gio.Settings} params.settings Extension settings instance.
 * @param {Adw.PreferencesWindow} params.window Preferences window for navigation.
 */
export function addClipboardListViewSizingPrefs({ group, settings, window }) {
    // List View Sizing
    const sizingRow = new Adw.ActionRow({
        title: _('List View Sizing'),
        subtitle: _('Customize preview line counts and baseline row heights.'),
        activatable: true,
    });
    sizingRow.add_suffix(
        new Gtk.Image({
            icon_name: 'go-next-symbolic',
            valign: Gtk.Align.CENTER,
        }),
    );
    group.add(sizingRow);

    const sizingNav = createNavigationPage({
        title: _('List View Sizing'),
        tag: 'clipboard-list-view-sizing',
    });

    sizingRow.connect('activated', () => {
        presentSubpage(sizingRow, sizingNav.page, window);
    });

    // Content Sizing
    const sizingGroup = new Adw.PreferencesGroup({
        title: _('Content Sizing'),
        description: _('Configure preview lines, thumbnail sizes, and baseline height enforcement.'),
    });
    sizingNav.content.add(sizingGroup);

    // Text
    const textExpander = new Adw.ExpanderRow({
        title: _('Text'),
        subtitle: _('Preview lines and baseline height for text.'),
    });
    sizingGroup.add(textExpander);

    const textLinesKey = 'clipboard-text-preview-lines';
    const textLinesDefault = settings.get_default_value(textLinesKey).get_int32();
    const textLinesRange = getRangeFromSchema(settings, textLinesKey);

    const textLinesRow = new Adw.SpinRow({
        title: _('Text Preview Lines'),
        subtitle: _('Lines to display for text previews (%d-%d). Default: %d.').format(textLinesRange.min, textLinesRange.max, textLinesDefault),
        adjustment: new Gtk.Adjustment({
            lower: textLinesRange.min,
            upper: textLinesRange.max,
            step_increment: 1,
        }),
    });
    textExpander.add_row(textLinesRow);
    settings.bind(textLinesKey, textLinesRow.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);

    const textHeightRow = new Adw.SwitchRow({
        title: _('Text Default Height'),
        subtitle: _('Preserve standard height for text items.'),
    });
    textExpander.add_row(textHeightRow);
    settings.bind('clipboard-text-enforce-default-height', textHeightRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    // Code
    const codeExpander = new Adw.ExpanderRow({
        title: _('Code'),
        subtitle: _('Preview lines and baseline height for code.'),
    });
    sizingGroup.add(codeExpander);

    const codeLinesKey = 'clipboard-code-preview-lines';
    const codeLinesDefault = settings.get_default_value(codeLinesKey).get_int32();
    const codeLinesRange = getRangeFromSchema(settings, codeLinesKey);

    const codeLinesRow = new Adw.SpinRow({
        title: _('Code Preview Lines'),
        subtitle: _('Lines to display for code previews (%d-%d). Default: %d.').format(codeLinesRange.min, codeLinesRange.max, codeLinesDefault),
        adjustment: new Gtk.Adjustment({
            lower: codeLinesRange.min,
            upper: codeLinesRange.max,
            step_increment: 1,
        }),
    });
    codeExpander.add_row(codeLinesRow);
    settings.bind(codeLinesKey, codeLinesRow.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);

    const codeHeightRow = new Adw.SwitchRow({
        title: _('Code Default Height'),
        subtitle: _('Preserve standard height for code items.'),
    });
    codeExpander.add_row(codeHeightRow);
    settings.bind('clipboard-code-enforce-default-height', codeHeightRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    // HTML
    const htmlExpander = new Adw.ExpanderRow({
        title: _('HTML'),
        subtitle: _('Preview lines and baseline height for HTML.'),
    });
    sizingGroup.add(htmlExpander);

    const htmlLinesKey = 'clipboard-html-preview-lines';
    const htmlLinesDefault = settings.get_default_value(htmlLinesKey).get_int32();
    const htmlLinesRange = getRangeFromSchema(settings, htmlLinesKey);

    const htmlLinesRow = new Adw.SpinRow({
        title: _('HTML Preview Lines'),
        subtitle: _('Lines to display for HTML previews (%d-%d). Default: %d.').format(htmlLinesRange.min, htmlLinesRange.max, htmlLinesDefault),
        adjustment: new Gtk.Adjustment({
            lower: htmlLinesRange.min,
            upper: htmlLinesRange.max,
            step_increment: 1,
        }),
    });
    htmlExpander.add_row(htmlLinesRow);
    settings.bind(htmlLinesKey, htmlLinesRow.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);

    const htmlHeightRow = new Adw.SwitchRow({
        title: _('HTML Default Height'),
        subtitle: _('Preserve standard height for HTML items.'),
    });
    htmlExpander.add_row(htmlHeightRow);
    settings.bind('clipboard-html-enforce-default-height', htmlHeightRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    // Image
    const imageExpander = new Adw.ExpanderRow({
        title: _('Image'),
        subtitle: _('Preview size and baseline height for images.'),
    });
    sizingGroup.add(imageExpander);

    const previewKey = 'clipboard-image-preview-size';
    const previewDefault = settings.get_default_value(previewKey).get_int32();
    const previewRange = getRangeFromSchema(settings, previewKey);

    const previewRow = new Adw.SpinRow({
        title: _('Image Preview Size'),
        subtitle: _('Pixels to display for image previews (%d-%d). Default: %d.').format(previewRange.min, previewRange.max, previewDefault),
        adjustment: new Gtk.Adjustment({
            lower: previewRange.min,
            upper: previewRange.max,
            step_increment: 4,
        }),
    });
    imageExpander.add_row(previewRow);
    settings.bind(previewKey, previewRow.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);

    const imageHeightRow = new Adw.SwitchRow({
        title: _('Image Default Height'),
        subtitle: _('Preserve standard height for image items.'),
    });
    imageExpander.add_row(imageHeightRow);
    settings.bind('clipboard-image-enforce-default-height', imageHeightRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    // Metadata
    const metadataExpander = new Adw.ExpanderRow({
        title: _('Metadata'),
        subtitle: _('Baseline height for metadata items.'),
    });
    sizingGroup.add(metadataExpander);

    const metadataHeightRow = new Adw.SwitchRow({
        title: _('Metadata Default Height'),
        subtitle: _('Preserve standard height for metadata items.'),
    });
    metadataExpander.add_row(metadataHeightRow);
    settings.bind('clipboard-metadata-enforce-default-height', metadataHeightRow, 'active', Gio.SettingsBindFlags.DEFAULT);
}
