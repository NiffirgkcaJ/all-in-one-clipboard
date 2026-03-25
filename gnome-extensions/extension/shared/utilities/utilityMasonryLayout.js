import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import { ensureActorVisibleInScrollView } from 'resource:///org/gnome/shell/misc/animationUtils.js';

const MasonryDefaults = {
    COLUMNS: 4,
    SPACING: 2,
};

const MasonryDimensions = {
    PADDING: 8,
    MIN_VALID_WIDTH: 32,
};

const MasonryTiming = {
    RELAYOUT_DEBOUNCE_MS: 100,
    RENDER_TIMEOUT_MS: 100,
    RECONCILE_ANIMATION_MS: 200,
};

const MasonryNavigation = {
    EDGE_TOLERANCE: 2,
    COLUMN_TOLERANCE: 20,
    HORIZONTAL_WEIGHT: 5,
};

const MasonryVirtualization = {
    MIN_ITEMS: 120,
    OVERSCAN_PX: 1200,
    FALLBACK_VIEWPORT_HEIGHT: 700,
    WIDGET_CACHE_LIMIT: 480,
    NAV_PREFETCH_RADIUS: 4,
};

/**
 * MasonryLayout
 * A self navigating Pinterest style masonry layout widget.
 * Items are distributed across columns with the shortest column always receiving the next item.
 * Automatically updates layout when width changes.
 * @example
 * const masonry = new MasonryLayout({
 *     columns: 4,
 *     spacing: 2,
 *     maxColumns: 6,
 *     renderItemFn: (itemData, session) => createItemWidget(itemData)
 * });
 * masonry.addItems(myItemsArray, renderSession);
 */
