import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import { StackLayout } from '../../../shared/utilities/utilityStackLayout.js';

import { ClipboardListItemFactory } from './clipboardListItemFactory.js';
import { ClipboardBaseView } from './clipboardBaseView.js';

export const ClipboardListView = GObject.registerClass(
    class ClipboardListView extends ClipboardBaseView {
        /**
         * @param {Object} options - Configuration options
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
                renderItemFn: (item) => this._createItemWidget(item, true),
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
                renderItemFn: (item) => this._createItemWidget(item, false),
            });
        }

        /**
         * Get all focusable items in the list.
         * Used by parent container for navigation.
         * @returns {Array<St.Widget>} Array of focusable widgets
         * @override
         */
        getFocusables() {
            const pinned = this._pinnedContainer ? this._pinnedContainer.get_children() : [];
            const history = this._historyContainer ? this._historyContainer.get_children() : [];
            return [...pinned, ...history];
        }

        // ========================================================================
        // Private Helpers
        // ========================================================================

        /**
         * Create a single widget for the list.
         * @param {Object} itemData The item data
         * @param {boolean} isPinned Whether this item is pinned
         * @returns {St.Widget} The created widget
         * @private
         */
        _createItemWidget(itemData, isPinned) {
            const itemWidget = ClipboardListItemFactory.createItem(itemData, {
                isPinned: isPinned,
                imagesDir: this._manager._imagesDir,
                linkPreviewsDir: this._manager._linkPreviewsDir,
                imagePreviewSize: this._imagePreviewSize,
                onItemCopy: this._onItemCopy,
                manager: this._manager,
                selectedIds: this._selectedIds,
                onSelectionChanged: this._onSelectionChanged,
                checkboxIconsMap: this._checkboxIconsMap,
                settings: this._settings,
            });

            return itemWidget;
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
            const symbol = event.get_key_symbol();
            const isArrowKey = [Clutter.KEY_Left, Clutter.KEY_Right, Clutter.KEY_Up, Clutter.KEY_Down].includes(symbol);
            if (!isArrowKey) return Clutter.EVENT_PROPAGATE;

            const currentFocus = global.stage.get_key_focus();
            const pinnedHasItems = this._pinnedContainer && this._pinnedContainer.getItemCount() > 0;
            const historyHasItems = this._historyContainer && this._historyContainer.getItemCount() > 0;

            if (pinnedHasItems && this._pinnedContainer.contains(currentFocus)) {
                const result = this._pinnedContainer.handleKeyPress(this._pinnedContainer, event);
                if (result === Clutter.EVENT_STOP) return result;

                if (symbol === Clutter.KEY_Down && historyHasItems) {
                    const finder = this._createFocusFinder(currentFocus);
                    this._historyContainer.focusFirst(finder);
                    return Clutter.EVENT_STOP;
                }
                if (symbol === Clutter.KEY_Up) {
                    this.emit('navigate-up');
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            }

            if (historyHasItems && this._historyContainer.contains(currentFocus)) {
                const result = this._historyContainer.handleKeyPress(this._historyContainer, event);
                if (result === Clutter.EVENT_STOP) return result;

                if (symbol === Clutter.KEY_Up) {
                    if (pinnedHasItems) {
                        const finder = this._createFocusFinder(currentFocus);
                        this._pinnedContainer.focusLast(finder);
                    } else {
                        this.emit('navigate-up');
                    }
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            }

            return Clutter.EVENT_PROPAGATE;
        }

        /**
         * Create a finder function that locates the equivalent widget in a target item.
         * Usage:
         *   const finder = this._createFocusFinder(currentFocus);
         *   otherContainer.focusFirst(finder);
         *
         * @param {Clutter.Actor} currentFocus - The currently focused actor
         * @returns {Function|undefined} A function (itemWidget) => childWidget, or undefined
         * @private
         */
        _createFocusFinder(currentFocus) {
            let itemWidget = currentFocus;
            while (itemWidget && !itemWidget._itemId) {
                itemWidget = itemWidget.get_parent();
            }

            if (!itemWidget) return undefined;

            // Determine which type of widget is focused
            const isCheckbox = currentFocus === itemWidget._itemCheckbox;
            const isPin = currentFocus === itemWidget._pinButton;
            const isDelete = currentFocus === itemWidget._deleteButton;

            // Return a function that finds the same type in the target item
            return (targetItemWidget) => {
                if (isCheckbox) return targetItemWidget._itemCheckbox;
                if (isPin) return targetItemWidget._pinButton;
                if (isDelete) return targetItemWidget._deleteButton;
                return targetItemWidget; // Fallback to item itself
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
