import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import { ensureActorVisibleInScrollView } from 'resource:///org/gnome/shell/misc/animationUtils.js';

const StackVirtualization = {
    MIN_ITEMS: 120,
    ESTIMATED_ITEM_HEIGHT: 84,
    OVERSCAN_ITEMS: 20,
    FALLBACK_VIEWPORT_HEIGHT: 700,
};

/**
 * StackLayout
 * A vertical list container that supports atomic reconciliation.
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
            const {
                renderItemFn,
                updateItemFn,
                scrollView,
                virtualization = false,
                virtualMinItems = StackVirtualization.MIN_ITEMS,
                virtualEstimatedItemHeight = StackVirtualization.ESTIMATED_ITEM_HEIGHT,
                virtualOverscanItems = StackVirtualization.OVERSCAN_ITEMS,
                ...otherParams
            } = params;

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
            this._focusTimeoutId = 0;
            this._lastRenderSession = null;

            this._virtualizationEnabled = Boolean(virtualization);
            this._virtualMinItems = Math.max(1, virtualMinItems);
            this._virtualEstimatedItemHeight = Math.max(24, virtualEstimatedItemHeight);
            this._virtualOverscanItems = Math.max(1, virtualOverscanItems);
            this._virtualizationActive = false;
            this._virtualViewportTop = 0;
            this._virtualViewportHeight = 0;
            this._virtualWindowStart = 0;
            this._virtualWindowEnd = 0;
            this._virtualTopSpacer = null;
            this._virtualBottomSpacer = null;
        }

        /**
         * Append additional items without full reconciliation.
         * @param {Array<Object>} newItems Items to append
         * @param {Object} renderSession Optional session data
         */
        addItems(newItems, renderSession) {
            this._items = [...this._items, ...newItems];
            this._lastRenderSession = renderSession;

            if (this._shouldVirtualize(this._items.length)) {
                this._reconcileVirtualWindow(this._items, renderSession, true);
                return;
            }

            newItems.forEach((item) => {
                const widget = this._renderItemFn(item, renderSession);
                if (widget) {
                    if (!widget._itemId) widget._itemId = item.id;
                    this.add_child(widget);
                }
            });
        }

        /**
         * Reconcile the layout with a new list of items reusing existing widgets.
         * @param {Array<Object>} items New list of items to render
         * @param {Object} renderSession Optional session data passed to renderItemFn
         */
        reconcile(items, renderSession) {
            this._items = items;
            this._lastRenderSession = renderSession;

            if (this._shouldVirtualize(items.length)) {
                this._reconcileVirtualWindow(items, renderSession, true);
                return;
            }

            this._virtualizationActive = false;
            this._virtualWindowStart = 0;
            this._virtualWindowEnd = 0;
            this._removeVirtualSpacers();

            this._reconcileAllItems(items, renderSession);
        }

        /**
         * Reconcile all items when virtualization is disabled.
         * @param {Array<Object>} items Items to render
         * @param {Object} renderSession Optional render session
         * @private
         */
        _reconcileAllItems(items, renderSession) {
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
         * Update viewport metrics used by virtualized rendering.
         * @param {number} scrollTop Current vertical scroll offset
         * @param {number} viewportHeight Current viewport height
         */
        setViewport(scrollTop, viewportHeight) {
            if (!this._virtualizationEnabled) return;

            this._virtualViewportTop = Math.max(0, scrollTop || 0);
            this._virtualViewportHeight = Math.max(0, viewportHeight || 0);

            if (this._virtualizationActive) {
                this._reconcileVirtualWindow(this._items, this._lastRenderSession, false);
            }
        }

        /**
         * Focus a widget by item id. If virtualized and off-window, first shift the window.
         * @param {string} itemId Item id to focus
         * @param {Function} [targetFinder] Optional function to find a specific child to focus
         * @returns {boolean} True if the item was found and focused
         */
        focusByItemId(itemId, targetFinder) {
            if (!itemId) return false;

            if (this._virtualizationActive) {
                const index = this._items.findIndex((item) => item.id === itemId);
                if (index >= 0) {
                    const viewportHeight = this._virtualViewportHeight > 0 ? this._virtualViewportHeight : StackVirtualization.FALLBACK_VIEWPORT_HEIGHT;
                    const visibleCount = Math.max(1, Math.ceil(viewportHeight / this._virtualEstimatedItemHeight));
                    const targetStart = Math.max(0, index - Math.floor(visibleCount / 2));
                    this._virtualViewportTop = targetStart * this._virtualEstimatedItemHeight;
                    this._reconcileVirtualWindow(this._items, this._lastRenderSession, true);
                }
            }

            const widget = this._getItemChildren().find((child) => child._itemId === itemId);
            if (!widget) return false;
            this.focusItem(widget, targetFinder);
            return true;
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

        /**
         * Focus the first item in the list.
         * @param {Function} [targetFinder] Optional function to find a specific child to focus
         * @returns {boolean} True if an item was focused
         */
        focusFirst(targetFinder) {
            const children = this._getItemChildren();
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
            const children = this._getItemChildren();
            if (children.length > 0) {
                const last = children[children.length - 1];
                this.focusItem(last, targetFinder);
                return true;
            }
            return false;
        }

        /**
         * Focus a specific item widget with robust handling.
         * @param {St.Widget} widget The widget to focus
         * @param {Function} [targetFinder] Optional function to find a specific child to focus
         */
        focusItem(widget, targetFinder) {
            if (!widget) return;

            if (this._focusTimeoutId) {
                GLib.source_remove(this._focusTimeoutId);
                this._focusTimeoutId = 0;
            }

            this._focusTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 0, () => {
                this._focusTimeoutId = 0;
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
            const siblings = this._getItemChildren();
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
         * Return only item children (excludes virtualization spacers).
         * @returns {Array<St.Widget>}
         * @private
         */
        _getItemChildren() {
            return this.get_children().filter((child) => !!child._itemId);
        }

        /**
         * Whether virtualization should be enabled for current count.
         * @param {number} count Item count
         * @returns {boolean}
         * @private
         */
        _shouldVirtualize(count) {
            return this._virtualizationEnabled && count >= this._virtualMinItems;
        }

        /**
         * Reconcile only the currently visible virtualized window.
         * @param {Array<Object>} items All items
         * @param {Object} renderSession Optional render session
         * @param {boolean} force Force reconciliation even when range is unchanged
         * @private
         */
        _reconcileVirtualWindow(items, renderSession, force) {
            this._virtualizationActive = true;
            this._ensureVirtualSpacers();

            if (items.length === 0) {
                this._virtualWindowStart = 0;
                this._virtualWindowEnd = 0;
                this._setSpacerHeights(0, 0);
                this._getItemChildren().forEach((child) => child.destroy());
                return;
            }

            const window = this._calculateVirtualWindow(items.length);
            if (!force && this._virtualWindowStart === window.start && this._virtualWindowEnd === window.end) {
                this._setSpacerHeights(window.topPad, window.bottomPad);
                return;
            }

            const existingWidgets = new Map();
            this._getItemChildren().forEach((child) => {
                existingWidgets.set(child._itemId, child);
            });

            let visibleIndex = 0;
            for (let itemIndex = window.start; itemIndex < window.end; itemIndex++) {
                const item = items[itemIndex];
                let widget = existingWidgets.get(item.id);

                if (widget) {
                    existingWidgets.delete(item.id);
                    if (this._updateItemFn) {
                        this._updateItemFn(widget, item, renderSession);
                    }
                    const targetIndex = visibleIndex + 1; // after top spacer
                    if (this.get_child_at_index(targetIndex) !== widget) {
                        this.set_child_at_index(widget, targetIndex);
                    }
                } else {
                    widget = this._renderItemFn(item, renderSession);
                    if (!widget) continue;
                    if (!widget._itemId) widget._itemId = item.id;
                    this.insert_child_at_index(widget, visibleIndex + 1);
                }

                visibleIndex++;
            }

            existingWidgets.forEach((widget) => widget.destroy());
            this._placeVirtualSpacersAtEdges();
            this._setSpacerHeights(window.topPad, window.bottomPad);
            this._virtualWindowStart = window.start;
            this._virtualWindowEnd = window.end;

            this._updateEstimatedItemHeight();
        }

        /**
         * Ensure virtual spacers exist in the container.
         * @private
         */
        _ensureVirtualSpacers() {
            if (!this._virtualTopSpacer) {
                this._virtualTopSpacer = new St.Widget({
                    reactive: false,
                    can_focus: false,
                    x_expand: true,
                    y_expand: false,
                });
            }
            if (!this._virtualBottomSpacer) {
                this._virtualBottomSpacer = new St.Widget({
                    reactive: false,
                    can_focus: false,
                    x_expand: true,
                    y_expand: false,
                });
            }

            if (this._virtualTopSpacer.get_parent() !== this) {
                this.insert_child_at_index(this._virtualTopSpacer, 0);
            }
            if (this._virtualBottomSpacer.get_parent() !== this) {
                this.add_child(this._virtualBottomSpacer);
            }
            this._placeVirtualSpacersAtEdges();
        }

        /**
         * Keep virtual spacers as first and last children.
         * @private
         */
        _placeVirtualSpacersAtEdges() {
            if (!this._virtualTopSpacer || !this._virtualBottomSpacer) return;
            if (this._virtualTopSpacer.get_parent() !== this || this._virtualBottomSpacer.get_parent() !== this) return;

            if (this.get_child_at_index(0) !== this._virtualTopSpacer) {
                this.set_child_at_index(this._virtualTopSpacer, 0);
            }

            const lastIndex = this.get_n_children() - 1;
            if (lastIndex >= 0 && this.get_child_at_index(lastIndex) !== this._virtualBottomSpacer) {
                this.set_child_at_index(this._virtualBottomSpacer, lastIndex);
            }
        }

        /**
         * Remove and destroy virtual spacers.
         * @private
         */
        _removeVirtualSpacers() {
            if (this._virtualTopSpacer) {
                if (this._virtualTopSpacer.get_parent() === this) {
                    this.remove_child(this._virtualTopSpacer);
                }
                this._virtualTopSpacer.destroy();
                this._virtualTopSpacer = null;
            }

            if (this._virtualBottomSpacer) {
                if (this._virtualBottomSpacer.get_parent() === this) {
                    this.remove_child(this._virtualBottomSpacer);
                }
                this._virtualBottomSpacer.destroy();
                this._virtualBottomSpacer = null;
            }
        }

        /**
         * Set virtualization spacer heights.
         * @param {number} topPad Height of top spacer
         * @param {number} bottomPad Height of bottom spacer
         * @private
         */
        _setSpacerHeights(topPad, bottomPad) {
            if (this._virtualTopSpacer) this._virtualTopSpacer.height = Math.max(0, Math.round(topPad));
            if (this._virtualBottomSpacer) this._virtualBottomSpacer.height = Math.max(0, Math.round(bottomPad));
        }

        /**
         * Calculate the visible virtual window from viewport and estimate.
         * @param {number} totalItems Total item count
         * @returns {{start:number,end:number,topPad:number,bottomPad:number}}
         * @private
         */
        _calculateVirtualWindow(totalItems) {
            const estimatedHeight = Math.max(1, this._virtualEstimatedItemHeight);
            const viewportHeight = this._virtualViewportHeight > 0 ? this._virtualViewportHeight : StackVirtualization.FALLBACK_VIEWPORT_HEIGHT;
            const visibleCount = Math.max(1, Math.ceil(viewportHeight / estimatedHeight));
            const overscan = this._virtualOverscanItems;

            let start = Math.floor(this._virtualViewportTop / estimatedHeight) - overscan;
            if (!Number.isFinite(start)) start = 0;
            start = Math.max(0, start);
            start = Math.min(start, Math.max(0, totalItems - 1));

            let end = Math.min(totalItems, start + visibleCount + overscan * 2);
            if (end <= start) {
                end = Math.min(totalItems, start + visibleCount);
            }

            const topPad = start * estimatedHeight;
            const bottomPad = Math.max(0, (totalItems - end) * estimatedHeight);

            return { start, end, topPad, bottomPad };
        }

        /**
         * Gradually improve estimated row height using visible widgets.
         * @private
         */
        _updateEstimatedItemHeight() {
            const visibleItems = this._getItemChildren();
            if (visibleItems.length === 0) return;

            let sum = 0;
            let samples = 0;
            const spacing = this.spacing || 0;

            visibleItems.forEach((child) => {
                const [_min, nat] = child.get_preferred_height(-1);
                if (Number.isFinite(nat) && nat > 0) {
                    sum += nat + spacing;
                    samples++;
                }
            });

            if (samples === 0) return;
            const sampledAverage = sum / samples;
            if (!Number.isFinite(sampledAverage) || sampledAverage <= 0) return;

            this._virtualEstimatedItemHeight = Math.max(24, Math.round(this._virtualEstimatedItemHeight * 0.85 + sampledAverage * 0.15));
        }

        /**
         * Clear all items from the layout.
         */
        clear() {
            this._items = [];
            this._lastRenderSession = null;
            this._virtualizationActive = false;
            this._virtualWindowStart = 0;
            this._virtualWindowEnd = 0;
            this._virtualViewportTop = 0;
            this._virtualViewportHeight = 0;
            this._removeVirtualSpacers();
            this.destroy_all_children();
        }

        /**
         * Clean up resources on destruction.
         */
        destroy() {
            if (this._focusTimeoutId) {
                GLib.source_remove(this._focusTimeoutId);
                this._focusTimeoutId = 0;
            }

            this._removeVirtualSpacers();
            super.destroy();
        }
    },
);
