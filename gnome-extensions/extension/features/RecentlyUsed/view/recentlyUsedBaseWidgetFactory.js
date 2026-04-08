import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { createStaticIcon } from '../../../shared/utilities/utilityIcon.js';

import { RecentlyUsedListViewTuning } from '../constants/recentlyUsedViewConstants.js';
import { RecentlyUsedStyles, RecentlyUsedIcons, RecentlyUsedMessages } from '../constants/recentlyUsedConstants.js';

/**
 * Static base factory for creating Recently Used UI widgets.
 * Pure widget creation — no event wiring or state management.
 */
export class RecentlyUsedBaseWidgetFactory {
    // ========================================================================
    // List Item Builders
    // ========================================================================

    /**
     * Create a standard full-width list item widget.
     *
     * @param {object} itemData Data source for the list item
     * @param {object} context Rendering context provided by the manager
     * @returns {St.Button} Configured list item button
     */
    static createFullWidthListItem(itemData, context) {
        const listPresentation = itemData?.__recentlyUsedListPresentation || {};
        const textPresentation = listPresentation?.text || {};
        const isCenteredText = textPresentation.align === 'center';

        let styleClass = RecentlyUsedStyles.LIST_ITEM;

        if (textPresentation.weight === 'bold') {
            styleClass += ' ' + RecentlyUsedStyles.BOLD_ITEM;
        }

        const button = new St.Button({
            style_class: styleClass,
            can_focus: true,
            x_expand: true,
        });

        const box = new St.BoxLayout({
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            x_align: isCenteredText ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.FILL,
        });
        box.spacing = RecentlyUsedListViewTuning.LIST_ITEM_CONTENT_SPACING;
        button.set_child(box);

        if (typeof context.renderListContent === 'function') {
            context.renderListContent({
                button,
                box,
                itemData,
                styleClass,
                runtimeContext: context.runtimeContext,
            });
        }

        if (box.get_n_children() === 0) {
            this._applyDefaultListText(box, itemData, textPresentation, isCenteredText);
        }

        return button;
    }

    /**
     * Build the default text layout for a list entry if no custom renderer is provided.
     *
     * @param {St.BoxLayout} box Parent container layout
     * @param {object} itemData Data source bound to the text
     * @param {object} textPresentation Formatting properties specific to the text
     * @param {boolean} isCenteredText Request centered alignment override
     */
    static _applyDefaultListText(box, itemData, textPresentation, isCenteredText) {
        const label = new St.Label({
            text: itemData.preview || '',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            x_align: isCenteredText ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.FILL,
        });

        const truncateMode = textPresentation.truncate || 'end';
        if (truncateMode === 'none') {
            label.get_clutter_text().set_line_wrap(false);
            label.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.NONE);
        } else {
            label.get_clutter_text().set_line_wrap(false);
            label.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
        }

