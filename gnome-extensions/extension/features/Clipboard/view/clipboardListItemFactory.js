import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { createStaticIcon } from '../../../shared/utilities/utilityIcon.js';

import { ClipboardBaseItemConfig } from './clipboardBaseItemConfig.js';
import { handleClipboardItemKeyPress } from '../utilities/clipboardKeyboardShortcuts.js';
import { ClipboardType, IconSizes } from '../constants/clipboardConstants.js';
import { ClipboardBaseWidgetFactory } from './clipboardBaseWidgetFactory.js';

/**
 * ClipboardListItemFactory
 * Factory for creating list view clipboard items.
 * Creates horizontal row widgets optimized for the list layout.
 */
export class ClipboardListItemFactory {
    /**
     * Get item view configuration.
     * @param {Object} item The raw item data
     * @param {string} imagesDir Directory where images are stored
     * @param {string} linkPreviewsDir Directory where link previews are stored
     * @returns {Object} The view configuration
     */
    static getItemViewConfig(item, imagesDir, linkPreviewsDir) {
        return ClipboardBaseItemConfig.getItemViewConfig(item, imagesDir, linkPreviewsDir);
    }

    /**
     * Create a complete list item row with content and action buttons.
     *
     * @param {Object} itemData The item data with _isPinned flag
     * @param {Object} options Options for rendering
     * @param {string} options.imagesDir Directory where images are stored
     * @param {string} options.linkPreviewsDir Directory where link previews are stored
     * @param {number} options.imagePreviewSize Size for image preview
     * @param {Function} options.onItemCopy Callback when row is clicked
     * @param {Object} options.manager ClipboardManager for pin/delete actions
     * @param {Set} options.selectedIds Set of selected item IDs
     * @param {Function} options.onSelectionChanged Callback when selection changes
     * @param {Map} options.checkboxIconsMap Map to register checkbox icons
     * @param {Object} options.settings Extension settings
     * @returns {St.Widget} The complete row widget
     */
    static createItem(itemData, options) {
        const isPinned = options.isPinned !== undefined ? options.isPinned : itemData._isPinned;

        const itemWidget = new St.Button({
            style_class: 'button clipboard-list-item',
            can_focus: true,
        });
        itemWidget.connect('clicked', () => options.onItemCopy(itemData));

        const mainBox = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'clipboard-row-content',
        });
        itemWidget.set_child(mainBox);

        const itemCheckbox = ClipboardBaseWidgetFactory.createCheckbox(
            itemData,
            {
                selectedIds: options.selectedIds,
                checkboxIconsMap: options.checkboxIconsMap,
                onSelectionChanged: options.onSelectionChanged,
            },
            {
                style_class: 'button clipboard-list-checkbox',
                y_expand: false,
                y_align: Clutter.ActorAlign.CENTER,
            },
        );
        mainBox.add_child(itemCheckbox);
        const checkboxIcon = itemCheckbox.child;

        const config = ClipboardListItemFactory.getItemViewConfig(itemData, options.imagesDir, options.linkPreviewsDir);
        const contentWidget = ClipboardListItemFactory.createListContent(config, itemData, {
            imagesDir: options.imagesDir,
            imagePreviewSize: options.imagePreviewSize,
        });
        mainBox.add_child(contentWidget);

        if (itemData.type === ClipboardType.IMAGE) {
            itemWidget.set_style(`min-height: ${options.imagePreviewSize}px;`);
        }

        const pinButton = ClipboardBaseWidgetFactory.createPinButton(
            itemData,
            isPinned,
            { manager: options.manager },
            {
                style_class: 'button clipboard-list-control-button',
                y_align: Clutter.ActorAlign.CENTER,
            },
        );

        const deleteButton = ClipboardBaseWidgetFactory.createDeleteButton(
            itemData,
            { manager: options.manager },
            {
                style_class: 'button clipboard-list-control-button',
                y_align: Clutter.ActorAlign.CENTER,
            },
        );

        const buttonsBox = new St.BoxLayout({
            x_align: Clutter.ActorAlign.END,
            style_class: 'clipboard-list-controls',
        });
        buttonsBox.add_child(pinButton);
        buttonsBox.add_child(deleteButton);
        mainBox.add_child(buttonsBox);

        const updateFocusState = () => {
            if (itemWidget.has_key_focus() || itemCheckbox.has_key_focus() || pinButton.has_key_focus() || deleteButton.has_key_focus()) {
                itemWidget.add_style_pseudo_class('focused');
            } else {
                itemWidget.remove_style_pseudo_class('focused');
            }
        };

        itemWidget.connect('key-focus-in', updateFocusState);
        itemWidget.connect('key-focus-out', updateFocusState);
        itemCheckbox.connect('key-focus-in', updateFocusState);
        itemCheckbox.connect('key-focus-out', updateFocusState);
        pinButton.connect('key-focus-in', updateFocusState);
        pinButton.connect('key-focus-out', updateFocusState);
        deleteButton.connect('key-focus-in', updateFocusState);
        deleteButton.connect('key-focus-out', updateFocusState);

        itemWidget.connect('key-press-event', (actor, event) => {
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

        itemWidget._itemCheckbox = itemCheckbox;
        itemWidget._pinButton = pinButton;
        itemWidget._deleteButton = deleteButton;
        itemWidget._itemId = itemData.id;
        itemWidget._contentWidget = contentWidget;
        itemWidget._mainBox = mainBox;

        return itemWidget;
    }

    /**
     * Update an existing item widget with new data.
     * @param {St.Widget} itemWidget The existing widget
     * @param {Object} newItemData The new item data
     * @param {Object} options Options for rendering
     */
    static updateItem(itemWidget, newItemData, options) {
        if (!itemWidget || !newItemData) return;

        itemWidget._itemId = newItemData.id;

        const config = ClipboardListItemFactory.getItemViewConfig(newItemData, options.imagesDir, options.linkPreviewsDir);
        const newContentWidget = ClipboardListItemFactory.createListContent(config, newItemData, {
            imagesDir: options.imagesDir,
            imagePreviewSize: options.imagePreviewSize,
        });

        const mainBox = itemWidget._mainBox || itemWidget.get_child();
        const oldContentWidget = itemWidget._contentWidget;

        if (mainBox && oldContentWidget) {
            mainBox.replace_child(oldContentWidget, newContentWidget);
            itemWidget._contentWidget = newContentWidget;
            oldContentWidget.destroy();
        }
    }

    /**
     * Create a content widget for a list item based on its configuration.
     *
     * @param {Object} config The view configuration from getItemViewConfig
     * @param {Object} itemData The raw item data
     * @param {Object} options Display options
     * @param {string} options.imagesDir Directory where images are stored
     * @param {number} options.imagePreviewSize Size of image preview
     * @returns {St.Widget} The content widget
     */
    static createListContent(config, itemData, options) {
        let contentWidget;

        if (config.layoutMode === 'image') {
            const imagePath = GLib.build_filenamev([options.imagesDir, itemData.image_filename]);

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
            contentWidget = new St.BoxLayout({
                vertical: false,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'clipboard-list-rich-container',
            });

            let icon;
            if (config.gicon) {
                icon = new St.Icon({
                    icon_size: IconSizes.LIST_RICH_ICON,
                    style_class: 'clipboard-list-rich-icon',
                    gicon: config.gicon,
                });
            } else if (config.flagPath) {
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
            contentWidget = new St.BoxLayout({
                vertical: false,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'clipboard-list-rich-container',
            });

            let icon;
            if (config.gicon) {
                icon = new St.Icon({
                    icon_size: IconSizes.LIST_RICH_ICON,
                    style_class: 'clipboard-list-rich-icon',
                    gicon: config.gicon,
                });
            } else if (config.flagPath) {
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

            const swatchContainer = new St.Bin({
                style_class: 'clipboard-list-color-container',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });

            let swatch;
            if (itemData.gradient_filename && options.imagesDir) {
                const gradientPath = GLib.build_filenamev([options.imagesDir, itemData.gradient_filename]);

                swatch = new St.Bin({
                    style_class: 'clipboard-list-color-swatch',
                    style: `background-image: url('file://${gradientPath}'); background-size: cover;`,
                });
            } else {
                swatch = new St.Bin({
                    style_class: 'clipboard-list-color-swatch',
                    style: `background-color: ${config.cssColor || '#000000'};`,
                });
            }

            swatchContainer.set_child(swatch);
            contentWidget.add_child(swatchContainer);

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
            contentWidget = new St.BoxLayout({
                vertical: false,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'clipboard-list-code-container',
            });

            const icon = createStaticIcon(config, { styleClass: 'clipboard-list-rich-icon' });
            contentWidget.add_child(icon);

            const codeBox = new St.BoxLayout({ vertical: false, x_expand: true });

            const lineCount = config.rawLines || 0;
            const lineNumbersString = Array.from({ length: lineCount }, (_unused, i) => (i + 1).toString()).join('\n');

            const numLabel = new St.Label({
                text: lineNumbersString,
                style_class: 'clipboard-list-code-numbers',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            codeBox.add_child(numLabel);

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
