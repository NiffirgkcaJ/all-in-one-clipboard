import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import { ensureActorVisibleInScrollView } from 'resource:///org/gnome/shell/misc/animationUtils.js';

/**
 * StackLayout - A vertical list container that supports atomic reconciliation.
 * Items are rendered sequentially in a vertical column.
 * List items are focused using arrow keys.
 * @example
 * const list = new StackLayout({
 *     spacing: 8,
 *     renderItemFn: (itemData, session) => createItemWidget(itemData)
 * });
 * list.addItems(myItemsArray, renderSession);
 */
export const StackLayout = GObject.registerClass(
    class StackLayout extends St.BoxLayout {
        /**
         * Initialize the stack layout.
         * @param {Object} params Configuration parameters
         * @param {Function} params.renderItemFn Function to render each item
         * @param {St.ScrollView} [params.scrollView] Parent scroll view for focus scrolling
         * @param {Object} [otherParams] Other St.BoxLayout parameters
         */
        constructor(params) {
            const { renderItemFn, updateItemFn, scrollView, ...otherParams } = params;

            super({
                vertical: true,
                x_expand: true,
                ...otherParams,
            });

            this._renderItemFn = renderItemFn;
            this._updateItemFn = updateItemFn;
            this._scrollView = scrollView;
            this._items = [];
            this._checkboxIconsMap = new Map();
            this._isDestroyed = false;

            this.connect('destroy', () => {
                this._isDestroyed = true;
            });
        }

        /**
         * Reconcile the layout with a new list of items reusing existing widgets.
         * @param {Array<Object>} items New list of items to render
         * @param {Object} renderSession Optional session data passed to renderItemFn
         */
        reconcile(items, renderSession) {
            this._items = items;

            const existingWidgets = new Map();
            this.get_children().forEach((child) => {
                if (child._itemId) {
                    existingWidgets.set(child._itemId, child);
                } else {
                    child.destroy();
                }
            });

            items.forEach((item, index) => {
                let widget = existingWidgets.get(item.id);

                if (widget) {
                    existingWidgets.delete(item.id);
                    if (this._updateItemFn) {
                        this._updateItemFn(widget, item, renderSession);
                    }
                    if (this.get_child_at_index(index) !== widget) {
                        this.set_child_at_index(widget, index);
                    }
                } else {
                    widget = this._renderItemFn(item, renderSession);
                    if (widget) {
                        if (!widget._itemId) widget._itemId = item.id;

                        if (this.get_child_at_index(index) !== widget) {
                            if (widget.get_parent() === this) {
                                this.set_child_at_index(widget, index);
                            } else {
                                this.insert_child_at_index(widget, index);
                            }
                        }
                    }
                }
            });

            existingWidgets.forEach((widget) => widget.destroy());
        }

        /**
         * Append additional items without full reconciliation.
         * @param {Array<Object>} newItems Items to append
         * @param {Object} renderSession Optional session data
         */
        addItems(newItems, renderSession) {
            this._items = [...this._items, ...newItems];
            newItems.forEach((item) => {
                const widget = this._renderItemFn(item, renderSession);
                if (widget) {
                    if (!widget._itemId) widget._itemId = item.id;
                    this.add_child(widget);
                }
            });
        }

        /**
         * Focus a specific item widget with robust handling.
         * @param {St.Widget} widget The widget to focus
         * @param {Function} [targetFinder] Optional function to find a specific child to focus
         */
        focusItem(widget, targetFinder) {
            if (!widget) return;

            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 0, () => {
                if (this._isDestroyed) return GLib.SOURCE_REMOVE;

                let target = widget;
                if (typeof targetFinder === 'function') {
                    const found = targetFinder(widget);
                    if (found) target = found;
                }

                if (target && target.visible && target.mapped) {
                    target.grab_key_focus();
                } else {
                    widget.grab_key_focus();
                }

                if (this._scrollView) {
                    ensureActorVisibleInScrollView(this._scrollView, widget);
                }
                return GLib.SOURCE_REMOVE;
            });
        }

        /**
         * Handle key press events for stack navigation.
         * @param {Clutter.Actor} _actor The actor that received the event
         * @param {Clutter.Event} event The key press event
         * @returns {number} Clutter.EVENT_STOP or Clutter.EVENT_PROPAGATE
         */
        handleKeyPress(_actor, event) {
            const symbol = event.get_key_symbol();
            const currentFocus = global.stage.get_key_focus();

            if (!this.contains(currentFocus)) return Clutter.EVENT_PROPAGATE;

            let itemWidget = currentFocus;
            while (itemWidget && !itemWidget._itemId) {
                itemWidget = itemWidget.get_parent();
            }

            if (!itemWidget) return Clutter.EVENT_PROPAGATE;

            if (symbol === Clutter.KEY_Left || symbol === Clutter.KEY_Right) {
                return this._handleHorizontalNavigation(symbol, currentFocus, itemWidget);
            }

            if (symbol === Clutter.KEY_Up || symbol === Clutter.KEY_Down) {
                return this._handleVerticalNavigation(symbol, currentFocus, itemWidget);
            }

            return Clutter.EVENT_PROPAGATE;
        }

        /**
         * Handle horizontal arrow key navigation within a row.
         * @param {number} symbol Key symbol
         * @param {Clutter.Actor} currentFocus Currently focused actor
         * @param {St.Widget} itemWidget The row widget
         * @returns {number} Clutter event constant
         * @private
         */
        _handleHorizontalNavigation(symbol, currentFocus, itemWidget) {
            const focusables = [itemWidget._itemCheckbox, itemWidget, itemWidget._pinButton, itemWidget._deleteButton].filter((actor) => actor && actor.visible && actor.mapped);

            const currentIndex = focusables.indexOf(currentFocus);
            if (currentIndex === -1) return Clutter.EVENT_PROPAGATE;

            let nextIndex;
            if (symbol === Clutter.KEY_Left) {
                nextIndex = Math.max(0, currentIndex - 1);
            } else {
                nextIndex = Math.min(focusables.length - 1, currentIndex + 1);
            }

            if (nextIndex !== currentIndex) {
                focusables[nextIndex].grab_key_focus();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_STOP;
        }

        /**
         * Handle vertical arrow key navigation between rows.
         * @param {number} symbol Key symbol
         * @param {Clutter.Actor} currentFocus Currently focused actor
         * @param {St.Widget} itemWidget The row widget
         * @returns {number} Clutter event constant
         * @private
         */
        _handleVerticalNavigation(symbol, currentFocus, itemWidget) {
            const siblings = this.get_children();
            const currentRowIndex = siblings.indexOf(itemWidget);

            if (currentRowIndex === -1) return Clutter.EVENT_PROPAGATE;

            let nextRow;
            if (symbol === Clutter.KEY_Up) {
                if (currentRowIndex > 0) {
                    nextRow = siblings[currentRowIndex - 1];
                } else {
                    return Clutter.EVENT_PROPAGATE;
                }
            } else {
                if (currentRowIndex < siblings.length - 1) {
                    nextRow = siblings[currentRowIndex + 1];
                } else {
                    return Clutter.EVENT_PROPAGATE;
                }
            }

            if (nextRow) {
                let targetButton = nextRow;

                if (currentFocus === itemWidget._itemCheckbox) targetButton = nextRow._itemCheckbox;
                else if (currentFocus === itemWidget._pinButton) targetButton = nextRow._pinButton;
                else if (currentFocus === itemWidget._deleteButton) targetButton = nextRow._deleteButton;

                if (targetButton && targetButton.visible && targetButton.mapped) {
                    targetButton.grab_key_focus();
                } else {
                    nextRow.grab_key_focus();
                }

                if (this._scrollView) {
                    ensureActorVisibleInScrollView(this._scrollView, nextRow);
                }
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }

        /**
         * Focus the first item in the list.
         * @param {Function} [targetFinder] Optional function to find a specific child to focus
         * @returns {boolean} True if an item was focused
         */
        focusFirst(targetFinder) {
            const children = this.get_children();
            if (children.length > 0) {
                const first = children[0];
                this.focusItem(first, targetFinder);
                return true;
            }
            return false;
        }

        /**
         * Focus the last item in the list.
         * @param {Function} [targetFinder] Optional function to find a specific child to focus
         * @returns {boolean} True if an item was focused
         */
        focusLast(targetFinder) {
            const children = this.get_children();
            if (children.length > 0) {
                const last = children[children.length - 1];
                this.focusItem(last, targetFinder);
                return true;
            }
            return false;
        }

        /**
         * Clear all items from the layout.
         */
        clear() {
            this._items = [];
            this.destroy_all_children();
        }

        /**
         * Get the number of items currently in the layout.
         * @returns {number} Item count
         */
        getItemCount() {
            return this._items.length;
        }

        /**
         * Check if there are pending items waiting to be rendered.
         * @returns {boolean} Always false for StackLayout
         */
        hasPendingItems() {
            return false;
        }

        /**
         * Check if loading should be deferred.
         * @returns {boolean} Always false for StackLayout
         */
        shouldDeferLoading() {
            return false;
        }
    },
);