export const MasonryLayout = GObject.registerClass(
    class MasonryLayout extends St.Widget {
        /**
         * Initialize the masonry layout.
         * @param {object} params Configuration parameters
         * @param {number} [params.columns=4] Number of columns to display
         * @param {number} [params.maxColumns] Optional maximum number of columns when auto-sizing
         * @param {number} [params.spacing=2] Spacing between items in pixels
         * @param {number} [params.targetItemWidth] Target item width for auto column calculation
         * @param {Function} params.renderItemFn Function to render each item
         * @param {St.ScrollView} [params.scrollView] Optional scroll view for auto-scroll on focus
         */
        constructor(params) {
            super({ x_expand: true });

            const {
                columns = MasonryDefaults.COLUMNS,
                maxColumns = null,
                targetItemWidth,
                spacing = MasonryDefaults.SPACING,
                renderItemFn,
                updateItemFn,
                prepareItemFn,
                scrollView,
                virtualization = false,
                virtualMinItems = MasonryVirtualization.MIN_ITEMS,
                virtualOverscanPx = MasonryVirtualization.OVERSCAN_PX,
            } = params;

            this._columns = columns;
            this._maxColumns = typeof maxColumns === 'number' && maxColumns > 0 ? maxColumns : null;
            this._targetItemWidth = targetItemWidth;
            this._spacing = spacing;
            this._renderItemFn = renderItemFn;
            this._updateItemFn = updateItemFn;
            this._prepareItemFn = prepareItemFn || ((item) => item);
            this._scrollView = scrollView || null;
            this._columnHeights = new Array(this._columns).fill(0);
            this._items = [];
            this._layoutEntries = [];
            this._layoutEntryById = new Map();
            this._itemIds = [];
            this._itemIndexById = new Map();
            this._lastRenderSession = null;
            this._lastLayoutWidth = -1;
            this._lockedColumnWidth = -1;
            this._pendingRelayout = false;
            this._pendingAllocationId = null;
            this._pendingTimeoutId = null;
            this._relayoutTimeoutId = 0;
            this._spatialMap = [];
            this._spatialMapDirty = false;
            this._pendingItems = [];
            this._focusTimeoutId = 0;
            this._pendingRelayoutOnMap = false;
            this._virtualizationEnabled = Boolean(virtualization);
            this._virtualMinItems = Math.max(1, virtualMinItems);
            this._virtualOverscanPx = Math.max(0, virtualOverscanPx);
            this._virtualizationActive = false;
            this._virtualViewportTop = 0;
            this._virtualViewportHeight = 0;
            this._virtualWidgetCache = new Map();
            this._virtualWidgetCacheLimit = MasonryVirtualization.WIDGET_CACHE_LIMIT;

            this.reactive = true;
            this.connect('key-press-event', this.handleKeyPress.bind(this));
            this.connect('notify::mapped', () => this._flushPendingRelayoutOnMap());
            this.connect('notify::visible', () => this._flushPendingRelayoutOnMap());
        }

        /**
         * Handle allocation changes and manually allocate each child.
         * @param {Clutter.ActorBox} box The allocation box
         */
        vfunc_allocate(box) {
            this.set_allocation(box);
            const newWidth = box.get_width();

            if (this._lastLayoutWidth !== newWidth && this._lastLayoutWidth > 0) {
                if (this._items.length > 0) {
                    if (this._lockedColumnWidth > 0) {
                        this._lockedColumnWidth = -1;
                        this._pendingRelayout = false;
                    }
                    this._lastLayoutWidth = newWidth;
                    this._scheduleRelayout();
                }
            }
            this._lastLayoutWidth = newWidth;

            for (const child of this.get_children()) {
                const layout = child._masonryData;
                if (layout) {
                    if (this._virtualizationActive && !child.visible) {
                        continue;
                    }

                    let easingSaved = false;
                    if (child._shouldAnimate) {
                        child._shouldAnimate = false;
                        easingSaved = true;
                        child.save_easing_state();
                        child.set_easing_duration(MasonryTiming.RECONCILE_ANIMATION_MS);
                        child.set_easing_mode(Clutter.AnimationMode.EASE_OUT_QUAD);
                    }

                    const childBox = new Clutter.ActorBox();
                    childBox.x1 = layout.x;
                    childBox.y1 = layout.y;
                    childBox.x2 = layout.x + layout.width;
                    childBox.y2 = layout.y + layout.height;
                    child.allocate(childBox);

                    if (easingSaved) {
                        child.restore_easing_state();
                    }
                } else {
                    const [_minW, natW] = child.get_preferred_width(-1);
                    const [_minH, natH] = child.get_preferred_height(natW);
                    const childBox = new Clutter.ActorBox();
                    childBox.x1 = 0;
                    childBox.y1 = 0;
                    childBox.x2 = natW;
                    childBox.y2 = natH;
                    child.allocate(childBox);
                }
            }
        }

        /**
         * Report the allocated width as our preferred width.
         * @param {number} _forHeight Height to compute width for
         * @returns {[number, number]} Minimum and natural width
         */
        vfunc_get_preferred_width(_forHeight) {
            const width = this._lastLayoutWidth > 0 ? this._lastLayoutWidth : 0;
            // Allow the parent to shrink this actor when the available width changes.
            return [0, width];
        }

        /**
         * Update the maximum number of columns and trigger a relayout.
         * @param {number|null} maxColumns Maximum columns, or null to remove the cap
         */
        setMaxColumns(maxColumns) {
            const normalized = typeof maxColumns === 'number' && maxColumns > 0 ? maxColumns : null;
            if (this._maxColumns === normalized) return;
            this._maxColumns = normalized;
            this._lockedColumnWidth = -1;
            this._pendingRelayout = false;
            if (this._items.length > 0) {
                this._scheduleRelayout();
            } else {
                this.queue_relayout();
            }
        }

        /**
         * Add items to the masonry layout.
         * @param {Array<object>} items Array of item data objects
         * @param {object} renderSession Session object for tracking async operations
         */
        addItems(items, renderSession) {
            if (!this._isValidWidth()) {
                this._deferRender(items, renderSession);
                return;
            }

            const nextCount = this._items.length + items.length;
            if (this._shouldVirtualize(nextCount)) {
                const mergedItems = [...this._items, ...items];
                this.reconcile(mergedItems, renderSession);
                return;
            }

            const effectiveWidth = this._calculateEffectiveWidth();
            if (!this._isValidEffectiveWidth(effectiveWidth)) {
                return;
            }

            let columnWidth;
            if (this._lockedColumnWidth > 0) {
                columnWidth = this._lockedColumnWidth;
            } else {
                columnWidth = this._calculateColumnWidth(effectiveWidth);
                this._lockedColumnWidth = columnWidth;

                const newColumns = this._calculateColumns(effectiveWidth);
                if (this._columns !== newColumns) {
                    this._columns = newColumns;
                    this._columnHeights = new Array(this._columns).fill(0);
                }
            }

            if (!this._isValidColumnWidth(columnWidth)) {
                return;
            }

            this._lastRenderSession = renderSession;
            this._renderItems(items, columnWidth, renderSession);
            this._updateContainerHeight();
            this._markSpatialMapDirty();
            this._applyViewportCulling(false);
        }

        /**
         * Reconcile the layout with a new list of items reusing existing widgets.
         * @param {Array<object>} items New list of items to render
         * @param {object} renderSession Render session object
         */
        reconcile(items, renderSession) {
            if (!this._isValidWidth()) {
                this.clear();
                this._deferRender(items, renderSession);
                return;
            }

            const effectiveWidth = this._calculateEffectiveWidth();
            if (!this._isValidEffectiveWidth(effectiveWidth)) return;

            const columnWidth = this._calculateColumnWidth(effectiveWidth);
            if (!this._isValidColumnWidth(columnWidth)) return;

            this._lastRenderSession = renderSession;
            const newCols = this._calculateColumns(effectiveWidth);
            this._columns = newCols;
            this._lockedColumnWidth = columnWidth;
            const useVirtualization = this._shouldVirtualize(items.length);
            this._clearVirtualWidgetCache();

            const existingWidgets = new Map();
            for (const child of this.get_children()) {
                if (child._itemId) {
                    existingWidgets.set(child._itemId, child);
                } else {
                    child.destroy();
                }
            }

            this._items = [];
            this._layoutEntries = [];
            this._layoutEntryById = new Map();
            this._itemIds = [];
            this._itemIndexById = new Map();
            this._columnHeights = new Array(this._columns).fill(0);
            this._spatialMap = [];

            const paddingLeft = MasonryDimensions.PADDING;

            for (let itemData of items) {
                this._layoutReconcileItem(itemData, {
                    columnWidth,
                    paddingLeft,
                    existingWidgets,
                    useVirtualization,
                    renderSession,
                });
            }

            if (useVirtualization) {
                this._virtualizationActive = true;
                this._reconcileVirtualWindow(existingWidgets, renderSession, true, true);
            } else {
                this._virtualizationActive = false;
                for (const widget of existingWidgets.values()) {
                    widget.destroy();
                }
            }

            this._updateContainerHeight();
            this._markSpatialMapDirty();
            this._applyViewportCulling(true);
            this.queue_relayout();
        }

        /**
         * Reconcile a single item and optionally upsert its widget.
         * @param {object} itemData Raw item data
         * @param {object} options Reconciliation options
         * @private
         */
        _layoutReconcileItem(itemData, options) {
            const { columnWidth, paddingLeft, existingWidgets, useVirtualization, renderSession } = options;

            itemData = this._prepareItemFn(itemData);
            this._items.push(itemData);
            if (!this._hasValidDimensions(itemData)) return;

            const itemHeight = this._calculateItemHeight(itemData, columnWidth);
            if (!this._isValidItemHeight(itemHeight)) return;

            const shortestColumnIndex = this._findShortestColumn();
            const x = paddingLeft + shortestColumnIndex * (columnWidth + this._spacing);
            const y = this._columnHeights[shortestColumnIndex];
            const layoutData = { x, y, width: columnWidth, height: itemHeight };

            const entry = {
                itemId: itemData.id,
                itemData,
                layoutData,
            };
            this._layoutEntries.push(entry);
            this._layoutEntryById.set(itemData.id, entry);
            this._itemIndexById.set(itemData.id, this._itemIds.length);
            this._itemIds.push(itemData.id);

            if (!useVirtualization) {
                this._upsertReconciledWidget(itemData, layoutData, existingWidgets, renderSession);
            }

            this._updateColumnHeight(shortestColumnIndex, itemHeight);
        }

        /**
         * Update or create a masonry widget for a reconciled item.
         * @param {object} itemData Prepared item data
         * @param {object} layoutData Masonry layout data
         * @param {Map<string,St.Widget>} existingWidgets Existing widgets by id
         * @param {object} renderSession Render session object
         * @private
         */
        _upsertReconciledWidget(itemData, layoutData, existingWidgets, renderSession) {
            let itemWidget = existingWidgets.get(itemData.id);
            if (itemWidget) {
                existingWidgets.delete(itemData.id);
                let structureChanged = false;
                if (this._updateItemFn) {
                    structureChanged = this._updateItemFn(itemWidget, itemData, renderSession);
                }

                const oldData = itemWidget._masonryData;
                const positionChanged = oldData && (oldData.x !== layoutData.x || oldData.y !== layoutData.y || oldData.width !== layoutData.width || oldData.height !== layoutData.height);

                // Delete old layout data to force a clean allocation pass if inner contents were completely rebuilt.
                if (structureChanged) {
                    itemWidget._masonryData = null;
                    itemWidget.queue_relayout();
                }

                itemWidget._masonryData = layoutData;
                if (positionChanged || structureChanged) itemWidget._shouldAnimate = true;
                return;
            }

            itemWidget = this._renderItemFn(itemData, renderSession);
            if (!itemWidget) return;
            itemWidget._itemId = itemData.id;
            itemWidget._masonryData = layoutData;
            this.add_child(itemWidget);
        }

        /**
         * Signal that a batch sequence is complete.
         */
        finishBatch() {
            this._lockedColumnWidth = -1;
            if (this._pendingRelayout) {
                this._pendingRelayout = false;
                this._relayout();
            }
        }

        /**
         * Get the number of items that have been rendered.
         * @returns {number} The number of rendered items
         */
        getItemCount() {
            return this._items.length;
        }

        /**
         * Check if there are pending items waiting to be rendered.
         * @returns {boolean} True if there are pending deferred items
         */
        hasPendingItems() {
            return this._pendingItems.length > 0;
        }

        /**
         * Check if loading should be deferred.
         * @returns {boolean} True if loading should be deferred
         */
        shouldDeferLoading() {
            return !this._isValidWidth() || this.hasPendingItems();
        }

        /**
         * Public method to check if width is valid for rendering.
         * @returns {boolean} True if width is valid
         */
        hasValidWidth() {
            return this._isValidWidth();
        }

        /**
         * Update viewport metrics used for masonry viewport culling.
         * @param {number} scrollTop Current vertical scroll offset
         * @param {number} viewportHeight Current viewport height
         */
        setViewport(scrollTop, viewportHeight) {
            if (!this._virtualizationEnabled) return;

            this._virtualViewportTop = this._resolveLocalViewportTop(scrollTop);
            this._virtualViewportHeight = Math.max(0, viewportHeight || 0);
            this._applyViewportCulling(false);
        }

        /**
         * Refresh virtual viewport values from the owning scroll adjustment.
         * @private
         */
        _refreshViewportFromScrollView() {
            const adjustment = this._scrollView?.vadjustment;
            if (!adjustment) return;

            this._virtualViewportTop = this._resolveLocalViewportTop(adjustment.value);
            this._virtualViewportHeight = Math.max(0, adjustment.page_size || 0);
        }

        /**
         * Convert global scroll offset into this layout's local coordinate space.
         * @param {number} scrollTop Global scroll offset
         * @returns {number} Local viewport top offset
         * @private
         */
        _resolveLocalViewportTop(scrollTop) {
            const globalTop = Math.max(0, scrollTop || 0);
            const allocation = this.get_allocation_box?.();
            if (!allocation) return globalTop;
            return Math.max(0, globalTop - allocation.y1);
        }

        /**
         * Focus an item by id, making it visible first if viewport culling is active.
         * @param {string} itemId Item id to focus
         * @returns {boolean} True if item was found and focused
         */
        focusByItemId(itemId) {
            if (!itemId) return false;

            let target = this.get_children().find((child) => child._itemId === itemId);
            if (!target && this._virtualizationActive) {
                const entry = this._layoutEntryById.get(itemId);
                if (!entry) return false;

                const viewportHeight = this._virtualViewportHeight > 0 ? this._virtualViewportHeight : MasonryVirtualization.FALLBACK_VIEWPORT_HEIGHT;
                this._virtualViewportTop = Math.max(0, entry.layoutData.y - viewportHeight * 0.4);
                this._applyViewportCulling(true);
                target = this.get_children().find((child) => child._itemId === itemId);
            }

            if (!target) return false;
            this.focusItem(target);
            return true;
        }

        /**
         * Focus the first item in the masonry layout.
         * @param {number} [targetCenterX] X position to find item in same column
         */
        focusFirst(targetCenterX) {
            const children = this._getItemChildren(true);
            if (children.length === 0) return;

            let target = children[0];

            if (targetCenterX !== undefined) {
                const topRowItems = children.filter((w) => w._masonryData.y === 0);
                let bestMatch = null;
                let minDistance = Infinity;

                for (const item of topRowItems) {
                    const data = item._masonryData;
                    const itemCenterX = data.x + data.width / 2;
                    const distance = Math.abs(itemCenterX - targetCenterX);
                    if (distance < minDistance) {
                        minDistance = distance;
                        bestMatch = item;
                    }
                }
                if (bestMatch) target = bestMatch;
            }

            this.focusItem(target);
        }

        /**
         * Focus the last item in the masonry layout.
         * @param {number} [targetCenterX] X position to find item in same column
         */
        focusLast(targetCenterX) {
            const children = this._getItemChildren(true);
            if (children.length === 0) return;

            let target = children[children.length - 1];

            if (targetCenterX !== undefined) {
                let bestMatch = null;
                let bestY = -Infinity;
                let minXDistance = Infinity;

                for (const item of children) {
                    const data = item._masonryData;
                    const itemCenterX = data.x + data.width / 2;
                    const xDistance = Math.abs(itemCenterX - targetCenterX);

                    const hasColumnOverlap = data.x < targetCenterX && data.x + data.width > targetCenterX;
                    if (!hasColumnOverlap && xDistance > data.width / 2) continue;

                    const itemBottomY = data.y + data.height;
                    if (itemBottomY > bestY || (itemBottomY === bestY && xDistance < minXDistance)) {
                        bestY = itemBottomY;
                        minXDistance = xDistance;
                        bestMatch = item;
                    }
                }
                if (bestMatch) target = bestMatch;
            }

            this.focusItem(target);
        }

        /**
         * Focus a specific item widget with robust handling.
         * @param {St.Widget} widget The widget to focus
         */
        focusItem(widget) {
            if (!widget) return;

            if (this._focusTimeoutId) {
                GLib.source_remove(this._focusTimeoutId);
                this._focusTimeoutId = 0;
            }

            this._focusTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 0, () => {
                this._focusTimeoutId = 0;
                widget.grab_key_focus();

                if (this._scrollView) {
                    ensureActorVisibleInScrollView(this._scrollView, widget);
                }
                return GLib.SOURCE_REMOVE;
            });
        }

        /**
         * Handles key press events for grid navigation.
         * @param {Clutter.Actor} _actor The actor that received the event
         * @param {Clutter.Event} event The key press event
         * @returns {number} Clutter.EVENT_STOP or Clutter.EVENT_PROPAGATE
         * @private
         */
        handleKeyPress(_actor, event) {
            const symbol = event.get_key_symbol();
            const direction = this._getDirectionFromKey(symbol);

            if (!direction) {
                return Clutter.EVENT_PROPAGATE;
            }

            if (this._spatialMapDirty) {
                this._buildSpatialMap();
                this._spatialMapDirty = false;
            }

            const currentFocus = global.stage.get_key_focus();
            let currentWidget = currentFocus;
            while (currentWidget && !currentWidget._itemId) {
                currentWidget = currentWidget.get_parent?.();
            }

            if (!currentWidget || !this.contains(currentWidget)) return Clutter.EVENT_PROPAGATE;

            const currentItem = this._spatialMap.find((item) => item.widget === currentWidget);

            if (!currentItem) return Clutter.EVENT_PROPAGATE;

            const nextWidget = this._findClosestInDirection(currentWidget, direction);

            if (!nextWidget) {
                if (this._tryVirtualVerticalFallback(currentWidget, direction)) {
                    return Clutter.EVENT_STOP;
                }

                if (direction === 'up' || direction === 'down') {
                    return Clutter.EVENT_PROPAGATE;
                }
                return Clutter.EVENT_STOP;
            }

            // Masonry cells are single focus without subtargets so direct grab_key_focus is sufficient.
            nextWidget.grab_key_focus();

            if (this._scrollView) {
                ensureActorVisibleInScrollView(this._scrollView, nextWidget);
            }

            return Clutter.EVENT_STOP;
        }

        /**
         * Converts a keyboard symbol to a navigation direction.
         * @param {number} symbol The key symbol
         * @returns {string|null} The direction string or null
         * @private
         */
        _getDirectionFromKey(symbol) {
            switch (symbol) {
                case Clutter.KEY_Up:
                    return 'up';
                case Clutter.KEY_Down:
                    return 'down';
                case Clutter.KEY_Left:
                    return 'left';
                case Clutter.KEY_Right:
                    return 'right';
                default:
                    return null;
            }
        }

        /**
         * Finds the most logical next widget in a given direction.
         * @param {St.Widget} currentWidget The currently focused widget
         * @param {string} direction 'up', 'down', 'left', or 'right'
         * @returns {St.Widget|null} The next widget to focus, or null
         * @private
         */
        _findClosestInDirection(currentWidget, direction) {
            const currentItem = this._spatialMap.find((item) => item.widget === currentWidget);
            if (!currentItem) return null;

            let bestCandidate = null;

            if (direction === 'left' || direction === 'right') {
                const candidatesInDirection = this._spatialMap.filter((item) => {
                    if (item.widget === currentWidget) return false;
                    return direction === 'right' ? item.centerX > currentItem.centerX : item.centerX < currentItem.centerX;
                });

                if (candidatesInDirection.length === 0) return null;

                let minHorizontalDistance = Infinity;
                candidatesInDirection.forEach((item) => {
                    const distance = Math.abs(item.centerX - currentItem.centerX);
                    if (distance < minHorizontalDistance) minHorizontalDistance = distance;
                });

                const tolerance = MasonryNavigation.COLUMN_TOLERANCE;
                const itemsInTargetColumn = candidatesInDirection.filter((item) => {
                    const distance = Math.abs(item.centerX - currentItem.centerX);
                    return distance < minHorizontalDistance + tolerance;
                });

                let maxOverlap = -1;
                for (const candidate of itemsInTargetColumn) {
                    const overlap = this._getVerticalOverlap(currentItem, candidate);
                    if (overlap > maxOverlap) {
                        maxOverlap = overlap;
                        bestCandidate = candidate;
                    }
                }

                if (!bestCandidate) {
                    let minCenterYDistance = Infinity;
                    for (const candidate of itemsInTargetColumn) {
                        const distance = Math.abs(candidate.centerY - currentItem.centerY);
                        if (distance < minCenterYDistance) {
                            minCenterYDistance = distance;
                            bestCandidate = candidate;
                        }
                    }
                }
            } else {
                const candidatesInDirection = this._spatialMap.filter((item) => {
                    if (item.widget === currentWidget) return false;
                    const inDirection = direction === 'up' ? item.centerY < currentItem.centerY : item.centerY > currentItem.centerY;
                    if (!inDirection) return false;

                    const hasColumnOverlap = item.x1 < currentItem.x2 && item.x2 > currentItem.x1;
                    return hasColumnOverlap;
                });

                if (candidatesInDirection.length === 0) return null;

                let minVerticalDistance = Infinity;
                for (const candidate of candidatesInDirection) {
                    const dY = Math.abs(candidate.centerY - currentItem.centerY);
                    if (dY < minVerticalDistance) {
                        minVerticalDistance = dY;
                        bestCandidate = candidate;
                    }
                }
            }

            return bestCandidate ? bestCandidate.widget : null;
        }

        /**
         * Calculates the vertical overlap in pixels between two items.
         * @param {object} itemA A spatial map object for the first item
         * @param {object} itemB A spatial map object for the second item
         * @returns {number} The number of overlapping vertical pixels
         * @private
         */
        _getVerticalOverlap(itemA, itemB) {
            const overlapTop = Math.max(itemA.y1, itemB.y1);
            const overlapBottom = Math.min(itemA.y2, itemB.y2);
            return Math.max(0, overlapBottom - overlapTop);
        }

        /**
         * Handle vertical navigation misses when virtualization is active.
         * Masonry needs this wrapper because spatial navigation may fail to find a
         * physical neighbor even when logical neighbors exist outside the realized window.
         * @param {St.Widget} itemWidget Current item widget
         * @param {string} direction Navigation direction
         * @returns {boolean} True if handled
         * @private
         */
        _tryVirtualVerticalFallback(itemWidget, direction) {
            if ((direction !== 'up' && direction !== 'down') || !this._virtualizationActive) return false;
            if (this._tryVirtualVerticalNavigation(itemWidget, direction)) return true;
            return this._hasVirtualNeighbor(itemWidget, direction);
        }

        /**
         * Try virtualized up/down movement by global index and realize target if needed.
         * @param {St.Widget} itemWidget Current item widget
         * @param {'up'|'down'} direction Vertical direction
         * @returns {boolean} True if focus moved
         * @private
         */
        _tryVirtualVerticalNavigation(itemWidget, direction) {
            const currentItemId = itemWidget?._itemId;
            if (!currentItemId) return false;

            const currentIndex = this._itemIndexById.get(currentItemId);
            if (currentIndex === undefined) return false;

            const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
            if (nextIndex < 0 || nextIndex >= this._itemIds.length) return false;

            const nextItemId = this._itemIds[nextIndex];
            if (!nextItemId) return false;

            let nextWidget = this.get_children().find((child) => child._itemId === nextItemId);
            if (!nextWidget) {
                this._ensureRealizedNeighborhood(nextIndex);
                nextWidget = this.get_children().find((child) => child._itemId === nextItemId);
            }

            if (!nextWidget) {
                const entry = this._layoutEntryById.get(nextItemId);
                if (!entry) return false;
                const viewportHeight = this._virtualViewportHeight > 0 ? this._virtualViewportHeight : MasonryVirtualization.FALLBACK_VIEWPORT_HEIGHT;
                this._virtualViewportTop = Math.max(0, entry.layoutData.y - viewportHeight * 0.4);
                this._applyViewportCulling(false);
                nextWidget = this.get_children().find((child) => child._itemId === nextItemId);
                if (!nextWidget) {
                    this._applyViewportCulling(true);
                    nextWidget = this.get_children().find((child) => child._itemId === nextItemId);
                }
            }

            if (!nextWidget) {
                return this.focusByItemId(currentItemId);
            }

            nextWidget.grab_key_focus();
            if (this._scrollView) {
                ensureActorVisibleInScrollView(this._scrollView, nextWidget);
            }
            return true;
        }

        /**
         * Check whether there is still a logical item above or below this widget.
         * @param {St.Widget} itemWidget Current item widget
         * @param {'up'|'down'} direction Vertical direction
         * @returns {boolean}
         * @private
         */
        _hasVirtualNeighbor(itemWidget, direction) {
            const currentItemId = itemWidget?._itemId;
            if (!currentItemId) return false;
            const currentIndex = this._itemIndexById.get(currentItemId);
            if (currentIndex === undefined) return false;
            if (direction === 'up') return currentIndex > 0;
            return currentIndex < this._itemIds.length - 1;
        }

        /**
         * Resolve focused item id within this layout.
         * @returns {string|null}
         * @private
         */
        _getFocusedItemId() {
            let focused = global.stage.get_key_focus();
            while (focused && !focused._itemId) {
                focused = focused.get_parent?.();
            }
            if (!focused || !this.contains(focused)) return null;
            return focused._itemId || null;
        }

        /**
         * Cache an off-window widget for potential reuse on reverse scrolling.
         * @param {string} itemId Item id key
         * @param {St.Widget} widget Widget to cache
         * @private
         */
        _cacheVirtualWidget(itemId, widget) {
            if (!itemId || !widget) return;
            if (widget.get_parent() === this) {
                this.remove_child(widget);
            }

            this._virtualWidgetCache.set(itemId, widget);
            while (this._virtualWidgetCache.size > this._virtualWidgetCacheLimit) {
                const oldest = this._virtualWidgetCache.entries().next().value;
                if (!oldest) break;
                const [oldestId, oldestWidget] = oldest;
                this._virtualWidgetCache.delete(oldestId);
                oldestWidget.destroy();
            }
        }

        /**
         * Destroy all cached off-window widgets.
         * @private
         */
        _clearVirtualWidgetCache() {
            this._virtualWidgetCache.forEach((widget) => {
                widget.destroy();
            });
            this._virtualWidgetCache.clear();
        }

        /**
         * Mark the spatial map as dirty so it can be rebuilt on demand.
         * @private
         */
        _markSpatialMapDirty() {
            this._spatialMapDirty = true;
        }

        /**
         * Builds a cache of item positions for keyboard navigation.
         * @private
         */
        _buildSpatialMap() {
            const widgets = this._getItemChildren(true);
            if (widgets.length === 0) {
                this._spatialMap = [];
                this._spatialMapDirty = false;
                return;
            }

            let minY = Infinity,
                minX = Infinity,
                maxX = -Infinity,
                maxY = -Infinity;

            const mapData = widgets
                .filter((widget) => widget._masonryData)
                .map((widget) => {
                    const data = widget._masonryData;
                    const x1 = data.x;
                    const y1 = data.y;
                    const width = data.width;
                    const height = data.height;
                    const x2 = x1 + width;
                    const y2 = y1 + height;

                    if (y1 < minY) minY = y1;
                    if (x1 < minX) minX = x1;
                    if (x2 > maxX) maxX = x2;
                    if (y2 > maxY) maxY = y2;

                    return {
                        widget,
                        centerX: x1 + width / 2,
                        centerY: y1 + height / 2,
                        y1,
                        x1,
                        x2,
                        y2,
                    };
                });

            const tolerance = MasonryNavigation.EDGE_TOLERANCE;
            this._spatialMap = mapData.map((item) => ({
                ...item,
                isTopEdge: item.y1 <= minY + tolerance,
                isBottomEdge: item.y2 >= maxY - tolerance,
                isLeftEdge: item.x1 <= minX + tolerance,
                isRightEdge: item.x2 >= maxX - tolerance,
            }));
            this._spatialMapDirty = false;
        }

        /**
         * Check if this actor and its parents are visible.
         * @returns {boolean}
         * @private
         */
        _isEffectivelyVisible() {
            let actor = this;
            while (actor) {
                if (actor.visible === false) return false;
                actor = actor.get_parent?.();
            }
            return true;
        }

        /**
         * Check if the widget is mapped and ready for relayout.
         * @returns {boolean}
         * @private
         */
        _canRelayoutNow() {
            return this.mapped && this.get_stage() && this._isEffectivelyVisible();
        }

        /**
         * Schedule a relayout if mapped, otherwise defer until mapped.
         * @private
         */
        _scheduleRelayout() {
            if (!this._items.length) return;

            if (!this._canRelayoutNow()) {
                this._pendingRelayoutOnMap = true;
                return;
            }

            this._cancelScheduledRelayout();
            this._relayoutTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, MasonryTiming.RELAYOUT_DEBOUNCE_MS, () => {
                this._relayoutTimeoutId = 0;

                if (!this._items.length) {
                    return GLib.SOURCE_REMOVE;
                }

                if (!this._canRelayoutNow()) {
                    this._pendingRelayoutOnMap = true;
                    return GLib.SOURCE_REMOVE;
                }

                this._relayout();
                return GLib.SOURCE_REMOVE;
            });
        }

        /**
         * Flush any pending relayout when the widget becomes mapped.
         * @private
         */
        _flushPendingRelayoutOnMap() {
            if (!this._pendingRelayoutOnMap || !this._canRelayoutNow()) return;
            this._pendingRelayoutOnMap = false;
            this._scheduleRelayout();
        }

        /**
         * Return only item children, optionally only those currently visible.
         * @param {boolean} visibleOnly
         * @returns {Array<St.Widget>}
         * @private
         */
        _getItemChildren(visibleOnly = false) {
            const children = this.get_children().filter((widget) => widget._masonryData);
            if (!visibleOnly) return children;
            return children.filter((widget) => widget.visible);
        }

        /**
         * Determine whether viewport culling should be active.
         * @returns {boolean}
         * @private
         */
        _shouldVirtualize(count = this._items.length) {
            return this._virtualizationEnabled && count >= this._virtualMinItems;
        }

        /**
         * Realize only items near the viewport to reduce actor count and allocation work.
         * @param {boolean} force Whether to force relayout marking even when visibility set is unchanged
         * @private
         */
        _applyViewportCulling(force) {
            if (!this._virtualizationEnabled) return;

            if (!this._shouldVirtualize()) {
                this._virtualizationActive = false;
                this._clearVirtualWidgetCache();
                return;
            }

            this._virtualizationActive = true;
            this._reconcileVirtualWindow(null, this._lastRenderSession, force, false);
        }

        /**
         * Reconcile only the currently visible virtualized window.
         * @param {Map<string,St.Widget>|null} existingWidgets Optional existing widget map from caller
         * @param {object} renderSession Render session object
         * @param {boolean} force Force spatial map/layout refresh
         * @param {boolean} updateExisting Whether to run updateItemFn on existing widgets
         * @private
         */
        _reconcileVirtualWindow(existingWidgets, renderSession, force, updateExisting) {
            this._refreshViewportFromScrollView();
            const viewportHeight = this._virtualViewportHeight > 0 ? this._virtualViewportHeight : MasonryVirtualization.FALLBACK_VIEWPORT_HEIGHT;
            const minY = Math.max(0, this._virtualViewportTop - this._virtualOverscanPx);
            const maxY = this._virtualViewportTop + viewportHeight + this._virtualOverscanPx;
            const focusedItemId = this._getFocusedItemId();

            const widgetsById =
                existingWidgets ||
                new Map(
                    this._getItemChildren(false).map((widget) => {
                        return [widget._itemId, widget];
                    }),
                );

            let changed = false;
            for (const entry of this._layoutEntries) {
                const { itemId, itemData, layoutData } = entry;
                const itemTop = layoutData.y;
                const itemBottom = layoutData.y + layoutData.height;

                // Pixel based culling preserves the focused item inline because Masonry can simply include it in the viewport check.
                const inViewport = itemId === focusedItemId || (itemBottom >= minY && itemTop <= maxY);
                if (!inViewport) continue;

                let widget = widgetsById.get(itemId);
                if (widget) {
                    widgetsById.delete(itemId);
                    this._updateRealizedWidget(widget, itemData, layoutData, renderSession, updateExisting);
                } else {
                    widget = this._obtainRealizedWidget(itemId, itemData, layoutData, renderSession);
                    if (!widget) continue;
                    changed = true;
                }
            }

            if (this._evictOffWindowWidgets(widgetsById, focusedItemId)) {
                changed = true;
            }

            if (changed || force) {
                this._markSpatialMapDirty();
                this.queue_relayout();
            }
        }

        /**
         * Obtain a realized widget from cache or renderer and attach it to the layout.
         * @param {string} itemId Item id
         * @param {object} itemData Item data
         * @param {object} layoutData Layout data
         * @param {object} renderSession Render session
         * @returns {St.Widget|null}
         * @private
         */
        _obtainRealizedWidget(itemId, itemData, layoutData, renderSession) {
            let widget = this._virtualWidgetCache.get(itemId);
            if (widget) {
                this._virtualWidgetCache.delete(itemId);
            } else {
                widget = this._renderItemFn(itemData, renderSession);
                if (!widget) return null;
            }

            widget._itemId = itemId;
            widget._masonryData = layoutData;
            this.add_child(widget);
            return widget;
        }

        /**
         * Pre-realize a small neighborhood around the target index to smooth held-arrow traversal.
         * @param {number} centerIndex Center index in navigable ids
         * @private
         */
        _ensureRealizedNeighborhood(centerIndex) {
            const radius = MasonryVirtualization.NAV_PREFETCH_RADIUS;
            const start = Math.max(0, centerIndex - radius);
            const end = Math.min(this._itemIds.length, centerIndex + radius + 1);
            let changed = false;

            for (let i = start; i < end; i++) {
                const itemId = this._itemIds[i];
                if (!itemId) continue;

                const alreadyRealized = this.get_children().some((child) => child._itemId === itemId);
                if (alreadyRealized) continue;

                const entry = this._layoutEntryById.get(itemId);
                if (!entry) continue;

                const widget = this._obtainRealizedWidget(itemId, entry.itemData, entry.layoutData, this._lastRenderSession);
                if (!widget) continue;
                changed = true;
            }

            if (changed) {
                this._markSpatialMapDirty();
                this.queue_relayout();
            }
        }

        /**
         * Update a realized widget with new data/layout and animation flags.
         * @param {St.Widget} widget Existing widget
         * @param {object} itemData Item data
         * @param {object} layoutData Layout data
         * @param {object} renderSession Render session
         * @param {boolean} updateExisting Whether to run updateItemFn
         * @private
         */
        _updateRealizedWidget(widget, itemData, layoutData, renderSession, updateExisting) {
            const previousLayout = widget._masonryData;
            const positionChanged =
                previousLayout && (previousLayout.x !== layoutData.x || previousLayout.y !== layoutData.y || previousLayout.width !== layoutData.width || previousLayout.height !== layoutData.height);

            if (updateExisting && this._updateItemFn) {
                const structureChanged = this._updateItemFn(widget, itemData, renderSession);
                if (structureChanged) {
                    widget._masonryData = null;
                    widget.queue_relayout();
                }
                if (positionChanged || structureChanged) widget._shouldAnimate = true;
            }

            widget._masonryData = layoutData;
        }

        /**
         * Remove or cache off-window widgets.
         * @param {Map<string,St.Widget>} widgetsById Existing widgets map
         * @param {string|null} focusedItemId Focused item id to preserve
         * @returns {boolean} True if anything changed
         * @private
         */
        _evictOffWindowWidgets(widgetsById, focusedItemId) {
            let changed = false;
            widgetsById.forEach((widget, itemId) => {
                if (focusedItemId && itemId === focusedItemId) return;
                if (this._virtualizationActive) {
                    this._cacheVirtualWidget(itemId, widget);
                } else {
                    widget.destroy();
                }
                changed = true;
            });
            return changed;
        }

        /**
         * Defer rendering until a valid width is available.
         * @param {Array<object>} items Items to render
         * @param {object} renderSession Render session object
         * @private
         */
        _deferRender(items, renderSession) {
            this._pendingItems.push(...items);

            if (this._pendingAllocationId || this._pendingTimeoutId) {
                return;
            }

            this._renderGeneration = (this._renderGeneration || 0) + 1;
            const myGeneration = this._renderGeneration;

            const tryRender = () => {
                this._cleanupPendingCallbacks();
                if (myGeneration !== this._renderGeneration) return;

                if (this._isValidWidth() && this._pendingItems.length > 0) {
                    const itemsToRender = this._pendingItems;
                    this._pendingItems = [];
                    this.addItems(itemsToRender, renderSession);
                }
            };

            this._pendingAllocationId = this.connect('notify::width', tryRender);

            this._pendingTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, MasonryTiming.RENDER_TIMEOUT_MS, () => {
                this._pendingTimeoutId = null;
                tryRender();
                return GLib.SOURCE_REMOVE;
            });
        }

        /**
         * Clean up pending allocation and timeout callbacks.
         * @private
         */
        _cleanupPendingCallbacks() {
            if (this._pendingTimeoutId) {
                GLib.source_remove(this._pendingTimeoutId);
                this._pendingTimeoutId = null;
            }

            if (this._pendingAllocationId) {
                try {
                    this.disconnect(this._pendingAllocationId);
                } catch {
                    // Object may already be disposing.
                }
                this._pendingAllocationId = null;
            }
        }

        /**
         * Cancel a scheduled relayout timeout, if one exists.
         * @private
         */
        _cancelScheduledRelayout() {
            if (!this._relayoutTimeoutId) return;
            GLib.source_remove(this._relayoutTimeoutId);
            this._relayoutTimeoutId = 0;
        }

        /**
         * Re-layout all existing items when width changes.
         * @private
         */
        _relayout() {
            const itemsToLayout = [...this._items];
            this.reconcile(itemsToLayout, {});
        }

        /**
         * Checks if the current width is valid for rendering.
         * @returns {boolean} True if width is valid, false otherwise
         * @private
         */
        _isValidWidth() {
            return this._lastLayoutWidth > MasonryDimensions.MIN_VALID_WIDTH;
        }

        /**
         * @param {number} effectiveWidth The effective width to validate
         * @returns {boolean} True if valid
         * @private
         */
        _isValidEffectiveWidth(effectiveWidth) {
            if (effectiveWidth <= 0) {
                console.error('[AIO-Clipboard] Invalid effective width in MasonryLayout, aborting render');
                return false;
            }
            return true;
        }

        /**
         * @param {number} columnWidth The column width to validate
         * @returns {boolean} True if valid
         * @private
         */
        _isValidColumnWidth(columnWidth) {
            if (columnWidth <= 0 || !isFinite(columnWidth)) {
                console.error('[AIO-Clipboard] Invalid column width in MasonryLayout, aborting render');
                return false;
            }
            return true;
        }

        /**
         * Check if item data has valid dimensions.
         * @param {object} itemData The item data
         * @returns {boolean} True if dimensions are valid
         * @private
         */
        _hasValidDimensions(itemData) {
            return itemData.width && itemData.height;
        }

        /**
         * Check if the calculated item height is valid.
         * @param {number} itemHeight The item height to validate
         * @returns {boolean} True if valid
         * @private
         */
        _isValidItemHeight(itemHeight) {
            return isFinite(itemHeight) && itemHeight > 0;
        }

        /**
         * @returns {number} The effective width accounting for padding
         * @private
         */
        _calculateEffectiveWidth() {
            return this._lastLayoutWidth - MasonryDimensions.PADDING * 2;
        }

        /**
         * @param {number} effectiveWidth The effective width
         * @returns {number} The optimal column count
         * @private
         */
        _calculateColumns(effectiveWidth) {
            if (!this._targetItemWidth) return this._columns;

            const cellWidth = this._targetItemWidth + this._spacing;
            let newColumns = Math.max(1, Math.floor((effectiveWidth + this._spacing) / cellWidth));
            if (this._maxColumns) {
                newColumns = Math.min(newColumns, this._maxColumns);
            }
            return newColumns;
        }

        /**
         * @param {number} effectiveWidth The effective width of the container
         * @returns {number} The column width
         * @private
         */
        _calculateColumnWidth(effectiveWidth) {
            const cols = this._calculateColumns(effectiveWidth);
            const totalSpacing = this._spacing * (cols - 1);
            return Math.floor((effectiveWidth - totalSpacing) / cols);
        }

        /**
         * Render all items into the masonry layout.
         * @param {Array<object>} items Items to render
         * @param {number} columnWidth Width of each column
         * @param {object} renderSession Render session object
         * @private
         */
        _renderItems(items, columnWidth, renderSession) {
            const paddingLeft = MasonryDimensions.PADDING;

            for (let itemData of items) {
                itemData = this._prepareItemFn(itemData);
                this._items.push(itemData);
                if (!this._hasValidDimensions(itemData)) continue;

                const itemHeight = this._calculateItemHeight(itemData, columnWidth);
                if (!this._isValidItemHeight(itemHeight)) continue;

                const itemWidget = this._renderItemFn(itemData, renderSession);
                if (!itemWidget) continue;

                itemWidget._itemId = itemData.id;

                const shortestColumnIndex = this._findShortestColumn();
                this._positionItem(itemWidget, shortestColumnIndex, columnWidth, itemHeight, paddingLeft);
                this._updateColumnHeight(shortestColumnIndex, itemHeight);
            }
        }

        /**
         * Calculate item height based on aspect ratio.
         * @param {object} itemData The item data with width and height
         * @param {number} columnWidth The width of the column
         * @returns {number} The calculated item height
         * @private
         */
        _calculateItemHeight(itemData, columnWidth) {
            const aspectRatio = itemData.height / itemData.width;
            return Math.round(columnWidth * aspectRatio);
        }

        /**
         * Find the index of the shortest column.
         * @returns {number} The column index
         * @private
         */
        _findShortestColumn() {
            return this._columnHeights.indexOf(Math.min(...this._columnHeights));
        }

        /**
         * Position an item widget in the layout.
         * @param {St.Widget} itemWidget The widget to position
         * @param {number} columnIndex The column index
         * @param {number} columnWidth The width of the column
         * @param {number} itemHeight The height of the item
         * @param {number} paddingLeft Left padding of the container
         * @private
         */
        _positionItem(itemWidget, columnIndex, columnWidth, itemHeight, paddingLeft) {
            const x = paddingLeft + columnIndex * (columnWidth + this._spacing);
            const y = this._columnHeights[columnIndex];

            itemWidget._masonryData = {
                x: x,
                y: y,
                width: columnWidth,
                height: itemHeight,
            };

            this.add_child(itemWidget);
        }

        /**
         * Update the height of a column after adding an item.
         * @param {number} columnIndex The column index
         * @param {number} itemHeight The height of the added item
         * @private
         */
        _updateColumnHeight(columnIndex, itemHeight) {
            this._columnHeights[columnIndex] += itemHeight + this._spacing;
        }

        /**
         * Update the container height to match the tallest column.
         * @private
         */
        _updateContainerHeight() {
            const maxHeight = Math.max(...this._columnHeights);
            if (isFinite(maxHeight) && maxHeight > 0) {
                this.height = maxHeight;
            }
        }

        /**
         * Clear all items from the layout.
         */
        clear() {
            this._cleanupPendingCallbacks();
            this._cancelScheduledRelayout();
            this._renderGeneration = (this._renderGeneration || 0) + 1;

            this._items = [];
            this._layoutEntries = [];
            this._layoutEntryById = new Map();
            this._itemIds = [];
            this._itemIndexById = new Map();
            this._lastRenderSession = null;
            this._pendingItems = [];
            this._spatialMap = [];
            this._spatialMapDirty = false;
            this._columnHeights = new Array(this._columns).fill(0);
            this._lockedColumnWidth = -1;
            this._pendingRelayout = false;
            this._pendingRelayoutOnMap = false;
            this._virtualizationActive = false;
            this._virtualViewportTop = 0;
            this._virtualViewportHeight = 0;
            this._clearVirtualWidgetCache();

            this.destroy_all_children();
            this.height = 0;
        }

        /**
         * Clean up resources on destruction.
         */
        destroy() {
            if (this._focusTimeoutId) {
                GLib.source_remove(this._focusTimeoutId);
                this._focusTimeoutId = 0;
            }
            this._cleanupPendingCallbacks();
            this._cancelScheduledRelayout();
            this._pendingRelayoutOnMap = false;
            this._clearVirtualWidgetCache();

            super.destroy();
        }
    },
);
