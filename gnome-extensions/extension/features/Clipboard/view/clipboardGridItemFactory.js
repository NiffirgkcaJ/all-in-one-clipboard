import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { createStaticIcon } from '../../../shared/utilities/utilityIcon.js';
import { mapLayout } from '../../../shared/utilities/utilityLayout.js';

import { ClipboardGradientStyles } from '../constants/clipboardStyleConstants.js';
import { handleClipboardItemKeyPress } from '../utilities/clipboardKeyboardShortcuts.js';
import { IconSizes } from '../constants/clipboardConstants.js';
import { ClipboardBaseItemConfig } from './clipboardBaseItemConfig.js';
import { ClipboardBaseWidgetFactory } from './clipboardBaseWidgetFactory.js';

/**
 * ClipboardGridItemFactory
 *
 * Factory for creating grid view clipboard items.
 * Creates vertical card widgets optimized for the masonry grid layout.
 */
export class ClipboardGridItemFactory {
    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Get the item view configuration.
     *
     * @param {Object} item The raw item data.
     * @param {Object} context View context.
     * @returns {Object} The view configuration.
     */
    static getItemViewConfig(item, context) {
        return ClipboardBaseItemConfig.getItemViewConfig(item, context);
    }

    /**
     * Get shell-level view metadata for an item.
     *
     * @param {Object} config The view configuration.
     * @param {Object} item The raw item data.
     * @param {Object} options Render options.
     * @param {Object} options.registry Clipboard registry instance.
     * @param {number} options.previewSize Preview size.
     * @returns {Object} View metadata.
     */
    static getItemViewMetadata(config, item, options) {
        return options.registry ? options.registry.getViewMetadata(config, item, options) : {};
    }

    /**
     * Create a complete grid item with content and overlayed action buttons.
     *
     * @param {Object} itemData The item data.
     * @param {Object} options Options for rendering.
     * @param {Object} options.storage Clipboard storage instance.
     * @param {Object} options.registry Clipboard registry instance.
     * @param {number} options.previewSize Preview size.
     * @param {Function} options.onItemCopy Callback when card is clicked.
     * @param {Object} options.manager ClipboardManager for pin or delete actions.
     * @param {Set} options.selectedIds Set of selected item IDs.
     * @param {Function} options.onSelectionChanged Callback when selection changes.
     * @param {Map} options.checkboxIconsMap Map to register checkbox icons.
     * @param {Object} options.settings Extension settings.
     * @returns {St.Widget} The complete card widget.
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

        const renderContext = ClipboardGridItemFactory._createRenderContext(options);
        const config = ClipboardGridItemFactory.getItemViewConfig(itemData, renderContext);
        const metadata = ClipboardGridItemFactory.getItemViewMetadata(config, itemData, renderContext);

        if (!metadata.isFullBleedGrid) {
            contentWrapper.add_style_class_name('clipboard-grid-card-content');
        }

        const contentWidget = ClipboardGridItemFactory.createGridContent(config, itemData, renderContext);
        contentWrapper.set_child(contentWidget);
        cardStack.add_child(contentWrapper);

        // Type Badge
        const typeBadge = ClipboardGridItemFactory._createTypeBadge(config, itemData, renderContext);
        if (typeBadge) {
            cardStack.add_child(typeBadge);
            itemWidget._typeBadge = typeBadge;
        }

        // Actions Overlay
        const actionsOverlay = new St.BoxLayout({
            ...mapLayout({
                vertical: true,
                expand: true,
                x_align: 'fill',
                y_align: 'end',
            }),
            style_class: 'clipboard-grid-controls-overlay',
        });
        actionsOverlay.set_style(ClipboardGradientStyles.CONTROLS_OVERLAY);

        // Action Controls
        const definition = options.registry ? options.registry.getDefinition(itemData.type) : null;
        const actionButtons = definition
            ? definition.createActions(itemData, {
                  settings: options.settings,
                  manager: options.manager,
                  onItemCopy: options.onItemCopy,
                  isPinned,
                  styleOptions: {
                      style_class: 'button clipboard-grid-control-button',
                      can_focus: false,
                  },
              })
            : [];

        const controlsBox = new St.BoxLayout({
            ...mapLayout({
                horizontal: true,
                x_expand: true,
                x_align: 'fill',
            }),
            style_class: 'clipboard-grid-primary-controls',
        });

        const itemCheckbox = ClipboardBaseWidgetFactory.createCheckbox(
            itemData,
            {
                selectedIds: options.selectedIds,
                checkboxIconsMap: options.checkboxIconsMap,
                onSelectionChanged: options.onSelectionChanged,
            },
            {
                style_class: 'button clipboard-grid-checkbox',
                can_focus: false,
            },
        );
        itemCheckbox.visible = options.settings.get_boolean('clipboard-show-action-bar');
        controlsBox.add_child(itemCheckbox);
        const checkboxIcon = itemCheckbox.child;

        const spacer = new St.Widget({ x_expand: true });
        controlsBox.add_child(spacer);

        actionButtons.forEach((button) => controlsBox.add_child(button));
        actionsOverlay.add_child(controlsBox);

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
        itemWidget._pinButton = actionButtons.find((btn) => btn._action === 'pin');
        itemWidget._deleteButton = actionButtons.find((btn) => btn._action === 'delete');
        itemWidget._itemId = itemData.id;
        itemWidget._contentWrapper = contentWrapper;
        itemWidget._cardStack = cardStack;
        itemWidget._viewConfig = config;
        itemWidget._renderFingerprint = ClipboardBaseItemConfig.getItemRenderFingerprint(config, itemData, renderContext);

        return itemWidget;
    }

    /**
     * Update an existing item widget with new data.
     *
     * @param {St.Widget} itemWidget The existing widget.
     * @param {Object} newItemData The new item data.
     * @param {Object} options Options for rendering.
     * @param {Object} options.storage Clipboard storage instance.
     * @param {Object} options.registry Clipboard registry instance.
     * @param {number} options.previewSize Preview size.
     * @returns {boolean} True if the structure changed.
     */
    static updateItem(itemWidget, newItemData, options) {
        if (!itemWidget || !newItemData) return false;
        itemWidget._itemId = newItemData.id;

        const renderContext = ClipboardGridItemFactory._createRenderContext(options);
        const config = ClipboardGridItemFactory.getItemViewConfig(newItemData, renderContext);
        const renderFingerprint = ClipboardBaseItemConfig.getItemRenderFingerprint(config, newItemData, renderContext);
        const previousFingerprint = itemWidget._renderFingerprint || itemWidget._viewConfig?._fingerprint || '';
        const nextFingerprint = renderFingerprint || config._fingerprint || '';
        if (previousFingerprint && previousFingerprint === nextFingerprint) {
            return false;
        }

        let structureChanged = true;
        itemWidget._viewConfig = config;
        itemWidget._renderFingerprint = renderFingerprint;
        const metadata = ClipboardGridItemFactory.getItemViewMetadata(config, newItemData, renderContext);
        const contentWrapper = itemWidget._contentWrapper;
        if (contentWrapper) {
            const newContentWidget = ClipboardGridItemFactory.createGridContent(config, newItemData, renderContext);
            contentWrapper.set_child(newContentWidget);

            if (!metadata.isFullBleedGrid) {
                contentWrapper.add_style_class_name('clipboard-grid-card-content');
            } else {
                contentWrapper.remove_style_class_name('clipboard-grid-card-content');
            }
        }

        const cardStack = itemWidget._cardStack;
        if (cardStack) {
            if (itemWidget._typeBadge) {
                itemWidget._typeBadge.destroy();
                itemWidget._typeBadge = null;
            }

            const typeBadge = ClipboardGridItemFactory._createTypeBadge(config, newItemData, renderContext);
            if (typeBadge) {
                cardStack.add_child(typeBadge);
                itemWidget._typeBadge = typeBadge;

                const actionsOverlay = cardStack.get_children().find((c) => c.has_style_class_name('clipboard-grid-controls-overlay'));
                if (actionsOverlay) {
                    cardStack.set_child_above_sibling(actionsOverlay, typeBadge);
                }
            }
        }

        return structureChanged;
    }

