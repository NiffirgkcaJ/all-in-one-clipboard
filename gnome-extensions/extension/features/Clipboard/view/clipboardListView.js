import GObject from 'gi://GObject';
import St from 'gi://St';

import { assertValidLayoutAxes } from '../../../shared/utilities/utilityLayout.js';
import { Logger } from '../../../shared/utilities/utilityLogger.js';
import { StackLayout } from '../../../shared/utilities/utilityVirtualLayout.js';

import { ClipboardStyles } from '../constants/clipboardStyleConstants.js';
import { ListMetrics, ListVirtualization } from '../constants/clipboardLayoutConstants.js';

import { ClipboardBaseView } from './clipboardBaseView.js';
import { ClipboardListItemFactory } from './clipboardListItemFactory.js';

/**
 * ClipboardListView
 *
 * Stack layout for clipboard items.
 *
 * Renders clipboard items as cards in a vertical list.
 * Each card contains the content preview and action buttons.
 *
 * Extends ClipboardBaseView for shared scaffolding like headers, pagination, etc.
 * The StackLayout children handle vertical positioning internally.
 */
export const ClipboardListView = GObject.registerClass(
    class ClipboardListView extends ClipboardBaseView {
        // ========================================================================
        // Initialization
        // ========================================================================

        /**
         * Initialize the list view.
         *
         * @param {Object} options Configuration options.
         */
        constructor(options) {
            super(options, { style_class: ClipboardStyles.LIST_VIEW });

            this._themeContextSignalId = 0;
            if (typeof global !== 'undefined' && global.stage) {
                const themeContext = St.ThemeContext.get_for_stage(global.stage);
                this._themeContextSignalId = themeContext.connect('changed', () => {
                    ClipboardListItemFactory.clearThemeMetricsCache();
                });
            }

            this.connect('key-press-event', this._onKeyPress.bind(this));
        }

        // ========================================================================
        // Abstract Method Implementation
        // ========================================================================

        /**
         * Create the container for pinned items.
         *
         * @returns {StackLayout} The stack layout container.
         * @override
         */
        _createPinnedContainer() {
            return new StackLayout({
                scrollView: this._scrollView,
                virtualization: true,
                virtualOverscanPx: ListVirtualization.OVERSCAN_PX,
                calculateItemGeometry: (item, bounds) => this._calculateItemGeometry(item, true, bounds),
                renderItemFn: (item, session, geometry) => this._createItemWidget(item, true, geometry),
                updateItemFn: (widget, item, session, geometry) => this._updateItemWidget(widget, item, true, geometry),
            });
        }

        /**
         * Create the container for history items.
         *
         * @returns {StackLayout} The stack layout container.
         * @override
         */
        _createHistoryContainer() {
            return new StackLayout({
                scrollView: this._scrollView,
                virtualization: true,
                virtualOverscanPx: ListVirtualization.OVERSCAN_PX,
                calculateItemGeometry: (item, bounds) => this._calculateItemGeometry(item, false, bounds),
                renderItemFn: (item, session, geometry) => this._createItemWidget(item, false, geometry),
                updateItemFn: (widget, item, session, geometry) => this._updateItemWidget(widget, item, false, geometry),
            });
        }

        /**
         * Get the item factory class.
         *
         * @returns {Class} ClipboardListItemFactory.
         * @override
         */
        _getItemFactory() {
            return ClipboardListItemFactory;
        }

        /**
         * Get item options.
         *
         * @param {boolean} isPinned Whether the item is pinned.
         * @param {Object} geometry Layout geometry with symmetric width and height.
         * @returns {Object} Options object.
         * @override
         */
        _getItemOptions(isPinned, geometry) {
            Logger.assert(Boolean(geometry), 'ClipboardListView requires layout geometry to compute item options.', 'ClipboardListView');
            const width = geometry.width;
            const height = geometry.height;
            assertValidLayoutAxes(width, height, { context: 'ClipboardListView' });

            return {
                isPinned,
                registry: this._registry,
                storage: this._manager?.storage,
                onItemCopy: this._onItemCopy,
                manager: this._manager,
                selectedIds: this._selectedIds,
                onSelectionChanged: this._onSelectionChanged,
                checkboxIconsMap: this._checkboxIconsMap,
                settings: this._settings,
                width,
                height,
            };
        }

        // ========================================================================
        // Overrides
        // ========================================================================

        /**
         * Get all focusable items.
         *
         * @returns {Array<St.Widget>} Array of focusable widgets.
         * @override
         */
        getFocusables() {
            const pinned = this._pinnedContainer ? this._pinnedContainer.get_children().filter((w) => w._itemId && w.can_focus) : [];
            const history = this._historyContainer ? this._historyContainer.get_children().filter((w) => w._itemId && w.can_focus) : [];
            return [...pinned, ...history];
        }

        // ========================================================================
        // Private Helpers
        // ========================================================================

        /**
         * Get the clipboard registry.
         *
         * @returns {ClipboardRegistry|null} The registry instance.
         * @private
         */
        get _registry() {
            return this._manager?._clipboardRegistry;
        }

        /**
         * Create a single item widget for the stack layout.
         *
         * @param {Object} itemData The item data.
         * @param {boolean} isPinned Whether this item is pinned.
         * @param {Object} geometry Layout geometry.
         * @returns {St.Widget} The created widget.
         * @private
         */
        _createItemWidget(itemData, isPinned, geometry) {
            const options = this._getItemOptions(isPinned, geometry);
            return ClipboardListItemFactory.createItem(itemData, options);
        }

        /**
         * Calculate the 2D dimensions of a list item.
         *
         * @param {Object} item The item data.
         * @param {boolean} isPinned Whether the item belongs to the pinned list.
         * @param {Object} bounds Allocated layout bounds.
         * @returns {Object} Resolved 2D dimensions.
         * @private
         */
        _calculateItemGeometry(item, isPinned, bounds) {
            Logger.assert(Boolean(item), 'ClipboardListView requires item data to calculate geometry.', 'ClipboardListView');
            Logger.assert(Boolean(this._registry), 'ClipboardListView requires registry to calculate geometry.', 'ClipboardListView');
            Logger.assert(Boolean(bounds), 'ClipboardListView requires allocated layout bounds to calculate item geometry.', 'ClipboardListView');

            assertValidLayoutAxes(bounds.width, bounds.height, { context: 'ClipboardListView' });
            Logger.assert(typeof bounds.width === 'number' && bounds.width > 0, 'ClipboardListView requires positive width to calculate item geometry.', 'ClipboardListView');

            const actionCount = this._registry.resolveItemActionCount(item, {
                settings: this._settings,
                manager: this._manager,
                isPinned,
            });
            const baseOptions = this._getItemOptions(isPinned, bounds);
            const cardGeometry = ClipboardListItemFactory.resolveItemCardGeometry(baseOptions, actionCount);
            const options = {
                ...baseOptions,
                cardGeometry,
                availableWidth: cardGeometry.availableWidth,
                availableHeight: cardGeometry.availableHeight,
            };
            const metadata = this._registry.getViewMetadata(null, item, options);
            const hasDefinition = Boolean(this._registry.getDefinition(item.type));
            Logger.assert(
                !hasDefinition || (typeof metadata?.listHeight === 'number' && metadata.listHeight > 0),
                'ClipboardListView requires registered definitions to return positive listHeight.',
                'ClipboardListView',
            );
            const width = bounds.width;
            const height = hasDefinition ? metadata.listHeight : ListMetrics.ITEM_HEIGHT;
            return { width, height };
        }

        // ========================================================================
        // Event Handlers
        // ========================================================================

        /**
         * Handle key press events for navigation.
         *
         * @param {Clutter.Actor} _actor The source actor.
         * @param {Clutter.Event} event The key event.
         * @returns {number} Clutter.EVENT_STOP or Clutter.EVENT_PROPAGATE.
         * @private
         */
        _onKeyPress(_actor, event) {
            return this._handleKeyNavigation(event, {
                createTransferToken: (currentFocus) => this._createTransferToken(currentFocus),
                focusHistoryFromPinned: (finder) => this._historyContainer.focusFirst(finder),
                focusPinnedFromHistory: (finder) => this._pinnedContainer.focusLast(finder),
            });
        }

        /**
         * Create a transfer token for cross-section list navigation.
         *
         * @param {Clutter.Actor} currentFocus The currently focused actor.
         * @returns {Function|undefined} A function that locates the equivalent widget in a target item.
         * @private
         */
        _createTransferToken(currentFocus) {
            let itemWidget = currentFocus;
            while (itemWidget && !itemWidget._itemId) {
                itemWidget = itemWidget.get_parent();
            }

            if (!itemWidget) return undefined;

            return (targetItemWidget) => {
                if (targetItemWidget.findMatchingFocus) {
                    return targetItemWidget.findMatchingFocus(currentFocus);
                }
                return targetItemWidget;
            };
        }

        // ========================================================================
        // Lifecycle
        // ========================================================================

        /**
         * Clear the view.
         *
         * @override
         */
        clear() {
            super.clear();
        }

        /**
         * Destroy the view and clean up.
         *
         * @override
         */
        destroy() {
            if (this._themeContextSignalId > 0 && typeof global !== 'undefined' && global.stage) {
                const themeContext = St.ThemeContext.get_for_stage(global.stage);
                themeContext.disconnect(this._themeContextSignalId);
                this._themeContextSignalId = 0;
            }

            super.destroy();
        }
    },
);
