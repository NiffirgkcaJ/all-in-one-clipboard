import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { getInterfaceFontStyle } from '../../../shared/utilities/utilityFont.js';
import { mapLayout } from '../../../shared/utilities/utilityLayout.js';

import { ClipboardStyles } from '../constants/clipboardStyleConstants.js';
import { handleClipboardItemKeyPress } from '../utilities/clipboardKeyboardShortcuts.js';
import { ClipboardBaseItemConfig } from './clipboardBaseItemConfig.js';
import { ClipboardBaseWidgetFactory } from './clipboardBaseWidgetFactory.js';
import { renderListArchetype } from './clipboardViewTemplates.js';

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
     * Read list row layout metrics directly from the stylesheet.
     *
     * @returns {Object} Layout metrics resolved from active theme nodes.
     */
    static getThemeMetrics() {
        if (ClipboardListItemFactory._cachedMetrics) {
            return ClipboardListItemFactory._cachedMetrics;
        }

        const themeContext = St.ThemeContext.get_for_stage(global.stage);
        const theme = themeContext.get_theme();
        const rootNode = themeContext.get_root_node();

        const containerNode = St.ThemeNode.new(themeContext, rootNode, theme, GObject.TYPE_NONE, null, ClipboardStyles.CONTAINER, null, '');
        const buttonNode = St.ThemeNode.new(themeContext, containerNode, theme, GObject.TYPE_NONE, null, ClipboardStyles.LIST_CONTROL_BUTTON, null, '');
        const checkboxNode = St.ThemeNode.new(themeContext, containerNode, theme, GObject.TYPE_NONE, null, ClipboardStyles.LIST_CHECKBOX, null, '');
        const rowNode = St.ThemeNode.new(themeContext, containerNode, theme, GObject.TYPE_NONE, null, ClipboardStyles.LIST_ITEM, null, '');
        const contentNode = St.ThemeNode.new(themeContext, containerNode, theme, GObject.TYPE_NONE, null, ClipboardStyles.LIST_CONTENT_ZONE, null, '');

        const metrics = {
            checkboxWidth: checkboxNode.get_min_width(),
            controlButtonWidth: buttonNode.get_min_width(),
            rowOverhead:
                rowNode.get_horizontal_padding() + rowNode.get_margin(St.Side.LEFT) + rowNode.get_margin(St.Side.RIGHT) + contentNode.get_margin(St.Side.LEFT) + contentNode.get_margin(St.Side.RIGHT),
        };
        ClipboardListItemFactory._cachedMetrics = metrics;
        return metrics;
    }

    /**
     * Invalidate cached theme metrics when stylesheet or scale updates.
     */
    static clearThemeMetricsCache() {
        ClipboardListItemFactory._cachedMetrics = null;
    }

    /**
     * Calculate horizontal layout dimensions for a list row.
     *
     * @param {Object} options Sizing options.
     * @param {number} options.extensionWidth Overall menu width.
     * @param {boolean} [options.showActionBar] Whether the leading checkbox is active.
     * @param {number} [options.actionCount] Number of trailing action buttons.
     * @param {number} [options.controlsWidth] Trailing controls width override.
     * @param {Object} [options.metrics] Custom layout metrics.
     * @returns {Object} Layout geometry specification.
     */
    static calculateRowGeometry(options = {}) {
        const extensionWidth = options.extensionWidth || 0;
        const showActionBar = Boolean(options.showActionBar);
        const metrics = options.metrics || ClipboardListItemFactory.getThemeMetrics();

        const leadingWidth = showActionBar ? metrics.checkboxWidth : 0;
        const actionCount = typeof options.actionCount === 'number' ? options.actionCount : typeof options.controlsWidth === 'number' ? options.controlsWidth / metrics.controlButtonWidth : 0;
        const trailingWidth = typeof options.controlsWidth === 'number' ? options.controlsWidth : actionCount * metrics.controlButtonWidth;
        const availableRowWidth = Math.max(0, extensionWidth - metrics.rowOverhead);
        const contentWidth = Math.max(0, availableRowWidth - leadingWidth - trailingWidth);

        return {
            totalWidth: extensionWidth,
            availableRowWidth,
            leadingWidth,
            trailingWidth,
            contentWidth,
            metrics,
        };
    }

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
        const actionButtons = options.registry
            ? options.registry.createItemActions(itemData, {
                  settings: options.settings,
                  manager: options.manager,
                  onItemCopy: options.onItemCopy,
                  isPinned,
                  styleOptions: {
                      style_class: ClipboardStyles.LIST_CONTROL_BUTTON,
                      y_align: Clutter.ActorAlign.CENTER,
                  },
              })
            : [];
        const rowGeometry = ClipboardListItemFactory.calculateRowGeometry({
            extensionWidth: options.settings?.get_int('extension-width'),
            showActionBar: options.settings?.get_boolean('clipboard-show-action-bar'),
            actionCount: actionButtons.length,
        });
        const renderContext = ClipboardListItemFactory._createRenderContext(options, rowGeometry);
        const config = ClipboardListItemFactory.getItemViewConfig(itemData, renderContext);
        const metadata = ClipboardListItemFactory.getItemViewMetadata(config, itemData, renderContext);

        const itemWidget = new St.Button({
            style_class: ClipboardStyles.LIST_ITEM,
            can_focus: true,
            clip_to_allocation: true,
        });
        itemWidget.connect('clicked', () => options.onItemCopy(itemData));

        const mainBox = new St.BoxLayout({
            ...mapLayout({
                horizontal: true,
                x_expand: true,
                y_align: 'center',
            }),
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
                style_class: ClipboardStyles.LIST_CHECKBOX,
                x_align: Clutter.ActorAlign.START,
                y_expand: false,
                y_align: Clutter.ActorAlign.CENTER,
            },
        );
        itemCheckbox.visible = options.settings.get_boolean('clipboard-show-action-bar');
        mainBox.add_child(itemCheckbox);
        const checkboxIcon = itemCheckbox.child;

        // Content
        const contentWidget = ClipboardListItemFactory.createListContent(config, itemData, renderContext);
        contentWidget.add_style_class_name(ClipboardStyles.LIST_CONTENT_ZONE);
        contentWidget.width = rowGeometry.contentWidth;
        contentWidget.x_expand = true;
        mainBox.add_child(contentWidget);

        if (metadata.listMinHeight) {
            itemWidget.set_style(`min-height: ${metadata.listMinHeight}px;`);
        }

        // Action Buttons
        const buttonsBox = new St.BoxLayout({
            ...mapLayout({
                horizontal: true,
                x_align: 'end',
            }),
            style_class: ClipboardStyles.LIST_CONTROLS,
        });
        actionButtons.forEach((button) => buttonsBox.add_child(button));
        mainBox.add_child(buttonsBox);

        // Focus Handlers
        const updateFocusState = () => {
            if (itemWidget.has_key_focus() || itemCheckbox.has_key_focus() || actionButtons.some((btn) => btn.has_key_focus())) {
                itemWidget.add_style_pseudo_class('focused');
            } else {
                itemWidget.remove_style_pseudo_class('focused');
            }
        };

        itemWidget.connect('key-focus-in', updateFocusState);
        itemWidget.connect('key-focus-out', updateFocusState);
        itemCheckbox.connect('key-focus-in', updateFocusState);
        itemCheckbox.connect('key-focus-out', updateFocusState);
        actionButtons.forEach((btn) => {
            btn.connect('key-focus-in', updateFocusState);
            btn.connect('key-focus-out', updateFocusState);
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
        itemWidget._buttonsBox = buttonsBox;
        itemWidget._pinButton = actionButtons.find((btn) => btn._action === 'pin');
        itemWidget._deleteButton = actionButtons.find((btn) => btn._action === 'delete');
        itemWidget._actionButtons = actionButtons;
        itemWidget._itemId = itemData.id;
        itemWidget._contentWidget = contentWidget;
        itemWidget._mainBox = mainBox;
        itemWidget._viewConfig = config;
        itemWidget._renderFingerprint = ClipboardBaseItemConfig.getItemRenderFingerprint(config, itemData, renderContext);

        itemWidget.getFocusables = () => {
            return [itemCheckbox, itemWidget, ...actionButtons].filter((actor) => actor && actor.visible && actor.mapped);
        };

        itemWidget.findMatchingFocus = (currentFocus) => {
            const action = currentFocus?._action;
            if (action === 'checkbox') {
                return itemCheckbox.visible && itemCheckbox.mapped ? itemCheckbox : itemWidget;
            }
            if (action) {
                const match = actionButtons.find((btn) => btn._action === action);
                if (match && match.visible && match.mapped) return match;
            }
            return itemWidget;
        };

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
     * @returns {boolean} True if the content structure was updated.
     */
    static updateItem(itemWidget, newItemData, options) {
        if (!itemWidget || !newItemData) return false;

        itemWidget._itemId = newItemData.id;

        const actionCount = itemWidget._actionButtons ? itemWidget._actionButtons.length : 0;
        const rowGeometry = ClipboardListItemFactory.calculateRowGeometry({
            extensionWidth: options.settings?.get_int('extension-width'),
            showActionBar: options.settings?.get_boolean('clipboard-show-action-bar'),
            actionCount,
        });
        const renderContext = ClipboardListItemFactory._createRenderContext(options, rowGeometry);
        const config = ClipboardListItemFactory.getItemViewConfig(newItemData, renderContext);
        const renderFingerprint = ClipboardBaseItemConfig.getItemRenderFingerprint(config, newItemData, renderContext);
        const previousFingerprint = itemWidget._renderFingerprint || itemWidget._viewConfig?._fingerprint || '';
        const nextFingerprint = renderFingerprint || config._fingerprint || '';
        if (previousFingerprint && previousFingerprint === nextFingerprint) {
            return false;
        }

        itemWidget._viewConfig = config;
        itemWidget._renderFingerprint = renderFingerprint;
        const metadata = ClipboardListItemFactory.getItemViewMetadata(config, newItemData, renderContext);
        const newContentWidget = ClipboardListItemFactory.createListContent(config, newItemData, renderContext);

        const mainBox = itemWidget._mainBox || itemWidget.get_child();
        const oldContentWidget = itemWidget._contentWidget;

        if (mainBox) {
            mainBox.y_align = Clutter.ActorAlign.CENTER;
        }

        if (mainBox && oldContentWidget) {
            newContentWidget.add_style_class_name(ClipboardStyles.LIST_CONTENT_ZONE);
            newContentWidget.width = rowGeometry.contentWidth;
            newContentWidget.x_expand = true;
            mainBox.replace_child(oldContentWidget, newContentWidget);
            itemWidget._contentWidget = newContentWidget;
            oldContentWidget.destroy();
        }

        itemWidget.set_style(metadata.listMinHeight ? `min-height: ${metadata.listMinHeight}px;` : '');
        return true;
    }

    /**
     * Create a content widget for a list item based on its configuration.
     *
     * @param {Object} config The view configuration.
     * @param {Object} itemData The raw item data.
     * @param {Object} options Display options.
     * @param {Object} options.storage Clipboard storage instance.
     * @param {Object} options.registry Clipboard registry instance.
     * @returns {St.Widget} The content widget.
     */
    static createListContent(config, itemData, options) {
        const definition = options.registry?.getDefinition(itemData.type);
        if (definition?.createListContent) {
            const customContent = definition.createListContent(config, itemData, { ...options, definition });
            if (customContent) return customContent;
        }

        const archetypeContent = renderListArchetype(definition?.viewType, config);
        if (archetypeContent) return archetypeContent;

        return ClipboardListItemFactory._createFallbackContent(config);
    }

    // ========================================================================
    // Internal Helpers
    // ========================================================================

    /**
     * Create the render context passed to clipboard definitions.
     *
     * @param {Object} options Factory options.
     * @param {Object} [rowGeometry] Optional calculated row geometry.
     * @returns {Object} Render context.
     * @private
     */
    static _createRenderContext(options, rowGeometry) {
        return {
            registry: options.registry,
            storage: options.storage,
            settings: options.settings,
            rowGeometry,
            availableContentWidth: rowGeometry ? rowGeometry.contentWidth : 0,
        };
    }

    /**
     * Create emergency fallback content when registry is unavailable.
     *
     * @param {Object} config The view configuration.
     * @returns {St.Widget} The fallback content widget.
     * @private
     */
    static _createFallbackContent(config) {
        const safeText = config.title || config.text || config.subtitle || '';
        const label = new St.Label({
            text: safeText,
            style: getInterfaceFontStyle(),
            style_class: ClipboardStyles.LIST_LABEL_CONTENT,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        label.get_clutter_text().set_line_wrap(false);
        label.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
        return label;
    }
}
