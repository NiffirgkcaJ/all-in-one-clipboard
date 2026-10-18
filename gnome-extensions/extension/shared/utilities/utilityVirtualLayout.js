import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import { FocusUtils } from './utilityFocus.js';
import { Logger } from './utilityLogger.js';
import { SpatialNavigator, VirtualizationEngine } from './utilityVirtualization.js';
import { easeAdjustment, getActorScrollOffset, getFocusedItemId } from './utilityLayout.js';

const VirtualLayoutTiming = {
    RELAYOUT_DEBOUNCE_MS: 100,
    RENDER_TIMEOUT_MS: 100,
    RECONCILE_ANIMATION_MS: 200,
};

/**
 * Base virtualized layout widget managing viewport tracking and child pooling.
 */
export const BaseVirtualLayout = GObject.registerClass(
    class BaseVirtualLayout extends St.Widget {
        // ========================================================================
        // Initialization
        // ========================================================================

        /**
         * Initialize the base virtual layout.
         *
         * @param {Object} params Configuration parameters.
         */
        constructor(params = {}) {
            const { spacing = 0, renderItemFn, updateItemFn, prepareItemFn, scrollView = null, virtualization = false, virtualOverscanPx, ...otherParams } = params;
            Logger.assert(typeof renderItemFn === 'function', 'A renderItemFn function is required.', 'BaseVirtualLayout', TypeError);
            Logger.assert(typeof spacing === 'number' && spacing >= 0, 'An explicit non-negative spacing number is required.', 'BaseVirtualLayout');
            if (virtualization) {
                Logger.assert(typeof virtualOverscanPx === 'number' && virtualOverscanPx > 0, 'A positive virtualOverscanPx is required.', 'BaseVirtualLayout');
            }

            super({
                x_expand: true,
                ...otherParams,
            });

            this._spacing = spacing;
            this._renderItemFn = renderItemFn;
            this._updateItemFn = updateItemFn;
            this._prepareItemFn = prepareItemFn || ((item) => item);
            this._scrollView = scrollView || null;

            this._items = [];
            this._pendingItems = [];
            this._lastRenderSession = null;
            this._lastLayoutWidth = -1;

            this._pendingAllocationId = 0;
            this._pendingTimeoutId = 0;
            this._relayoutTimeoutId = 0;
            this._reconcileIdleId = 0;
            this._scrollIdleId = 0;
            this._targetScrollTimeoutId = 0;
            this._focusTimeoutId = 0;

            this._targetScrollValue = null;
            this._pendingFocusItemId = null;
            this._pendingFocusTargetFinder = null;
            this._pendingRelayoutOnMap = false;
            this._renderGeneration = 0;

            this._virtualizationEnabled = Boolean(virtualization);
            this._virtualOverscanPx = virtualOverscanPx;
            this._virtualEngine = null;

            this.reactive = true;
            this._keyPressSignalId = this.connect('key-press-event', this.handleKeyPress.bind(this));
            this._notifyMappedId = this.connect('notify::mapped', () => this._flushPendingRelayoutOnMap());
            this._notifyVisibleId = this.connect('notify::visible', () => this._flushPendingRelayoutOnMap());
        }

        /**
         * Initialize virtualization engine from subclass.
         *
         * @param {VirtualizationEngine} engine Virtualization engine instance.
         * @protected
         */
        _initVirtualEngine(engine) {
            this._virtualEngine = engine;
        }

        // ========================================================================
        // Clutter Virtual Functions
        // ========================================================================

        /**
         * Handle allocation changes and position child widgets.
         *
         * @param {Clutter.ActorBox} box Allocation box.
         */
        vfunc_allocate(box) {
            const newWidth = box.get_width();
            this.set_allocation(box);

            const contentBox = this.get_theme_node().get_content_box(box);
            const effectiveWidth = Math.max(0, contentBox.x2 - contentBox.x1);

            if (newWidth > 0 && newWidth !== this._lastLayoutWidth) {
                this._lastLayoutWidth = newWidth;
                if (this._virtualEngine) {
                    this._virtualEngine.updateConfig({
                        geometryConfig: { effectiveWidth },
                    });
                }

                if (this._pendingItems.length > 0) {
                    const pending = this._pendingItems;
                    this._pendingItems = [];
                    this._cleanupPendingCallbacks();
                    this.addItems(pending, this._lastRenderSession);
                } else if (this._items.length > 0) {
                    this._scheduleRelayout();
                }
            }

            for (const child of this.get_children()) {
                const layout = child._virtualLayoutData;
                if (layout) {
                    let easingSaved = false;
                    if (child._shouldAnimate) {
                        child._shouldAnimate = false;
                        easingSaved = true;
                        child.save_easing_state();
                        child.set_easing_duration(VirtualLayoutTiming.RECONCILE_ANIMATION_MS);
                        child.set_easing_mode(Clutter.AnimationMode.EASE_OUT_QUAD);
                    }

                    const childBox = new Clutter.ActorBox();
                    childBox.x1 = contentBox.x1 + layout.x;
                    childBox.y1 = contentBox.y1 + layout.y;
                    childBox.x2 = childBox.x1 + (layout.width > 0 ? layout.width : effectiveWidth);
                    childBox.y2 = childBox.y1 + layout.height;
                    child.allocate(childBox);

                    if (easingSaved) {
                        child.restore_easing_state();
                    }
                } else {
                    const [, natW] = child.get_preferred_width(-1);
                    const [, natH] = child.get_preferred_height(natW);
                    const childBox = new Clutter.ActorBox();
                    childBox.x1 = contentBox.x1;
                    childBox.y1 = contentBox.y1;
                    childBox.x2 = contentBox.x1 + natW;
                    childBox.y2 = contentBox.y1 + natH;
                    child.allocate(childBox);
                }
            }
        }

        /**
         * Report preferred container width.
         *
         * @param {number} _forHeight Height constraint.
         * @returns {Array<number>} Minimum and natural width.
         */
        vfunc_get_preferred_width(_forHeight) {
            const width = this._lastLayoutWidth > 0 ? this._lastLayoutWidth : 0;
            return [0, width];
        }

        /**
         * Report preferred container height.
         *
         * @param {number} forWidth Width constraint.
         * @returns {Array<number>} Minimum and natural height.
         */
        vfunc_get_preferred_height(forWidth) {
            if (forWidth > 0 && forWidth !== this._lastLayoutWidth) {
                this._lastLayoutWidth = forWidth;
                const effectiveWidth = Math.max(0, forWidth - this._getHorizontalPadding());
                if (this._virtualEngine) {
                    this._virtualEngine.updateConfig({
                        geometryConfig: { effectiveWidth },
                    });
                    if (this._items.length > 0) {
                        this._virtualEngine.reconcileItems(this._items);
                    }
                }
            }

            const h = this._virtualEngine ? this._virtualEngine.getTotalHeight() : 0;
            return [h, h];
        }

        // ========================================================================
        // Public API
        // ========================================================================

        /**
         * Add items to the layout.
         *
         * @param {Array<Object>} items Array of item data objects.
         * @param {Object} renderSession Render session object.
         */
        addItems(items, renderSession) {
            this._lastRenderSession = renderSession;
            const prepped = items.map(this._prepareItemFn);

            if (!this._isValidWidth()) {
                this._deferRender(prepped, renderSession);
                return;
            }

            this._items.push(...prepped);
            if (this._virtualEngine) {
                this._virtualEngine.reconcileItems(this._items);
            }
        }

        /**
         * Reconcile layout with a new list of items.
         *
         * @param {Array<Object>} items New list of items.
         * @param {Object} renderSession Render session object.
         */
        reconcile(items, renderSession) {
            this._lastRenderSession = renderSession;
            const prepped = items.map(this._prepareItemFn);

            if (!this._isValidWidth()) {
                this.clear();
                this._deferRender(prepped, renderSession);
                return;
            }

            this._items = prepped;
            if (this._virtualEngine) {
                this._virtualEngine.reconcileItems(this._items);
            }
        }

        /**
         * Finish batch update.
         */
        finishBatch() {
            // Batch hook for layout interface.
        }

        /**
         * Set the current scroll viewport.
         *
         * @param {number} scrollTop Vertical scroll offset.
         * @param {number} viewportHeight Visible height of viewport.
         */
        setViewport(scrollTop, viewportHeight) {
            if (!this._virtualEngine) return;

            if (this._targetScrollValue !== null && Math.abs(scrollTop - this._targetScrollValue) < 1) {
                this._targetScrollValue = null;
            }

            const focusedId = this._pendingFocusItemId ? String(this._pendingFocusItemId) : getFocusedItemId(this);
            this._virtualEngine.setPinnedItemId(focusedId);

            const containerOffset = getActorScrollOffset(this._scrollView, this);
            const globalTop = Math.max(0, scrollTop || 0);
            const localTop = Math.max(0, globalTop - containerOffset);
            this._virtualEngine.setViewport(localTop, viewportHeight);
        }

        /**
         * Get the number of items in the layout.
         *
         * @returns {number} Item count.
         */
        getItemCount() {
            return this._items.length;
        }

        /**
         * Check if there are pending items waiting to render.
         *
         * @returns {boolean} True if pending items exist.
         */
        hasPendingItems() {
            return this._pendingItems.length > 0;
        }

        /**
         * Check if loading should be deferred.
         *
         * @returns {boolean} True if loading should wait.
         */
        shouldDeferLoading() {
            return !this._isValidWidth() || this.hasPendingItems();
        }

        /**
         * Check if layout has a valid allocated width.
         *
         * @returns {boolean} True if width is valid.
         */
        hasValidWidth() {
            return this._isValidWidth();
        }

        /**
         * Clear all items from the layout.
         */
        clear() {
            this._items = [];
            this._pendingItems = [];
            this._lastRenderSession = null;

            if (this._targetScrollTimeoutId) {
                GLib.source_remove(this._targetScrollTimeoutId);
                this._targetScrollTimeoutId = 0;
            }
            this._targetScrollValue = null;

            if (this._reconcileIdleId) {
                GLib.source_remove(this._reconcileIdleId);
                this._reconcileIdleId = 0;
            }

            if (this._scrollIdleId) {
                GLib.source_remove(this._scrollIdleId);
                this._scrollIdleId = 0;
            }

            this._cleanupPendingCallbacks();
            this._cancelScheduledRelayout();
            this._renderGeneration = (this._renderGeneration || 0) + 1;
            this._pendingRelayoutOnMap = false;

            if (this._virtualEngine) {
                this._virtualEngine.clear();
            }
            this.destroy_all_children();
            this.height = 0;
        }

        // ========================================================================
        // Focus & Navigation
        // ========================================================================

        /**
         * Scroll item into view and set up pending focus.
         *
         * @param {Object} targetData Target layout metadata.
         * @param {Function} [targetFinder] Optional target finder callback.
         * @protected
         */
        _scrollItemIntoView(targetData, targetFinder = null) {
            if (!targetData) return;

            // Viewport Calculations
            const adj = this._scrollView?.vadjustment;
            if (adj) {
                const currentSize = adj.page_size || this._scrollView.get_allocation_box().get_height();
                const currentOffset = getActorScrollOffset(this._scrollView, this);
                const currentTop = currentOffset + targetData.y;
                const currentBottom = currentTop + targetData.height;
                const currentScroll = typeof this._targetScrollValue === 'number' ? this._targetScrollValue : adj.value;

                const EDGE_PADDING_PX = 16;
                let scrollTarget = null;

                if (currentTop - EDGE_PADDING_PX < currentScroll) {
                    scrollTarget = Math.max(0, currentTop - EDGE_PADDING_PX);
                } else if (currentBottom + EDGE_PADDING_PX > currentScroll + currentSize) {
                    const maxScroll = Math.max(0, adj.upper - currentSize);
                    scrollTarget = Math.min(maxScroll, Math.max(0, currentBottom + EDGE_PADDING_PX - currentSize));
                }

                if (scrollTarget !== null && Math.abs(scrollTarget - currentScroll) >= 1) {
                    this._targetScrollValue = scrollTarget;
                    if (this._targetScrollTimeoutId) {
                        GLib.source_remove(this._targetScrollTimeoutId);
                        this._targetScrollTimeoutId = 0;
                    }
                    this._targetScrollTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
                        this._targetScrollValue = null;
                        this._targetScrollTimeoutId = 0;
                        return GLib.SOURCE_REMOVE;
                    });
                    easeAdjustment(adj, scrollTarget);
                }
            }

            // Focus Resolution
            const widget = this.get_children().find((child) => String(child._itemId) === String(targetData.id));
            if (widget) {
                this._applyFocus(widget, targetFinder);
                this._pendingFocusItemId = null;
                this._pendingFocusTargetFinder = null;
            } else {
                this._pendingFocusItemId = targetData.id;
                this._pendingFocusTargetFinder = targetFinder;
            }
        }

        /**
         * Apply keyboard focus directly to item or target finder result.
         *
         * @param {St.Widget} widget Target widget.
         * @param {Function} [targetFinder] Optional target finder callback.
         * @private
         */
        _applyFocus(widget, targetFinder = null) {
            if (!widget) return;

            if (widget._itemId && this._virtualEngine) {
                this._virtualEngine.setPinnedItemId(widget._itemId);
            }

            if (this._focusTimeoutId) {
                GLib.source_remove(this._focusTimeoutId);
                this._focusTimeoutId = 0;
            }

            let actualWidget = widget;
            if (targetFinder) {
                const found = targetFinder(widget);
                if (found) actualWidget = found;
            }

            if (actualWidget && actualWidget.visible && actualWidget.mapped) {
                actualWidget.grab_key_focus();
                return;
            }

            this._focusTimeoutId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._focusTimeoutId = 0;
                let deferredWidget = widget;
                if (targetFinder) {
                    const found = targetFinder(widget);
                    if (found) deferredWidget = found;
                }

                if (deferredWidget && deferredWidget.visible && deferredWidget.mapped) {
                    deferredWidget.grab_key_focus();
                } else if (widget && widget.visible && widget.mapped) {
                    widget.grab_key_focus();
                }

                return GLib.SOURCE_REMOVE;
            });
        }

        /**
         * Focus a widget by item identifier.
         *
         * @param {string|number} itemId Item identifier to focus.
         * @param {Function} [targetFinder] Optional function to find a specific child to focus.
         * @returns {boolean} True if item was found and focused.
         */
        focusByItemId(itemId, targetFinder = null) {
            if (!itemId || !this._virtualEngine) return false;

            const targetData = this._virtualEngine.getLayoutData().find((d) => String(d.id) === String(itemId));
            if (!targetData) return false;

            this._scrollItemIntoView(targetData, targetFinder);
            return true;
        }

        /**
         * Focus a specific item widget and ensure viewport visibility.
         *
         * @param {St.Widget} widget Widget to focus.
         * @param {Function} [targetFinder] Optional callback to find focusable target.
         */
        focusItem(widget, targetFinder = null) {
            if (!widget) return;

            const layoutData = widget._virtualLayoutData;
            if (layoutData) {
                this._scrollItemIntoView(layoutData, targetFinder);
                return;
            }

            this._applyFocus(widget, targetFinder);
        }

        /**
         * Handle tab key navigation across items.
         *
         * @param {Clutter.Event} _event Key press event.
         * @param {boolean} isBackwardTab Whether shift key was held.
         * @returns {number} Event response code.
         * @protected
         */
        _handleTabNavigation(_event, isBackwardTab) {
            let currentWidget = global.stage.get_key_focus();
            while (currentWidget && !currentWidget._itemId) {
                currentWidget = currentWidget.get_parent();
            }

            if (!currentWidget || !this.contains(currentWidget)) {
                return Clutter.EVENT_PROPAGATE;
            }

            if (this._items && this._items.length > 0) {
                const currentId = currentWidget._itemId;
                const itemIndex = this._items.findIndex((item) => String(item.id) === String(currentId));

                if (itemIndex !== -1) {
                    if (isBackwardTab) {
                        if (itemIndex > 0) {
                            return this.focusByItemId(this._items[itemIndex - 1].id) ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
                        }
                        return Clutter.EVENT_PROPAGATE;
                    }

                    if (itemIndex < this._items.length - 1) {
                        return this.focusByItemId(this._items[itemIndex + 1].id) ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
                    }
                    return Clutter.EVENT_PROPAGATE;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        }

        /**
         * Handle key press events for keyboard navigation.
         * Subclasses must override this method.
         *
         * @param {Clutter.Actor} _actor Actor receiving event.
         * @param {Clutter.Event} _event Key press event.
         * @returns {number} Event response code.
         */
        handleKeyPress(_actor, _event) {
            return Clutter.EVENT_PROPAGATE;
        }

        // ========================================================================
        // DOM Synchronization
        // ========================================================================

        /**
         * Synchronize virtual items with active DOM children.
         *
         * @param {Object} params Event parameters containing visibleItems and totalHeight.
         * @protected
         */
        _syncDOM({ visibleItems, totalHeight }) {
            const existingWidgets = new Map();
            this.get_children().forEach((child) => {
                if (child._itemId) {
                    existingWidgets.set(child._itemId, child);
                } else {
                    child.destroy();
                }
            });

            let visibleIndex = 0;
            visibleItems.forEach((itemData) => {
                const item = itemData.itemData;
                let widget = existingWidgets.get(item.id);

                if (widget) {
                    existingWidgets.delete(item.id);

                    const oldData = widget._virtualLayoutData;
                    const positionChanged = oldData && (oldData.x !== itemData.x || oldData.y !== itemData.y || oldData.width !== itemData.width || oldData.height !== itemData.height);

                    widget._virtualLayoutData = itemData;

                    let structureChanged = false;
                    if (this._updateItemFn) {
                        structureChanged = this._updateItemFn(widget, item, this._lastRenderSession);
                    }
                    if (positionChanged || structureChanged) widget._shouldAnimate = true;

                    if (this.get_child_at_index(visibleIndex) !== widget) {
                        this.set_child_at_index(widget, visibleIndex);
                    }
                } else {
                    widget = this._renderItemFn(item, this._lastRenderSession);
                    if (widget) {
                        if (!widget._itemId) widget._itemId = item.id;
                        widget._virtualLayoutData = itemData;
                        widget._shouldAnimate = true;
                        this.insert_child_at_index(widget, visibleIndex);
                    }
                }
                visibleIndex++;
            });

            existingWidgets.forEach((widget) => widget.destroy());

            if (Number.isFinite(totalHeight) && totalHeight >= 0) {
                this.height = totalHeight;
            }
            this.queue_relayout();

            if (this._pendingFocusItemId) {
                const pendingWidget = this._getItemChildren().find((c) => String(c._itemId) === String(this._pendingFocusItemId));
                if (pendingWidget) {
                    this._applyFocus(pendingWidget, this._pendingFocusTargetFinder);
                    this._pendingFocusItemId = null;
                    this._pendingFocusTargetFinder = null;
                }
            }
        }

        /**
         * Return only item children.
         *
         * @returns {Array<St.Widget>} The list of item children.
         * @protected
         */
        _getItemChildren() {
            return this.get_children().filter((child) => Boolean(child._itemId));
        }

        // ========================================================================
        // Deferral & Lifecycle Helpers
        // ========================================================================

        /**
         * Get total horizontal padding and margin for this container.
         *
         * @returns {number} Horizontal padding in pixels.
         * @private
         */
        _getHorizontalPadding() {
            const themeNode = this.get_theme_node();
            if (!themeNode) return 0;
            const padL = themeNode.get_padding(St.Side.LEFT);
            const padR = themeNode.get_padding(St.Side.RIGHT);
            const marL = themeNode.get_margin(St.Side.LEFT);
            const marR = themeNode.get_margin(St.Side.RIGHT);
            return padL + padR + marL + marR;
        }

        /**
         * Check if allocated width is valid for layout.
         *
         * @returns {boolean} True if width is valid.
         * @private
         */
        _isValidWidth() {
            if (this._lastLayoutWidth > 0) {
                return true;
            }
            if (this.width > 0) {
                this._lastLayoutWidth = this.width;
                const effectiveWidth = Math.max(0, this.width - this._getHorizontalPadding());
                if (this._virtualEngine) {
                    this._virtualEngine.updateConfig({
                        geometryConfig: { effectiveWidth },
                    });
                }
                return true;
            }
            return false;
        }

        /**
         * Defer rendering until valid allocated width is available.
         *
         * @param {Array<Object>} items Items to render.
         * @param {Object} renderSession Render session object.
         * @private
         */
        _deferRender(items, renderSession) {
            this._pendingItems.push(...items);

            if (this._pendingAllocationId || this._pendingTimeoutId) {
                return;
            }

            this._renderGeneration = (this._renderGeneration || 0) + 1;
            const currentGeneration = this._renderGeneration;

            const tryRender = () => {
                this._cleanupPendingCallbacks();
                if (currentGeneration !== this._renderGeneration) return;

                if (this._isValidWidth() && this._pendingItems.length > 0) {
                    const itemsToRender = this._pendingItems;
                    this._pendingItems = [];
                    this.addItems(itemsToRender, renderSession);
                }
            };

            this._pendingAllocationId = this.connect('notify::width', tryRender);

            this._pendingTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, VirtualLayoutTiming.RENDER_TIMEOUT_MS, () => {
                this._pendingTimeoutId = 0;
                tryRender();
                return GLib.SOURCE_REMOVE;
            });
        }

        /**
         * Clean up pending deferral callbacks.
         *
         * @private
         */
        _cleanupPendingCallbacks() {
            if (this._pendingTimeoutId) {
                GLib.source_remove(this._pendingTimeoutId);
                this._pendingTimeoutId = 0;
            }

            if (this._pendingAllocationId) {
                this.disconnect(this._pendingAllocationId);
                this._pendingAllocationId = 0;
            }
        }

        /**
         * Cancel scheduled relayout timeout.
         *
         * @private
         */
        _cancelScheduledRelayout() {
            if (!this._relayoutTimeoutId) return;
            GLib.source_remove(this._relayoutTimeoutId);
            this._relayoutTimeoutId = 0;
        }

        /**
         * Check if this actor and ancestors are visible.
         *
         * @returns {boolean} True if visible.
         * @private
         */
        _isEffectivelyVisible() {
            let actor = this;
            while (actor) {
                if (actor.visible === false) return false;
                actor = actor.get_parent();
            }
            return true;
        }

        /**
         * Check if widget is mapped and ready for relayout.
         *
         * @returns {boolean} True if ready.
         * @private
         */
        _canRelayoutNow() {
            return this.mapped && this.get_stage() !== null && this._isEffectivelyVisible();
        }

        /**
         * Schedule relayout after width change.
         *
         * @private
         */
        _scheduleRelayout() {
            if (!this._items.length) return;

            if (!this._canRelayoutNow()) {
                this._pendingRelayoutOnMap = true;
                return;
            }

            this._cancelScheduledRelayout();
            this._relayoutTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, VirtualLayoutTiming.RELAYOUT_DEBOUNCE_MS, () => {
                this._relayoutTimeoutId = 0;

                if (!this._items.length) {
                    return GLib.SOURCE_REMOVE;
                }

                if (!this._canRelayoutNow()) {
                    this._pendingRelayoutOnMap = true;
                    return GLib.SOURCE_REMOVE;
                }

                if (this._virtualEngine) {
                    this._virtualEngine.reconcileItems(this._items);
                }
                return GLib.SOURCE_REMOVE;
            });
        }

        /**
         * Flush pending relayout when widget becomes mapped.
         *
         * @private
         */
        _flushPendingRelayoutOnMap() {
            if (!this._pendingRelayoutOnMap || !this._canRelayoutNow()) return;
            this._pendingRelayoutOnMap = false;
            this._scheduleRelayout();
        }

        // ========================================================================
        // Lifecycle
        // ========================================================================

        /**
         * Clean up resources on destruction.
         */
        destroy() {
            if (this._targetScrollTimeoutId) {
                GLib.source_remove(this._targetScrollTimeoutId);
                this._targetScrollTimeoutId = 0;
            }
            this._targetScrollValue = null;

            if (this._reconcileIdleId) {
                GLib.source_remove(this._reconcileIdleId);
                this._reconcileIdleId = 0;
            }

            if (this._scrollIdleId) {
                GLib.source_remove(this._scrollIdleId);
                this._scrollIdleId = 0;
            }

            if (this._focusTimeoutId) {
                GLib.source_remove(this._focusTimeoutId);
                this._focusTimeoutId = 0;
            }

            if (this._pendingTimeoutId) {
                GLib.source_remove(this._pendingTimeoutId);
                this._pendingTimeoutId = 0;
            }

            if (this._relayoutTimeoutId) {
                GLib.source_remove(this._relayoutTimeoutId);
                this._relayoutTimeoutId = 0;
            }

            if (this._pendingAllocationId) {
                this.disconnect(this._pendingAllocationId);
                this._pendingAllocationId = 0;
            }

            if (this._keyPressSignalId) {
                this.disconnect(this._keyPressSignalId);
                this._keyPressSignalId = 0;
            }

            if (this._notifyMappedId) {
                this.disconnect(this._notifyMappedId);
                this._notifyMappedId = 0;
            }

            if (this._notifyVisibleId) {
                this.disconnect(this._notifyVisibleId);
                this._notifyVisibleId = 0;
            }

            this._pendingRelayoutOnMap = false;

            if (this._virtualEngine) {
                this._virtualEngine.dispose();
            }
            this.destroy_all_children();
            super.destroy();
        }
    },
);

