import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { createStaticIcon } from '../../../shared/utilities/utilityIcon.js';

import { ClipboardBaseItemConfig } from './clipboardBaseItemConfig.js';
import { ClipboardBaseWidgetFactory } from './clipboardBaseWidgetFactory.js';
import { handleClipboardItemKeyPress } from '../utilities/clipboardKeyboardShortcuts.js';
import { ClipboardType, IconSizes } from '../constants/clipboardConstants.js';

/**
 * ClipboardGridItemFactory
 * Factory for creating grid view clipboard items.
 * Creates vertical card widgets optimized for the masonry grid layout.
 */
export class ClipboardGridItemFactory {
    /**
     * Get item view configuration.
     *
     * @param {Object} item - The raw item data
     * @param {string} imagesDir - Directory where images are stored
     * @param {string} linkPreviewsDir - Directory where link previews are stored
     * @returns {Object} The view configuration
     */
    static getItemViewConfig(item, imagesDir, linkPreviewsDir) {
        return ClipboardBaseItemConfig.getItemViewConfig(item, imagesDir, linkPreviewsDir);
    }

    /**
     * Create a complete grid item (card) with content and overlayed action buttons.
     *
     * @param {Object} itemData The item data with _isPinned flag
     * @param {Object} options Options for rendering
     * @param {string} options.imagesDir Directory where images are stored
     * @param {string} options.linkPreviewsDir Directory where link previews are stored
     * @param {number} options.imagePreviewSize Size for image preview
     * @param {Function} options.onItemCopy Callback when card is clicked
     * @param {Object} options.manager ClipboardManager for pin/delete actions
     * @param {Set} options.selectedIds Set of selected item IDs
     * @param {Function} options.onSelectionChanged Callback when selection changes
     * @param {Map} options.checkboxIconsMap Map to register checkbox icons
     * @returns {St.Widget} The complete card widget
     */
    static createItem(itemData, options) {
        const isPinned = options.isPinned !== undefined ? options.isPinned : itemData._isPinned;

        const itemWidget = new St.Button({
            style_class: 'clipboard-grid-card button',
            can_focus: true,
        });
        itemWidget.connect('clicked', () => options.onItemCopy(itemData));

        const cardStack = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
        });
        itemWidget.set_child(cardStack);

        const contentWrapper = new St.Bin({
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
        });

        const config = ClipboardGridItemFactory.getItemViewConfig(itemData, options.imagesDir, options.linkPreviewsDir);

        const isFullBleed = ['color', 'image'].includes(config.layoutMode);
        if (!isFullBleed) {
            contentWrapper.add_style_class_name('clipboard-grid-card-content');
        }

        const contentWidget = ClipboardGridItemFactory.createGridContent(config, itemData, {
            imagesDir: options.imagesDir,
            imagePreviewSize: options.imagePreviewSize,
        });
        contentWrapper.set_child(contentWidget);
        cardStack.add_child(contentWrapper);

        if (config.icon) {
            const typeBadge = new St.BoxLayout({
                style_class: 'clipboard-grid-type-badge',
                x_expand: true,
                y_expand: true,
                x_align: Clutter.ActorAlign.FILL,
                y_align: Clutter.ActorAlign.START,
            });
            const typeIcon = createStaticIcon({ ...config, iconSize: IconSizes.BADGE_TYPE_ICON }, { styleClass: 'clipboard-grid-type-icon' });
            typeBadge.add_child(typeIcon);

            if (config.layoutMode === 'code' && config.rawLines > 0) {
                const spacer = new St.Widget({ x_expand: true });
                typeBadge.add_child(spacer);

                const lineCountLabel = new St.Label({
                    text: `${config.rawLines} lines`,
                    style_class: 'clipboard-grid-code-line-count',
                });
                typeBadge.add_child(lineCountLabel);
            }

            cardStack.add_child(typeBadge);
        }

        const actionsOverlay = new St.BoxLayout({
            style_class: 'clipboard-grid-controls',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.END,
        });

        // Checkbox using Shared Factory
        const itemCheckbox = ClipboardBaseWidgetFactory.createCheckbox(
            itemData,
            {
                selectedIds: options.selectedIds,
                checkboxIconsMap: options.checkboxIconsMap,
                onSelectionChanged: options.onSelectionChanged,
            },
            {
                style_class: 'button clipboard-grid-checkbox',
                can_focus: false, // Uses the keyboard schema hotkey
            },
        );
        actionsOverlay.add_child(itemCheckbox);
        const checkboxIcon = itemCheckbox.child;

        const spacer = new St.Widget({ x_expand: true });
        actionsOverlay.add_child(spacer);

        const pinButton = ClipboardBaseWidgetFactory.createPinButton(
            itemData,
            isPinned,
            { manager: options.manager },
            {
                style_class: 'button clipboard-grid-control-button',
                can_focus: false,
            },
        );

        const deleteButton = ClipboardBaseWidgetFactory.createDeleteButton(
            itemData,
            { manager: options.manager },
            {
                style_class: 'button clipboard-grid-control-button',
                can_focus: false,
            },
        );

        actionsOverlay.add_child(pinButton);
        actionsOverlay.add_child(deleteButton);
        cardStack.add_child(actionsOverlay);

        actionsOverlay.opacity = 0;
        itemWidget.connect('enter-event', () => {
            actionsOverlay.opacity = 255;
        });
        itemWidget.connect('leave-event', () => {
            actionsOverlay.opacity = 0;
        });
        itemWidget.connect('key-focus-in', () => {
            actionsOverlay.opacity = 255;
        });
        itemWidget.connect('key-focus-out', () => {
            actionsOverlay.opacity = 0;
        });

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

        return itemWidget;
    }

    /**
     * Create content widget for a grid item.
     *
     * @param {Object} config The view configuration from getItemViewConfig
     * @param {Object} itemData The raw item data
     * @param {Object} options Display options
     * @param {string} options.imagesDir Directory where images are stored
     * @param {number} options.imagePreviewSize Size of image preview
     * @returns {St.Widget} The content widget
     */
    static createGridContent(config, itemData, options) {
        let contentWidget;

        if (config.layoutMode === 'image') {
            const imagePath = GLib.build_filenamev([options.imagesDir, itemData.image_filename]);

            const imageWrapper = new St.BoxLayout({
                style_class: 'clipboard-grid-image-content',
                x_expand: true,
                y_expand: true,
            });

            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (imageWrapper.get_stage()) {
                    imageWrapper.set_style(`background-image: url('file://${imagePath}'); background-size: cover;`);
                }
                return GLib.SOURCE_REMOVE;
            });

            contentWidget = imageWrapper;
        } else if (config.layoutMode === 'rich') {
            contentWidget = new St.BoxLayout({
                vertical: true,
                style_class: 'clipboard-grid-rich-container',
                x_expand: true,
                y_expand: true,
            });

            const hasIcon = [ClipboardType.URL, ClipboardType.CONTACT].includes(itemData.type);

            if (hasIcon) {
                const visualWrapper = new St.Bin({
                    x_expand: true,
                    y_expand: true,
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                });

                let icon;
                if (config.gicon) {
                    icon = new St.Icon({
                        icon_size: IconSizes.GRID_RICH_ICON,
                        gicon: config.gicon,
                    });
                } else if (config.flagPath) {
                    const file = Gio.File.new_for_uri(config.flagPath);
                    icon = new St.Icon({
                        icon_size: IconSizes.GRID_RICH_ICON,
                        gicon: new Gio.FileIcon({ file: file }),
                    });
                } else {
                    icon = createStaticIcon(config, {
                        iconSize: IconSizes.GRID_RICH_ICON,
                    });
                }
                visualWrapper.set_child(icon);

                contentWidget.add_child(visualWrapper);
            } else {
                const spacer = new St.Widget({
                    y_expand: true,
                });
                contentWidget.add_child(spacer);
            }

            const labelsContainer = new St.BoxLayout({
                vertical: true,
                style_class: 'clipboard-grid-rich-labels',
                x_expand: true,
                y_expand: true,
            });

            const titleLabel = new St.Label({
                text: config.title || '',
                style_class: 'clipboard-grid-title',
                x_expand: true,
            });
            titleLabel.get_clutter_text().set_line_wrap(false);
            titleLabel.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
            labelsContainer.add_child(titleLabel);

            const subLabel = new St.Label({
                text: config.subtitle || '',
                style_class: 'clipboard-grid-subtitle',
                x_expand: true,
            });
            subLabel.get_clutter_text().set_line_wrap(false);
            subLabel.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.MIDDLE);
            labelsContainer.add_child(subLabel);

            contentWidget.add_child(labelsContainer);
        } else if (config.layoutMode === 'color') {
            contentWidget = new St.BoxLayout({
                vertical: true,
                style_class: 'clipboard-grid-color-container',
                x_expand: true,
                y_expand: true,
            });

            let colorStyle = '';
            if (itemData.gradient_filename && options.imagesDir) {
                const gradientPath = GLib.build_filenamev([options.imagesDir, itemData.gradient_filename]);
                colorStyle = `background-image: url('file://${gradientPath}'); background-size: contain; background-repeat: repeat;`;
            } else if (config.cssColor) {
                colorStyle = `background-color: ${config.cssColor};`;
            }
            contentWidget.set_style(colorStyle);

            const spacer = new St.Widget({ y_expand: true });
            contentWidget.add_child(spacer);

            const labelOverlay = new St.BoxLayout({
                vertical: true,
                style_class: 'clipboard-grid-color-card',
                x_expand: true,
                y_expand: true,
            });

            const colorLabel = new St.Label({
                text: config.title || '',
                style_class: 'clipboard-grid-color-label',
                x_expand: true,
                y_expand: true,
            });
            colorLabel.get_clutter_text().set_line_wrap(false);
            colorLabel.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
            labelOverlay.add_child(colorLabel);

            contentWidget.add_child(labelOverlay);
        } else if (config.layoutMode === 'code') {
            const safeText = config.text || '';
            contentWidget = new St.Label({
                text: safeText,
                style_class: 'clipboard-grid-code-content',
                x_expand: true,
            });
            contentWidget.get_clutter_text().set_use_markup(true);
            contentWidget.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
            contentWidget.get_clutter_text().set_line_wrap(true);
            contentWidget.get_clutter_text().set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
        } else {
            const safeText = config.text || '';
            contentWidget = new St.Label({
                text: safeText,
                style_class: 'clipboard-grid-text-label',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            contentWidget.get_clutter_text().set_line_wrap(true);
            contentWidget.get_clutter_text().set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
            contentWidget.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
        }

        return contentWidget;
    }
}
