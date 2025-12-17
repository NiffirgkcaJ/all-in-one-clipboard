import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { createStaticIcon, createStaticIconButton, createDynamicIconButton } from '../../../shared/utilities/utilityIcon.js';

import { ClipboardItemConfig } from './clipboardItemConfig.js';
import { handleClipboardItemKeyPress } from '../utilities/clipboardKeyboardShortcuts.js';
import { ClipboardIcons, ClipboardType, IconSizes } from '../constants/clipboardConstants.js';

/**
 * Factory for creating grid view clipboard items.
 * Creates vertical card widgets optimized for the masonry grid layout.
 */
export class ClipboardGridItemFactory {
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
     * Create a complete grid item (card) with content and overlayed action buttons.
     *
     * @param {Object} itemData - The item data with _isPinned flag
     * @param {Object} options - Options for rendering
     * @param {string} options.imagesDir - Directory where images are stored
     * @param {string} options.linkPreviewsDir - Directory where link previews are stored
     * @param {number} options.imagePreviewSize - Size for image preview
     * @param {Function} options.onItemCopy - Callback when card is clicked
     * @param {Object} options.manager - ClipboardManager for pin/delete actions
     * @param {Set} options.selectedIds - Set of selected item IDs
     * @param {Function} options.onSelectionChanged - Callback when selection changes
     * @param {Map} options.checkboxIconsMap - Map to register checkbox icons
     * @returns {St.Widget} The complete card widget
     */
    static createGridItem(itemData, options) {
        const isPinned = options.isPinned !== undefined ? options.isPinned : itemData._isPinned;

        // Card container
        const card = new St.Button({
            style_class: 'clipboard-grid-card button',
            can_focus: true,
        });
        card.connect('clicked', () => options.onItemCopy(itemData));

        // Stack container - NO padding, allows overlay to go edge-to-edge
        const cardStack = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
        });
        card.set_child(cardStack);

        // Content wrapper with conditional padding based on layout
        const contentWrapper = new St.Bin({
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
        });

        const config = ClipboardGridItemFactory.getItemViewConfig(itemData, options.imagesDir, options.linkPreviewsDir);

        // Full-bleed layouts like color and image skip padding for edge-to-edge fill
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

        // Type icon badge spanning full width at top with gradient
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

            // Add line count for code items
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

        // Gradient overlay - NO padding, spans edge-to-edge at bottom
        const actionsOverlay = new St.BoxLayout({
            style_class: 'clipboard-grid-controls',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.END,
        });

        // Checkbox for selection on left side
        const isChecked = options.selectedIds?.has(itemData.id) || false;
        const itemCheckbox = createDynamicIconButton(
            {
                unchecked: ClipboardIcons.CHECKBOX_UNCHECKED,
                checked: ClipboardIcons.CHECKBOX_CHECKED,
            },
            {
                initial: isChecked ? 'checked' : 'unchecked',
                style_class: 'button clipboard-grid-checkbox',
                can_focus: false, // Uses the keyboard schema hotkey
            },
        );
        const checkboxIcon = itemCheckbox.child;
        if (options.checkboxIconsMap) {
            options.checkboxIconsMap.set(itemData.id, checkboxIcon);
        }

        itemCheckbox.connect('clicked', () => {
            if (options.selectedIds.has(itemData.id)) {
                options.selectedIds.delete(itemData.id);
                checkboxIcon.state = 'unchecked';
            } else {
                options.selectedIds.add(itemData.id);
                checkboxIcon.state = 'checked';
            }
            options.onSelectionChanged?.();
        });
        actionsOverlay.add_child(itemCheckbox);

        // Spacer to push action buttons to the right
        const spacer = new St.Widget({ x_expand: true });
        actionsOverlay.add_child(spacer);

        // Pin/Unpin button
        const pinButton = createStaticIconButton(isPinned ? ClipboardIcons.STAR_FILLED : ClipboardIcons.STAR_UNFILLED, {
            style_class: 'button clipboard-grid-control-button',
            can_focus: false, // Uses the keyboard schema hotkey
        });
        pinButton.connect('clicked', () => {
            if (isPinned) {
                options.manager.unpinItem(itemData.id);
            } else {
                options.manager.pinItem(itemData.id);
            }
        });

        // Delete button
        const deleteButton = createStaticIconButton(ClipboardIcons.DELETE, {
            style_class: 'button clipboard-grid-control-button',
            can_focus: false, // Uses the keyboard schema hotkey
        });
        deleteButton.connect('clicked', () => {
            options.manager.deleteItem(itemData.id);
        });

        actionsOverlay.add_child(pinButton);
        actionsOverlay.add_child(deleteButton);
        cardStack.add_child(actionsOverlay);

        // Hide actions by default, show on hover or keyboard focus
        actionsOverlay.opacity = 0;
        card.connect('enter-event', () => {
            actionsOverlay.opacity = 255;
        });
        card.connect('leave-event', () => {
            actionsOverlay.opacity = 0;
        });
        card.connect('key-focus-in', () => {
            actionsOverlay.opacity = 255;
        });
        card.connect('key-focus-out', () => {
            actionsOverlay.opacity = 0;
        });

        // Keyboard shortcuts for actions via shared utility
        card.connect('key-press-event', (actor, event) => {
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

        return card;
    }

    /**
     * Create content widget for a grid item.
     * Optimized for vertical card layout with larger text.
     *
     * @param {Object} config - The view configuration from getItemViewConfig
     * @param {Object} itemData - The raw item data
     * @param {Object} options - Display options
     * @param {string} options.imagesDir - Directory where images are stored
     * @param {number} options.imagePreviewSize - Size of image preview
     * @returns {St.Widget} The content widget
     */
    static createGridContent(config, itemData, options) {
        let contentWidget;

        if (config.layoutMode === 'image') {
            // Image Layout with deferred background-image loading
            const imagePath = GLib.build_filenamev([options.imagesDir, itemData.image_filename]);

            const imageWrapper = new St.BoxLayout({
                style_class: 'clipboard-grid-image-content',
                x_expand: true,
                y_expand: true,
            });

            // Defer setting background-image to idle to prevent blocking main thread
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (imageWrapper.get_stage()) {
                    imageWrapper.set_style(`background-image: url('file://${imagePath}'); background-size: cover;`);
                }
                return GLib.SOURCE_REMOVE;
            });

            contentWidget = imageWrapper;
        } else if (config.layoutMode === 'rich') {
            // Rich Layout with centered visual and labels below
            contentWidget = new St.BoxLayout({
                vertical: true,
                style_class: 'clipboard-grid-rich-container',
                x_expand: true,
                y_expand: true,
            });

            // Centered visual area for icons like URL and CONTACT
            const hasIcon = [ClipboardType.URL, ClipboardType.CONTACT].includes(itemData.type);

            if (hasIcon) {
                // Visual container taking up main space
                const visualWrapper = new St.Bin({
                    x_expand: true,
                    y_expand: true,
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                });

                // Icon for URL/CONTACT
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
                // No icon so insert spacer for consistent bottom alignment
                const spacer = new St.Widget({
                    y_expand: true,
                });
                contentWidget.add_child(spacer);
            }

            // Labels container at bottom
            const labelsContainer = new St.BoxLayout({
                vertical: true,
                style_class: 'clipboard-grid-rich-labels',
                x_expand: true,
            });

            // Title
            const titleLabel = new St.Label({
                text: config.title || '',
                style_class: 'clipboard-grid-title',
                x_expand: true,
            });
            titleLabel.get_clutter_text().set_line_wrap(false);
            titleLabel.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
            labelsContainer.add_child(titleLabel);

            // Subtitle
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
            // Color Layout filling entire card
            contentWidget = new St.BoxLayout({
                vertical: true,
                style_class: 'clipboard-grid-color-container',
                x_expand: true,
                y_expand: true,
            });

            // Background fill with color or gradient image
            let colorStyle = '';
            if (itemData.gradient_filename && options.imagesDir) {
                const gradientPath = GLib.build_filenamev([options.imagesDir, itemData.gradient_filename]);
                colorStyle = `background-image: url('file://${gradientPath}'); background-size: contain; background-repeat: repeat;`;
            } else if (config.cssColor) {
                colorStyle = `background-color: ${config.cssColor};`;
            }
            contentWidget.set_style(colorStyle);

            // Spacer to push label to bottom
            const spacer = new St.Widget({ y_expand: true });
            contentWidget.add_child(spacer);

            // Text overlay at bottom with slight background for readability
            const labelOverlay = new St.BoxLayout({
                vertical: true,
                style_class: 'clipboard-grid-color-card',
                x_expand: true,
            });

            const colorLabel = new St.Label({
                text: config.title || '',
                style_class: 'clipboard-grid-color-label',
                x_expand: true,
            });
            colorLabel.get_clutter_text().set_line_wrap(false);
            colorLabel.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
            labelOverlay.add_child(colorLabel);

            contentWidget.add_child(labelOverlay);
        } else if (config.layoutMode === 'code') {
            // Code Layout with syntax-highlighted preview
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
            // Text Layout with multi-line display
            const safeText = config.text || '';
            contentWidget = new St.Label({
                text: safeText,
                style_class: 'clipboard-grid-text-label',
                x_expand: true,
            });
            contentWidget.get_clutter_text().set_line_wrap(true);
            contentWidget.get_clutter_text().set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
            contentWidget.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
        }

        return contentWidget;
    }
}