/**
 * Masonry layout widget with directional navigation and columnar virtualization.
 */
export const MasonryLayout = GObject.registerClass(
    class MasonryLayout extends BaseVirtualLayout {
        // ========================================================================
        // Initialization
        // ========================================================================

        /**
         * Initialize the masonry layout.
         *
         * @param {Object} params Configuration parameters.
         */
        constructor(params) {
            const { columns, maxColumns = null, targetItemWidth, ...baseParams } = params;
            const hasColumns = (typeof targetItemWidth === 'number' && targetItemWidth > 0) || (typeof columns === 'number' && columns > 0);
            Logger.assert(hasColumns, 'Either targetItemWidth or columns count is required.', 'MasonryLayout');

            super(baseParams);

            this._columns = columns;
            this._maxColumns = typeof maxColumns === 'number' && maxColumns > 0 ? maxColumns : null;
            this._targetItemWidth = targetItemWidth;

            const overscan = this._virtualizationEnabled ? baseParams.virtualOverscanPx : Number.MAX_SAFE_INTEGER;
            this._initVirtualEngine(
                new VirtualizationEngine({
                    mode: 'columnar',
                    geometryConfig: {
                        columns: this._columns,
                        spacing: this._spacing,
                        paddingLeft: 0,
                        targetItemWidth: this._targetItemWidth,
                        maxColumns: this._maxColumns,
                        effectiveWidth: 0,
                    },
                    overscanPx: overscan,
                    onVisibleItemsChanged: this._syncDOM.bind(this),
                }),
            );
        }

        // ========================================================================
        // Public API
        // ========================================================================

        /**
         * Set the maximum number of columns.
         *
         * @param {number|null} maxColumns Maximum columns or null for unlimited.
         */
        setMaxColumns(maxColumns) {
            const normalized = typeof maxColumns === 'number' && maxColumns > 0 ? maxColumns : null;
            if (this._maxColumns === normalized) return;
            this._maxColumns = normalized;

            if (this._virtualEngine) {
                this._virtualEngine.updateConfig({
                    geometryConfig: { maxColumns: this._maxColumns },
                });
            }

            if (this._items.length > 0 && this._isValidWidth()) {
                this._scheduleRelayout();
            }
        }

        // ========================================================================
        // Focus & Navigation
        // ========================================================================

        /**
         * Focus the first item in the layout.
         *
         * @param {number} [targetCenterX] Optional target horizontal center.
         * @returns {boolean} True if an item was focused.
         */
        focusFirst(targetCenterX) {
            if (!this._virtualEngine) return false;
            const target = SpatialNavigator.findFirst(this._virtualEngine.getLayoutData(), targetCenterX);
            if (!target) return false;

            this._scrollItemIntoView(target);
            return true;
        }

        /**
         * Focus the last item in the layout.
         *
         * @param {number} [targetCenterX] Optional target horizontal center.
         * @returns {boolean} True if an item was focused.
         */
        focusLast(targetCenterX) {
            if (!this._virtualEngine) return false;
            const target = SpatialNavigator.findLast(this._virtualEngine.getLayoutData(), targetCenterX);
            if (!target) return false;

            this._scrollItemIntoView(target);
            return true;
        }

        /**
         * Handle key press events for keyboard navigation.
         *
         * @param {Clutter.Actor} _actor Actor receiving event.
         * @param {Clutter.Event} event Key press event.
         * @returns {number} Event response code.
         */
        handleKeyPress(_actor, event) {
            const tabNav = FocusUtils.getTabNavigation(event);
            if (tabNav.isTab) {
                return this._handleTabNavigation(event, tabNav.isBackward);
            }

            const direction = this._getDirection(event);
            if (!direction) return Clutter.EVENT_PROPAGATE;

            return this._handleDirectionNavigation(direction);
        }

        /**
         * Resolve direction string from keyboard event.
         *
         * @param {Clutter.Event} event Key press event.
         * @returns {string|null} Direction string or null.
         * @private
         */
        _getDirection(event) {
            if (FocusUtils.isKey(event, 'Up')) return 'up';
            if (FocusUtils.isKey(event, 'Down')) return 'down';
            if (FocusUtils.isKey(event, 'Left')) return 'left';
            if (FocusUtils.isKey(event, 'Right')) return 'right';
            return null;
        }

        /**
         * Route directional arrow navigation to SpatialNavigator.
         *
         * @param {string} direction Direction string.
         * @returns {number} Event response code.
         * @private
         */
        _handleDirectionNavigation(direction) {
            let currentWidget = global.stage.get_key_focus();
            while (currentWidget && !currentWidget._itemId) {
                currentWidget = currentWidget.get_parent();
            }
            if (!currentWidget || !this.contains(currentWidget) || !this._virtualEngine) {
                return Clutter.EVENT_PROPAGATE;
            }

            const layoutData = this._virtualEngine.getLayoutData();
            const nextTarget = SpatialNavigator.findInDirection(layoutData, currentWidget._itemId, direction);

            if (!nextTarget) {
                if (direction === 'up' || direction === 'down') return Clutter.EVENT_PROPAGATE;
                return Clutter.EVENT_STOP;
            }

            this._scrollItemIntoView(nextTarget);
            return Clutter.EVENT_STOP;
        }
    },
);