    /**
     * Create the content widget for a grid item.
     *
     * @param {Object} config The view configuration.
     * @param {Object} itemData The raw item data.
     * @param {Object} options Display options.
     * @param {Object} options.storage Clipboard storage instance.
     * @param {number} options.previewSize Preview size.
     * @param {Object} options.registry Clipboard registry instance.
     * @returns {St.Widget} The content widget.
     */
    static createGridContent(config, itemData, options) {
        const registryContent = options.registry ? options.registry.createGridContent(config, itemData, options) : null;
        if (registryContent) return registryContent;

        return ClipboardGridItemFactory._createFallbackContent(config);
    }

    // ========================================================================
    // Internal Helpers
    // ========================================================================

    /**
     * Create the render context passed to clipboard definitions.
     *
     * @param {Object} options Factory options.
     * @returns {Object} Render context.
     * @private
     */
    static _createRenderContext(options) {
        return {
            registry: options.registry,
            storage: options.storage,
            previewSize: options.previewSize,
        };
    }

    /**
     * Create a generic type badge for grid cards.
     *
     * @param {Object} config The view configuration.
     * @param {Object} itemData The raw item data.
     * @param {Object} options Display options.
     * @param {Object} options.registry Clipboard registry instance.
     * @returns {St.Widget|null} The type badge or null.
     * @private
     */
    static _createTypeBadge(config, itemData, options) {
        if (!config.icon) return null;

        const typeBadge = new St.BoxLayout({
            ...mapLayout({
                horizontal: true,
                expand: true,
                x_align: 'fill',
                y_align: 'start',
            }),
            style_class: 'clipboard-grid-type-badge',
        });
        typeBadge.set_style(ClipboardGradientStyles.BADGE_OVERLAY);
        const typeIcon = createStaticIcon({ ...config, iconSize: IconSizes.BADGE_TYPE_ICON }, { styleClass: 'clipboard-grid-type-icon' });
        typeBadge.add_child(typeIcon);

        const badge = options.registry ? options.registry.getGridBadge(config, itemData, options) : null;
        if (badge && badge.text) {
            const spacer = new St.Widget({ x_expand: true });
            typeBadge.add_child(spacer);

            const badgeLabel = new St.Label({
                text: badge.text,
                style_class: badge.style_class || 'clipboard-grid-badge-label',
            });
            typeBadge.add_child(badgeLabel);
        }

        return typeBadge;
    }

    /**
     * Create fallback content for unregistered item definitions.
     *
     * @param {Object} config The view configuration.
     * @returns {St.Widget} The fallback content widget.
     * @private
     */
    static _createFallbackContent(config) {
        const safeText = config.text || config.title || config.subtitle || '';
        const contentWidget = new St.Label({
            text: safeText,
            style_class: 'clipboard-grid-text-label',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        contentWidget.get_clutter_text().set_line_wrap(true);
        contentWidget.get_clutter_text().set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
        contentWidget.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);

        return contentWidget;
    }
}
