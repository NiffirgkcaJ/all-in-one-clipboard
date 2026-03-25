import GObject from 'gi://GObject';

import { StackLayout } from '../../../shared/utilities/utilityStackLayout.js';

import { ClipboardBaseView } from './clipboardBaseView.js';
import { ClipboardListItemFactory } from './clipboardListItemFactory.js';
import { ListVirtualization } from '../constants/clipboardLayoutConstants.js';

/**
 * ClipboardListView
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
        /**
         * Initialize the list view.
         * @param {Object} options Configuration options
         */
        constructor(options) {
            super(options, { style_class: 'clipboard-list-view' });

            this.connect('key-press-event', this._onKeyPress.bind(this));
        }

        // ========================================================================
        // Abstract Method Implementation
        // ========================================================================

        /**
         * Create the container for pinned items.
         * @returns {StackLayout} The stack layout container
         * @override
         */
        _createPinnedContainer() {
            return new StackLayout({
                style_class: 'clipboard-stack-container',
                scrollView: this._scrollView,
                virtualization: true,
                virtualMinItems: ListVirtualization.PINNED_MIN_ITEMS,
                virtualEstimatedItemHeight: ListVirtualization.ESTIMATED_ITEM_HEIGHT,
                virtualOverscanItems: ListVirtualization.OVERSCAN_ITEMS,
                renderItemFn: (item) => this._createItemWidget(item, true),
                updateItemFn: (widget, item) => this._updateItemWidget(widget, item, true),
            });
        }

        /**
         * Create the container for history items.
         * @returns {StackLayout} The stack layout container
         * @override
         */
        _createHistoryContainer() {
            return new StackLayout({
                style_class: 'clipboard-stack-container',
                scrollView: this._scrollView,
                virtualization: true,
                virtualMinItems: ListVirtualization.HISTORY_MIN_ITEMS,
                virtualEstimatedItemHeight: ListVirtualization.ESTIMATED_ITEM_HEIGHT,
                virtualOverscanItems: ListVirtualization.OVERSCAN_ITEMS,
                renderItemFn: (item) => this._createItemWidget(item, false),
                updateItemFn: (widget, item) => this._updateItemWidget(widget, item, false),
            });
        }

        /**
         * Get the item factory class.
         * @returns {Class} BillboardListItemFactory
         * @override
         */
        _getItemFactory() {
            return ClipboardListItemFactory;
        }

        /**
         * Get item options.
         * @param {boolean} isPinned
         * @returns {Object}
         * @override
         */
        _getItemOptions(isPinned) {
            return {
                isPinned: isPinned,
                imagesDir: this._manager._imagesDir,
                imagePreviewsDir: this._manager._imagePreviewsDir,
                linkPreviewsDir: this._manager._linkPreviewsDir,
                imagePreviewSize: this._imagePreviewSize,
                onItemCopy: this._onItemCopy,
                manager: this._manager,
                selectedIds: this._selectedIds,
                onSelectionChanged: this._onSelectionChanged,
                checkboxIconsMap: this._checkboxIconsMap,
                settings: this._settings,
            };
        }

        // ========================================================================
        // Overrides
        // ========================================================================

        /**
         * Get all focusable items.
         * @returns {Array<St.Widget>} Array of focusable widgets
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
         * Create a single item widget for the stack layout.
         * @param {Object} itemData The item data
         * @param {boolean} isPinned Whether this item is pinned
         * @returns {St.Widget} The created widget
         * @private
         */
        _createItemWidget(itemData, isPinned) {
            const options = this._getItemOptions(isPinned);
            return ClipboardListItemFactory.createItem(itemData, options);
        }

        // ========================================================================
        // Event Handlers
        // ========================================================================

        /**
         * Handle key press events for navigation.
         * @param {Clutter.Actor} _actor The source actor
         * @param {Clutter.Event} event The key event
         * @returns {number} Clutter.EVENT_STOP or Clutter.EVENT_PROPAGATE
         * @private
         */
        _onKeyPress(_actor, event) {
            return this._handleArrowNavigation(event, {
                createTransferToken: (currentFocus) => this._createTransferToken(currentFocus),
                focusHistoryFromPinned: (finder) => this._historyContainer?.focusFirst(finder),
                focusPinnedFromHistory: (finder) => this._pinnedContainer?.focusLast(finder),
            });
        }

        /**
         * Create a transfer token for cross-section list navigation.
         * @param {Clutter.Actor} currentFocus The currently focused actor
         * @returns {Function|undefined} A function that locates the equivalent widget in a target item
         * @private
         */
        _createTransferToken(currentFocus) {
            let itemWidget = currentFocus;
            while (itemWidget && !itemWidget._itemId) {
                itemWidget = itemWidget.get_parent();
            }

            if (!itemWidget) return undefined;

            const isCheckbox = currentFocus === itemWidget._itemCheckbox;
            const isPin = currentFocus === itemWidget._pinButton;
            const isDelete = currentFocus === itemWidget._deleteButton;

            return (targetItemWidget) => {
                if (isCheckbox) return targetItemWidget._itemCheckbox;
                if (isPin) return targetItemWidget._pinButton;
                if (isDelete) return targetItemWidget._deleteButton;
                return targetItemWidget;
            };
        }

        // ========================================================================
        // Lifecycle
        // ========================================================================

        /**
         * Clear the view.
         * @override
         */
        clear() {
            super.clear();
        }

        /**
         * Destroy the view and clean up.
         * @override
         */
        destroy() {
            super.destroy();
        }
    },
);
