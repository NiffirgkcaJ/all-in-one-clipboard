import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { ClipboardBaseItemConfig } from './clipboardBaseItemConfig.js';
import { ClipboardBaseWidgetFactory } from './clipboardBaseWidgetFactory.js';
import { handleClipboardItemKeyPress } from '../utilities/clipboardKeyboardShortcuts.js';

/**
 * ClipboardListItemFactory
 *
 * Factory for creating list view clipboard items.
 * Creates horizontal row widgets optimized for the list layout.
 */
export class ClipboardListItemFactory {
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
     * Create a complete list item row with content and action buttons.
     *
     * @param {Object} itemData The item data.
     * @param {Object} options Options for rendering.
     * @param {Object} options.storage Clipboard storage instance.
     * @param {Object} options.registry Clipboard registry instance.
     * @param {number} options.previewSize Preview size.
     * @param {Function} options.onItemCopy Callback when row is clicked.
     * @param {Object} options.manager ClipboardManager for pin or delete actions.
     * @param {Set} options.selectedIds Set of selected item IDs.
     * @param {Function} options.onSelectionChanged Callback when selection changes.
     * @param {Map} options.checkboxIconsMap Map to register checkbox icons.
     * @param {Object} options.settings Extension settings.
     * @returns {St.Widget} The complete row widget.
     */
    static createItem(itemData, options) {
        const isPinned = options.isPinned !== undefined ? options.isPinned : itemData._isPinned;

        const itemWidget = new St.Button({
            style_class: 'button clipboard-list-item',
            can_focus: true,
        });
        itemWidget.connect('clicked', () => options.onItemCopy(itemData));

        const mainBox = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'clipboard-row-content',
        });
        itemWidget.set_child(mainBox);

        // Checkbox
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
        itemCheckbox.visible = options.settings.get_boolean('clipboard-show-action-bar');
        mainBox.add_child(itemCheckbox);
        const checkboxIcon = itemCheckbox.child;

        // Content
        const renderContext = ClipboardListItemFactory._createRenderContext(options);
        const config = ClipboardListItemFactory.getItemViewConfig(itemData, renderContext);
        const metadata = ClipboardListItemFactory.getItemViewMetadata(config, itemData, renderContext);
        const contentWidget = ClipboardListItemFactory.createListContent(config, itemData, renderContext);
        mainBox.add_child(contentWidget);

        if (metadata.listMinHeight) {
            itemWidget.set_style(`min-height: ${metadata.listMinHeight}px;`);
        }

        // Action Buttons
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

        // Focus Handlers
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
     */
    static updateItem(itemWidget, newItemData, options) {
        if (!itemWidget || !newItemData) return;

        itemWidget._itemId = newItemData.id;

        const renderContext = ClipboardListItemFactory._createRenderContext(options);
        const config = ClipboardListItemFactory.getItemViewConfig(newItemData, renderContext);
        const renderFingerprint = ClipboardBaseItemConfig.getItemRenderFingerprint(config, newItemData, renderContext);
        const previousFingerprint = itemWidget._renderFingerprint || itemWidget._viewConfig?._fingerprint || '';
        const nextFingerprint = renderFingerprint || config._fingerprint || '';
        if (previousFingerprint && previousFingerprint === nextFingerprint) {
            return;
        }

        itemWidget._viewConfig = config;
        itemWidget._renderFingerprint = renderFingerprint;
        const metadata = ClipboardListItemFactory.getItemViewMetadata(config, newItemData, renderContext);
        const newContentWidget = ClipboardListItemFactory.createListContent(config, newItemData, renderContext);

        const mainBox = itemWidget._mainBox || itemWidget.get_child();
        const oldContentWidget = itemWidget._contentWidget;

        if (mainBox && oldContentWidget) {
            mainBox.replace_child(oldContentWidget, newContentWidget);
            itemWidget._contentWidget = newContentWidget;
            oldContentWidget.destroy();
        }

        itemWidget.set_style(metadata.listMinHeight ? `min-height: ${metadata.listMinHeight}px;` : '');
    }

    /**
     * Create a content widget for a list item based on its configuration.
     *
     * @param {Object} config The view configuration.
     * @param {Object} itemData The raw item data.
     * @param {Object} options Display options.
     * @param {Object} options.storage Clipboard storage instance.
     * @param {number} options.previewSize Preview size.
     * @param {Object} options.registry Clipboard registry instance.
     * @returns {St.Widget} The content widget.
     */
    static createListContent(config, itemData, options) {
        const registryContent = options.registry ? options.registry.createListContent(config, itemData, options) : null;
        if (registryContent) return registryContent;

        return ClipboardListItemFactory._createFallbackContent(config);
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
            style_class: 'clipboard-list-text-label',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        contentWidget.get_clutter_text().set_line_wrap(false);
        contentWidget.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);

        return contentWidget;
    }
}