        box.add_child(label);
    }

    // ========================================================================
    // Grid Item Builders
    // ========================================================================

    /**
     * Create a compact square grid item corresponding to localized presentation logic.
     *
     * @param {object} itemData Bound data driving tooltip and icon contents
     * @param {object} context Fallback resolution maps and options
     * @returns {St.Button} Grid element ready for interaction wiring
     */
    static createGridItem(itemData, context = {}) {
        const gridPresentation = itemData?.__recentlyUsedGridPresentation || {};
        const contentMode = gridPresentation?.contentMode || 'char-or-value-text';
        const tooltipMode = gridPresentation?.tooltipMode || 'name-or-value';

        const button = new St.Button({
            style_class: RecentlyUsedStyles.GRID_ITEM,
            can_focus: true,
        });

        if (contentMode === 'icon') {
            this._applyGridIconPresentation(button, itemData, gridPresentation, tooltipMode, context);
        } else {
            this._applyGridTextPresentation(button, itemData, tooltipMode);
        }

        return button;
    }

    /**
     * Setup a button specifically to render an icon mapping.
     *
     * @param {St.Button} button Container button reference
     * @param {object} itemData Backing grid object
     * @param {object} gridPresentation Display configuration for rendering overrides
     * @param {string} tooltipMode Key identifying tooltip preference formatting
     * @param {object} context Fallback resolution
     */
    static _applyGridIconPresentation(button, itemData, gridPresentation, tooltipMode, context) {
        const iconDefinition = context.resolveGridIcon?.(gridPresentation?.icon?.kind) || gridPresentation?.icon?.definition || null;
        if (!iconDefinition) {
            this._applyGridTextPresentation(button, itemData, 'name-or-value');
            return;
        }

        const icon = createStaticIcon(iconDefinition, { styleClass: RecentlyUsedStyles.GRID_ICON });
        button.set_child(icon);
        button.tooltip_text = this._resolveGridIconTooltip(itemData, tooltipMode);
    }

    /**
     * Determines tooltip verbosity targeting descriptions or explicit names.
     *
     * @param {object} itemData Node properties driving tooltip strings
     * @param {string} tooltipMode Key dictating resolution rules
     * @returns {string} Calculated display text for hover action
     */
    static _resolveGridIconTooltip(itemData, tooltipMode) {
        if (tooltipMode === 'description-or-fallback') {
            return String(itemData.description || itemData.name || itemData.char || itemData.value || '');
        }

        return String(itemData.name || itemData.char || itemData.value || '');
    }

    /**
     * Set a textual character fallback representation directly on a button label.
     *
     * @param {St.Button} button The widget receiving standard property injection
     * @param {object} itemData Character or value fields to present
     * @param {string} tooltipMode Dictates name or raw output logic
     */
    static _applyGridTextPresentation(button, itemData, tooltipMode) {
        const labelText = String(itemData.char || itemData.value || '');
        button.label = labelText;
        button.tooltip_text = tooltipMode === 'name-or-value' ? String(itemData.name || labelText) : labelText;
    }

    // ========================================================================
    // Shared Section Scaffolding
    // ========================================================================

    /**
     * Create the structural heading for a layout block rendering section text and show all buttons.
     *
     * @param {string} title Localized or static section label text
     * @returns {object} Elements encompassing the new visual boundaries
     */
    static createSectionHeader(title) {
        const header = new St.BoxLayout({
            style_class: RecentlyUsedStyles.HEADER,
            x_expand: true,
        });

        const titleLabel = new St.Label({
            text: title,
            style_class: RecentlyUsedStyles.TITLE,
            x_expand: true,
        });

        const showAllBtn = new St.Button({
            label: RecentlyUsedMessages.SHOW_ALL(),
            style_class: RecentlyUsedStyles.SHOW_ALL_BUTTON,
            can_focus: true,
        });

        header.add_child(titleLabel);
        header.add_child(showAllBtn);

        return { header, showAllBtn, titleLabel };
    }

    /**
     * Provide an empty placeholder structural spacer indicating separations.
     *
     * @returns {St.Widget} An un-initialized generic control marking boundaries
     */
    static createSectionSeparator() {
        return new St.Widget({
            style_class: RecentlyUsedStyles.SEPARATOR,
            visible: false,
        });
    }

    /**
     * Create the primary empty layout state displaying generic text hints.
     *
     * @returns {St.Bin} Standard text box for entirely empty module loads
     */
    static createEmptyView() {
        const emptyView = new St.Bin({
            x_expand: true,
            y_expand: true,
            visible: false,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        emptyView.set_child(new St.Label({ text: RecentlyUsedMessages.EMPTY_STATE() }));
        return emptyView;
    }

    /**
     * Provide a standardized button invoking the main plugin preference module.
     *
     * @returns {St.Button} Functional global options navigation button
     */
    static createSettingsButton() {
        const icon = createStaticIcon(RecentlyUsedIcons.SETTINGS);

        return new St.Button({
            style_class: RecentlyUsedStyles.SETTINGS_BUTTON,
            child: icon,
            can_focus: false,
            reactive: true,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.END,
        });
    }
}