/**
 * Linear vertical stack layout widget with intra-row navigation.
 */
export const StackLayout = GObject.registerClass(
    class StackLayout extends BaseVirtualLayout {
        // ========================================================================
        // Initialization
        // ========================================================================

        /**
         * Initialize the stack layout.
         *
         * @param {Object} params Configuration parameters.
         */
        constructor(params) {
            const { calculateItemHeight = null, ...baseParams } = params;

            super(baseParams);

            this._calculateItemHeight = calculateItemHeight;

            const overscan = this._virtualizationEnabled ? baseParams.virtualOverscanPx : Number.MAX_SAFE_INTEGER;
            this._initVirtualEngine(
                new VirtualizationEngine({
                    mode: 'linear',
                    geometryConfig: {
                        calculateItemHeight: this._calculateItemHeight,
                        spacing: this._spacing,
                    },
                    overscanPx: overscan,
                    onVisibleItemsChanged: this._syncDOM.bind(this),
                }),
            );
        }

        // ========================================================================
        // Focus & Navigation
        // ========================================================================

        /**
         * Focus the first item in the list.
         *
         * @param {Function} [targetFinder] Optional function to find a specific child to focus.
         * @returns {boolean} True if an item was focused.
         */
        focusFirst(targetFinder = null) {
            if (this._items.length === 0) return false;
            return this.focusByItemId(this._items[0].id, targetFinder);
        }

        /**
         * Focus the last item in the list.
         *
         * @param {Function} [targetFinder] Optional function to find a specific child to focus.
         * @returns {boolean} True if an item was focused.
         */
        focusLast(targetFinder = null) {
            if (this._items.length === 0) return false;
            return this.focusByItemId(this._items[this._items.length - 1].id, targetFinder);
        }

        /**
         * Handle key press events for stack navigation.
         *
         * @param {Clutter.Actor} _actor The actor that received the event.
         * @param {Clutter.Event} event The key press event.
         * @returns {number} Clutter event constant.
         */
        handleKeyPress(_actor, event) {
            const currentFocus = global.stage.get_key_focus();
            if (!this.contains(currentFocus)) return Clutter.EVENT_PROPAGATE;

            let itemWidget = currentFocus;
            while (itemWidget && !itemWidget._itemId) {
                itemWidget = itemWidget.get_parent();
            }
            if (!itemWidget) return Clutter.EVENT_PROPAGATE;

            const tabNav = FocusUtils.getTabNavigation(event);
            if (tabNav.isTab) {
                return this._handleTabNavigation(event, tabNav.isBackward);
            }

            if (FocusUtils.isKey(event, 'Left') || FocusUtils.isKey(event, 'Right')) {
                return this._handleHorizontalNavigation(FocusUtils.isKey(event, 'Left'), currentFocus, itemWidget);
            }

            if (FocusUtils.isKey(event, 'Up') || FocusUtils.isKey(event, 'Down')) {
                return this._handleVerticalNavigation(FocusUtils.isKey(event, 'Up'), currentFocus, itemWidget);
            }

            return Clutter.EVENT_PROPAGATE;
        }

        /**
         * Handle horizontal arrow key navigation within a row.
         *
         * @param {boolean} isLeft True if navigating left and false for right.
         * @param {Clutter.Actor} currentFocus Currently focused actor.
         * @param {St.Widget} itemWidget The row widget.
         * @returns {number} Clutter event constant.
         * @private
         */
        _handleHorizontalNavigation(isLeft, currentFocus, itemWidget) {
            const focusables = itemWidget.getFocusables ? itemWidget.getFocusables() : [itemWidget];

            const currentIndex = focusables.indexOf(currentFocus);
            if (currentIndex === -1) return Clutter.EVENT_PROPAGATE;

            const nextIndex = isLeft ? Math.max(0, currentIndex - 1) : Math.min(focusables.length - 1, currentIndex + 1);

            if (nextIndex !== currentIndex) {
                focusables[nextIndex].grab_key_focus();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_STOP;
        }

        /**
         * Handle vertical arrow key navigation between rows.
         *
         * @param {boolean} isUp True if navigating up and false for down.
         * @param {Clutter.Actor} currentFocus Currently focused actor.
         * @param {St.Widget} itemWidget The row widget.
         * @returns {number} Clutter event constant.
         * @private
         */
        _handleVerticalNavigation(isUp, currentFocus, itemWidget) {
            const currentGlobalIndex = this._items.findIndex((i) => String(i.id) === String(itemWidget?._itemId));
            if (currentGlobalIndex === -1) return Clutter.EVENT_PROPAGATE;

            const nextGlobalIndex = isUp ? currentGlobalIndex - 1 : currentGlobalIndex + 1;
            if (nextGlobalIndex < 0 || nextGlobalIndex >= this._items.length) {
                return Clutter.EVENT_PROPAGATE;
            }

            if (!this._virtualEngine) return Clutter.EVENT_PROPAGATE;
            const layoutData = this._virtualEngine.getLayoutData()[nextGlobalIndex];
            if (!layoutData) return Clutter.EVENT_PROPAGATE;

            const finder = (targetRow) => {
                if (targetRow.findMatchingFocus) {
                    return targetRow.findMatchingFocus(currentFocus);
                }
                return targetRow;
            };

            this._scrollItemIntoView(layoutData, finder);
            return Clutter.EVENT_STOP;
        }
    },
);
