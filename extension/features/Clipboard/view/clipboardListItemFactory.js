import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { createStaticIcon, createStaticIconButton, createDynamicIconButton } from '../../../shared/utilities/utilityIcon.js';

import { ClipboardItemConfig } from './clipboardItemConfig.js';
import { handleClipboardItemKeyPress } from '../utilities/clipboardKeyboardShortcuts.js';
import { ClipboardIcons, IconSizes } from '../constants/clipboardConstants.js';

/**
 * Factory for creating list view clipboard items.
 * Creates horizontal row widgets optimized for the list layout.
 */
export class ClipboardListItemFactory {
    /**
     * Get item view configuration.
     * Delegates to shared ClipboardItemConfig.
     *
     * @param {Object} item - The raw item data
     * @param {string} imagesDir - Directory where images are stored
     * @param {string} linkPreviewsDir - Directory where link previews are stored
     * @returns {Object} The view configuration
     */
    static getItemViewConfig(item, imagesDir, linkPreviewsDir) {
        return ClipboardItemConfig.getItemViewConfig(item, imagesDir, linkPreviewsDir);
    }

    /**
     * Create a complete list item (row) with content and action buttons.
     *
     * @param {Object} itemData - The item data with _isPinned flag
     * @param {Object} options - Options for rendering
     * @param {string} options.imagesDir - Directory where images are stored
     * @param {string} options.linkPreviewsDir - Directory where link previews are stored
     * @param {number} options.imagePreviewSize - Size for image preview
     * @param {Function} options.onItemCopy - Callback when row is clicked
     * @param {Object} options.manager - ClipboardManager for pin/delete actions
     * @param {Set} options.selectedIds - Set of selected item IDs
     * @param {Function} options.onSelectionChanged - Callback when selection changes
     * @param {Map} options.checkboxIconsMap - Map to register checkbox icons
     * @param {Object} options.settings - Extension settings
     * @returns {St.Widget} The complete row widget
     */
    static createListItem(itemData, options) {
        const isPinned = options.isPinned !== undefined ? options.isPinned : itemData._isPinned;

        // Row button container
        const rowButton = new St.Button({
            style_class: 'button clipboard-list-item',
            can_focus: true,
        });
        rowButton.connect('clicked', () => options.onItemCopy(itemData));

        const mainBox = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'clipboard-row-content',
        });
        rowButton.set_child(mainBox);

        // Checkbox for selection
        const isChecked = options.selectedIds?.has(itemData.id) || false;
        const itemCheckbox = createDynamicIconButton(
            {
                unchecked: ClipboardIcons.CHECKBOX_UNCHECKED,
                checked: ClipboardIcons.CHECKBOX_CHECKED,
            },
            {
                initial: isChecked ? 'checked' : 'unchecked',
                style_class: 'button clipboard-list-checkbox',
                y_expand: false,
                y_align: Clutter.ActorAlign.CENTER,
            },
        );
        const checkboxIcon = itemCheckbox.child;
        if (options.checkboxIconsMap) {
            options.checkboxIconsMap.set(itemData.id, checkboxIcon);
        }

        itemCheckbox.connect('clicked', () => {
            if (rowButton.has_key_focus()) rowButton.remove_style_pseudo_class('focus');
            if (options.selectedIds.has(itemData.id)) {
                options.selectedIds.delete(itemData.id);
                checkboxIcon.state = 'unchecked';
            } else {
                options.selectedIds.add(itemData.id);
                checkboxIcon.state = 'checked';
            }
            options.onSelectionChanged?.();
        });
        mainBox.add_child(itemCheckbox);

        // Content widget based on item type
        const config = ClipboardListItemFactory.getItemViewConfig(itemData, options.imagesDir, options.linkPreviewsDir);
        const contentWidget = ClipboardListItemFactory.createListContent(config, itemData, {
            imagesDir: options.imagesDir,
            imagePreviewSize: options.imagePreviewSize,
        });
        mainBox.add_child(contentWidget);

        // Pin/Star button
        const rowStarButton = createStaticIconButton(isPinned ? ClipboardIcons.STAR_FILLED : ClipboardIcons.STAR_UNFILLED, {
            style_class: 'button clipboard-list-control-button',
            y_align: Clutter.ActorAlign.CENTER,
        });
        rowStarButton.connect('clicked', () => {
            if (isPinned) {
                options.manager.unpinItem(itemData.id);
            } else {
                options.manager.pinItem(itemData.id);
            }
        });

        // Delete button
        const deleteButton = createStaticIconButton(ClipboardIcons.DELETE, {
            style_class: 'button clipboard-list-control-button',
            y_align: Clutter.ActorAlign.CENTER,
        });
        deleteButton.connect('clicked', () => options.manager.deleteItem(itemData.id));

        const buttonsBox = new St.BoxLayout({
            x_align: Clutter.ActorAlign.END,
            style_class: 'clipboard-list-controls',
        });
        buttonsBox.add_child(rowStarButton);
        buttonsBox.add_child(deleteButton);
        mainBox.add_child(buttonsBox);

        // Store focusable items on the row for ListView to collect
        rowButton._focusableItems = [itemCheckbox, rowButton, rowStarButton, deleteButton];
        rowButton._checkboxIcon = checkboxIcon;
        rowButton._isPinned = isPinned;

        // Keyboard shortcuts for actions
        rowButton.connect('key-press-event', (actor, event) => {
            return handleClipboardItemKeyPress(event, {
                settings: options.settings,
                itemId: itemData.id,
                isPinned,
                selectedIds: options.selectedIds,
                checkboxIcon,
                manager: options.manager,
                onSelectionChanged: options.onSelectionChanged,
            });
        });

        return rowButton;
    }

    /**
     * Create a content widget for a list item based on its configuration.
     * Optimized for horizontal list layout.
     *
     * @param {Object} config - The view configuration from getItemViewConfig
     * @param {Object} itemData - The raw item data
     * @param {Object} options - Display options
     * @param {string} options.imagesDir - Directory where images are stored
     * @param {number} options.imagePreviewSize - Size of image preview
     * @returns {St.Widget} The content widget
     */
    static createListContent(config, itemData, options) {
        let contentWidget;

        if (config.layoutMode === 'image') {
            // Image Layout
            const imagePath = GLib.build_filenamev([options.imagesDir, itemData.image_filename]);

            // Use wrapper bin for proper sizing
            const imageWrapper = new St.Bin({
                style_class: 'clipboard-list-image-content',
                x_expand: true,
                y_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });

            const imageActor = new St.Icon({
                gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(imagePath) }),
                icon_size: options.imagePreviewSize,
            });

            imageWrapper.set_style(`min-height: ${options.imagePreviewSize}px;`);
            imageWrapper.set_child(imageActor);

            contentWidget = imageWrapper;
        } else if (config.layoutMode === 'rich') {
            // Rich Layout for File, Link, and Contact
            contentWidget = new St.BoxLayout({
                vertical: false,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'clipboard-list-rich-container',
            });

            // Create icon
            let icon;
            if (config.gicon) {
                icon = new St.Icon({
                    icon_size: IconSizes.LIST_RICH_ICON,
                    style_class: 'clipboard-list-rich-icon',
                    gicon: config.gicon,
                });
            } else if (config.flagPath) {
                // Use SVG flag from GResource
                const file = Gio.File.new_for_uri(config.flagPath);
                icon = new St.Icon({
                    icon_size: IconSizes.LIST_RICH_ICON,
                    style_class: 'clipboard-list-rich-icon',
                    gicon: new Gio.FileIcon({ file: file }),
                });
            } else {
                icon = createStaticIcon(config, { styleClass: 'clipboard-list-rich-icon' });
            }
            contentWidget.add_child(icon);

            const textCol = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            const titleLabel = new St.Label({
                text: config.title || '',
                style_class: 'clipboard-list-title',
                x_expand: true,
            });
            titleLabel.get_clutter_text().set_line_wrap(false);
            titleLabel.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
            textCol.add_child(titleLabel);
            const subLabel = new St.Label({
                text: config.subtitle || '',
                style_class: 'clipboard-list-subtitle',
                x_expand: true,
            });
            subLabel.get_clutter_text().set_line_wrap(false);
            subLabel.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.MIDDLE);
            textCol.add_child(subLabel);

            contentWidget.add_child(textCol);
            contentWidget.x_expand = true;
        } else if (config.layoutMode === 'color') {
            // Color Layout
            contentWidget = new St.BoxLayout({
                vertical: false,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'clipboard-list-rich-container',
            });

            // Create icon
            let icon;
            if (config.gicon) {
                icon = new St.Icon({
                    icon_size: IconSizes.LIST_RICH_ICON,
                    style_class: 'clipboard-list-rich-icon',
                    gicon: config.gicon,
                });
            } else if (config.flagPath) {
                // Use SVG flag from GResource
                const file = Gio.File.new_for_uri(config.flagPath);
                icon = new St.Icon({
                    icon_size: IconSizes.LIST_RICH_ICON,
                    style_class: 'clipboard-list-rich-icon',
                    gicon: new Gio.FileIcon({ file: file }),
                });
            } else {
                icon = createStaticIcon(config, { styleClass: 'clipboard-list-rich-icon' });
            }
            contentWidget.add_child(icon);

            // Color swatch for single colors or gradient images
            const swatchContainer = new St.Bin({
                style_class: 'clipboard-list-color-container',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });

            let swatch;
            if (itemData.gradient_filename && options.imagesDir) {
                // Load gradient image
                const gradientPath = GLib.build_filenamev([options.imagesDir, itemData.gradient_filename]);

                // Use St.Bin with background-image
                swatch = new St.Bin({
                    style_class: 'clipboard-list-color-swatch',
                    style: `background-image: url('file://${gradientPath}'); background-size: cover;`,
                });
            } else {
                // CSS solid color
                swatch = new St.Bin({
                    style_class: 'clipboard-list-color-swatch',
                    style: `background-color: ${config.cssColor || '#000000'};`,
                });
            }

            swatchContainer.set_child(swatch);
            contentWidget.add_child(swatchContainer);

            // Text column
            const textCol = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            const titleLabel = new St.Label({
                text: config.title || '',
                style_class: 'clipboard-list-title',
                x_expand: true,
            });
            titleLabel.get_clutter_text().set_line_wrap(false);
            titleLabel.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
            textCol.add_child(titleLabel);
            const subLabel = new St.Label({
                text: config.subtitle || '',
                style_class: 'clipboard-list-subtitle',
                x_expand: true,
            });
            subLabel.get_clutter_text().set_line_wrap(false);
            subLabel.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.MIDDLE);
            textCol.add_child(subLabel);

            contentWidget.add_child(textCol);
            contentWidget.x_expand = true;
        } else if (config.layoutMode === 'code') {
            // Code Layout
            contentWidget = new St.BoxLayout({
                vertical: false,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'clipboard-list-code-container',
            });

            // Icon
            const icon = createStaticIcon(config, { styleClass: 'clipboard-list-rich-icon' });
            contentWidget.add_child(icon);

            // Code Body
            const codeBox = new St.BoxLayout({ vertical: false, x_expand: true });

            // Generate Line Numbers String dynamically
            const lineCount = config.rawLines || 0;
            const lineNumbersString = Array.from({ length: lineCount }, (_unused, i) => (i + 1).toString()).join('\n');

            const numLabel = new St.Label({
                text: lineNumbersString,
                style_class: 'clipboard-list-code-numbers',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            codeBox.add_child(numLabel);

            // Safety check for text
            const safeText = config.text || '';
            const codeLabel = new St.Label({
                text: safeText,
                style_class: 'clipboard-list-code-content',
                x_expand: true,
                x_align: Clutter.ActorAlign.START,
                y_align: Clutter.ActorAlign.CENTER,
            });
            codeLabel.get_clutter_text().set_use_markup(true);
            codeLabel.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);

            codeBox.add_child(codeLabel);
            contentWidget.add_child(codeBox);

            contentWidget.x_expand = true;
        } else {
            // Text Layout
            const safeText = config.text || '';
            contentWidget = new St.Label({
                text: safeText,
                style_class: 'clipboard-list-text-label',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            contentWidget.get_clutter_text().set_line_wrap(false);
            contentWidget.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
        }

        return contentWidget;
    }
}

// Keep backward compatibility alias
export const ClipboardItemFactory = ClipboardListItemFactory;
