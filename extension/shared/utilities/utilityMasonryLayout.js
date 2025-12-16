import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import { ensureActorVisibleInScrollView } from 'resource:///org/gnome/shell/misc/animationUtils.js';

import { Debouncer } from './utilityDebouncer.js';

const MasonryDefaults = {
    COLUMNS: 4,
    SPACING: 2,
};

const MasonryLayout_ = {
    PADDING: 8,
    MIN_VALID_WIDTH: 32,
};

const MasonryTiming = {
    RELAYOUT_DEBOUNCE_MS: 100,
    RENDER_TIMEOUT_MS: 100,
};

const MasonryNavigation = {
    EDGE_TOLERANCE: 2,
    COLUMN_TOLERANCE: 20,
    HORIZONTAL_WEIGHT: 5,
};

/**
 * MasonryLayout - A self-navigating, Pinterest-style masonry layout widget.
 *
 * Items are distributed across columns with the shortest column always receiving the next item.
 * Automatically re-layouts when width changes and handles its own keyboard navigation.
 *
 * @example
 * const masonry = new MasonryLayout({
 *     columns: 4,
 *     spacing: 2,
 *     renderItemFn: (itemData, session) => createItemWidget(itemData)
 * });
 * masonry.addItems(myItemsArray, renderSession);
 */
export const MasonryLayout = GObject.registerClass(
    class MasonryLayout extends St.Widget {
        /**
         * Initialize the masonry layout.
         *
         * @param {object} params - Configuration parameters
         * @param {number} [params.columns=4] - Number of columns to display
         * @param {number} [params.spacing=2] - Spacing between items in pixels
         * @param {Function} params.renderItemFn - Function to render each item.
         *   Signature: (itemData, renderSession) => St.Widget
         * @param {St.ScrollView} [params.scrollView] - Optional scroll view for auto-scroll on focus
         */
        constructor(params) {
            super({
                // No layout_manager - we handle allocation manually in vfunc_allocate
                x_expand: true,
            });

            const { columns = MasonryDefaults.COLUMNS, spacing = MasonryDefaults.SPACING, renderItemFn, scrollView } = params;

            this._columns = columns;
            this._spacing = spacing;
            this._renderItemFn = renderItemFn;
            this._scrollView = scrollView || null;
            this._columnHeights = new Array(this._columns).fill(0);
            this._items = [];
            this._lastLayoutWidth = -1;
            this._lockedColumnWidth = -1;
            this._pendingRelayout = false;
            this._pendingAllocationId = null;
            this._pendingTimeoutId = null;
            this._spatialMap = [];
            this._pendingItems = [];
            this._isDestroyed = false;

            this._relayoutDebouncer = new Debouncer(() => this._relayout(), MasonryTiming.RELAYOUT_DEBOUNCE_MS);

            this.reactive = true;
            this.connect('key-press-event', this.handleKeyPress.bind(this));
            this.connect('destroy', () => {
                this._isDestroyed = true;
                this._cleanupPendingCallbacks();
            });
        }

        /**
         * Handle allocation changes - triggers re-layout when width changes.
         * Also manually allocates each child since we use absolute positioning.
         *
         * @param {Clutter.ActorBox} box - The allocation box
         */
        vfunc_allocate(box) {
            this.set_allocation(box);
            const newWidth = box.get_width();

            // Skip relayout during batch rendering to prevent jitter
            if (this._lastLayoutWidth !== newWidth && this._lastLayoutWidth > 0) {
                if (this._items.length > 0) {
                    if (this._lockedColumnWidth > 0) {
                        this._pendingRelayout = true;
                    } else {
                        this._lastLayoutWidth = newWidth;
                        this._relayout();
                        return;
                    }
                }
            }
            this._lastLayoutWidth = newWidth;

            for (const child of this.get_children()) {
                const layout = child._masonryData;
                if (layout) {
                    const childBox = new Clutter.ActorBox();
                    childBox.x1 = layout.x;
                    childBox.y1 = layout.y;
                    childBox.x2 = layout.x + layout.width;
                    childBox.y2 = layout.y + layout.height;
                    child.allocate(childBox);
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
         * Clear all items from the layout.
         */
        clear() {
            this._cleanupPendingCallbacks();
            this._relayoutDebouncer.cancel();

            // Clear references before destroying children to prevent stale access
            this._items = [];
            this._pendingItems = [];
            this._spatialMap = [];
            this._columnHeights = new Array(this._columns).fill(0);
            this._lockedColumnWidth = -1;
            this._pendingRelayout = false;

            this.destroy_all_children();
            this.height = 0;
        }

        /**
         * Add items to the masonry layout.
         *
         * @param {Array<object>} items - Array of item data objects with width and height properties
         * @param {object} renderSession - Session object for tracking async operations
         */
        addItems(items, renderSession) {
            if (!this._isValidWidth()) {
                this._deferRender(items, renderSession);
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
            }

            if (!this._isValidColumnWidth(columnWidth)) {
                return;
            }

            // Defer to idle cycle for proper Clutter allocation
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (this._isDestroyed) return GLib.SOURCE_REMOVE;

                this._renderItems(items, columnWidth, renderSession);
                this._updateContainerHeight();
                this._buildSpatialMap();

                return GLib.SOURCE_REMOVE;
            });
        }

        /**
         * Signal that a batch sequence is complete. Unlocks column width and processes pending relayout.
         */
        finishBatch() {
            this._lockedColumnWidth = -1;
            if (this._pendingRelayout) {
                this._pendingRelayout = false;
                this._relayoutDebouncer.trigger();
            }
        }

        /**
         * Focus the first item in the masonry layout.
         * Used for cross-masonry navigation.
         * @param {number} [targetCenterX] - Optional X position to find item in same column.
         */
        focusFirst(targetCenterX) {
            const children = this.get_children().filter((w) => w._masonryData);
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

            target.grab_key_focus();
            if (this._scrollView) {
                ensureActorVisibleInScrollView(this._scrollView, target);
            }
        }

        /**
         * Focus the last item in the masonry layout (bottom of column).
         * Used for cross-masonry navigation.
         * @param {number} [targetCenterX] - Optional X position to find item in same column.
         */
        focusLast(targetCenterX) {
            const children = this.get_children().filter((w) => w._masonryData);
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

            target.grab_key_focus();
            if (this._scrollView) {
                ensureActorVisibleInScrollView(this._scrollView, target);
            }
        }

        /**
         * Builds a cache of item positions for fast keyboard navigation.
         * Uses _masonryData since widget allocation may not have completed yet.
         * @private
         */
        _buildSpatialMap() {
            const widgets = this.get_children();
            if (widgets.length === 0) {
                this._spatialMap = [];
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
        }

        /**
         * Handles key press events for navigating the grid.
         * Can be called directly or connected to a signal.
         * @param {Clutter.Actor} _actor - The actor that received the event.
         * @param {Clutter.Event} event - The key press event.
         * @returns {number} Clutter.EVENT_STOP or Clutter.EVENT_PROPAGATE.
         * @private
         */
        handleKeyPress(_actor, event) {
            const symbol = event.get_key_symbol();
            const direction = this._getDirectionFromKey(symbol);

            if (!direction) {
                return Clutter.EVENT_PROPAGATE;
            }

            const currentFocus = global.stage.get_key_focus();
            const currentItem = this._spatialMap.find((item) => item.widget === currentFocus);

            if (!currentItem) return Clutter.EVENT_PROPAGATE;

            const nextWidget = this._findClosestInDirection(currentFocus, direction);

            if (!nextWidget) {
                if (direction === 'up' || direction === 'down') {
                    return Clutter.EVENT_PROPAGATE;
                }
                return Clutter.EVENT_STOP;
            }

            nextWidget.grab_key_focus();

            if (this._scrollView) {
                ensureActorVisibleInScrollView(this._scrollView, nextWidget);
            }

            return Clutter.EVENT_STOP;
        }

        /**
         * Converts a keyboard symbol to a navigation direction.
         * @param {number} symbol - The key symbol.
         * @returns {string|null} The direction string or null.
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
         * @param {St.Widget} currentWidget - The currently focused widget.
         * @param {string} direction - 'up', 'down', 'left', or 'right'.
         * @returns {St.Widget|null} The next widget to focus, or null.
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
         * @param {object} itemA - A spatial map object for the first item.
         * @param {object} itemB - A spatial map object for the second item.
         * @returns {number} The number of overlapping vertical pixels.
         * @private
         */
        _getVerticalOverlap(itemA, itemB) {
            const overlapTop = Math.max(itemA.y1, itemB.y1);
            const overlapBottom = Math.min(itemA.y2, itemB.y2);
            return Math.max(0, overlapBottom - overlapTop);
        }

        /**
         * Checks if the current width is valid for rendering.
         * @returns {boolean} True if width is valid, false otherwise.
         * @private
         */
        _isValidWidth() {
            return this.width && this.width > MasonryLayout_.MIN_VALID_WIDTH;
        }

        /**
         * Defer rendering until a valid width is available.
         *
         * @param {Array<object>} items - Items to render
         * @param {object} renderSession - Render session object
         * @private
         */
        _deferRender(items, renderSession) {
            // Accumulate items instead of replacing
            this._pendingItems.push(...items);

            // Only setup callbacks if not already waiting
            if (this._pendingAllocationId || this._pendingTimeoutId) {
                return;
            }

            const tryRender = () => {
                if (this._isDestroyed) return;
                this._cleanupPendingCallbacks();

                if (this._isValidWidth()) {
                    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        if (!this._isDestroyed && this._isValidWidth() && this._pendingItems.length > 0) {
                            const itemsToRender = this._pendingItems;
                            this._pendingItems = [];
                            this.addItems(itemsToRender, renderSession);
                        }
                        return GLib.SOURCE_REMOVE;
                    });
                }
            };

            this._pendingAllocationId = this.connect('notify::width', tryRender);

            this._pendingTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, MasonryTiming.RENDER_TIMEOUT_MS, () => {
                this._pendingTimeoutId = null;
                if (!this._isDestroyed) {
                    tryRender();
                }
                return GLib.SOURCE_REMOVE;
            });
        }

        /**
         * Clean up pending allocation and timeout callbacks.
         *
         * @private
         */
        _cleanupPendingCallbacks() {
            if (this._pendingTimeoutId) {
                GLib.source_remove(this._pendingTimeoutId);
                this._pendingTimeoutId = null;
            }

            if (this._pendingAllocationId) {
                if (!this._isDestroyed) {
                    try {
                        this.disconnect(this._pendingAllocationId);
                    } catch {
                        // Object may already be disposing
                    }
                }
                this._pendingAllocationId = null;
            }
        }

        /**
         * Calculate the effective width accounting for padding.
         *
         * @returns {number} The effective width
         * @private
         */
        _calculateEffectiveWidth() {
            return this.width - MasonryLayout_.PADDING * 2;
        }

        /**
         * Check if the effective width is valid.
         *
         * @param {number} effectiveWidth - The effective width to validate
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
         * Calculate the width of each column.
         *
         * @param {number} effectiveWidth - The effective width of the container
         * @returns {number} The column width
         * @private
         */
        _calculateColumnWidth(effectiveWidth) {
            const totalSpacing = this._spacing * (this._columns - 1);
            return Math.floor((effectiveWidth - totalSpacing) / this._columns);
        }

        /**
         * Check if the column width is valid.
         *
         * @param {number} columnWidth - The column width to validate
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
         * Render all items into the masonry layout.
         *
         * @param {Array<object>} items - Items to render
         * @param {number} columnWidth - Width of each column
         * @param {object} renderSession - Render session object
         * @private
         */
        _renderItems(items, columnWidth, renderSession) {
            const paddingLeft = MasonryLayout_.PADDING;

            for (const itemData of items) {
                this._items.push(itemData);

                if (!this._hasValidDimensions(itemData)) {
                    continue;
                }

                const itemHeight = this._calculateItemHeight(itemData, columnWidth);
                if (!this._isValidItemHeight(itemHeight)) {
                    continue;
                }

                const itemWidget = this._renderItemFn(itemData, renderSession);
                if (!itemWidget) {
                    continue;
                }

                const shortestColumnIndex = this._findShortestColumn();
                this._positionItem(itemWidget, shortestColumnIndex, columnWidth, itemHeight, paddingLeft);
                this._updateColumnHeight(shortestColumnIndex, itemHeight);
            }
        }

        /**
         * Check if item data has valid dimensions.
         *
         * @param {object} itemData - The item data
         * @returns {boolean} True if dimensions are valid
         * @private
         */
        _hasValidDimensions(itemData) {
            return itemData.width && itemData.height;
        }

        /**
         * Calculate item height based on aspect ratio.
         *
         * @param {object} itemData - The item data with width and height
         * @param {number} columnWidth - The width of the column
         * @returns {number} The calculated item height
         * @private
         */
        _calculateItemHeight(itemData, columnWidth) {
            const aspectRatio = itemData.height / itemData.width;
            return Math.round(columnWidth * aspectRatio);
        }

        /**
         * Check if the calculated item height is valid.
         *
         * @param {number} itemHeight - The item height to validate
         * @returns {boolean} True if valid
         * @private
         */
        _isValidItemHeight(itemHeight) {
            if (!isFinite(itemHeight) || itemHeight <= 0) {
                return false;
            }
            return true;
        }

        /**
         * Find the index of the shortest column.
         *
         * @returns {number} The column index
         * @private
         */
        _findShortestColumn() {
            return this._columnHeights.indexOf(Math.min(...this._columnHeights));
        }

        /**
         * Position an item widget in the layout.
         *
         * @param {St.Widget} itemWidget - The widget to position
         * @param {number} columnIndex - The column index
         * @param {number} columnWidth - The width of the column
         * @param {number} itemHeight - The height of the item
         * @param {number} paddingLeft - Left padding of the container
         * @private
         */
        _positionItem(itemWidget, columnIndex, columnWidth, itemHeight, paddingLeft) {
            const x = paddingLeft + columnIndex * (columnWidth + this._spacing);
            const y = this._columnHeights[columnIndex];

            // Store position data for vfunc_allocate
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
         *
         * @param {number} columnIndex - The column index
         * @param {number} itemHeight - The height of the added item
         * @private
         */
        _updateColumnHeight(columnIndex, itemHeight) {
            this._columnHeights[columnIndex] += itemHeight + this._spacing;
        }

        /**
         * Update the overall container height to match the tallest column.
         *
         * @private
         */
        _updateContainerHeight() {
            const maxHeight = Math.max(...this._columnHeights);

            if (isFinite(maxHeight) && maxHeight > 0) {
                this.height = maxHeight;
            }
        }

        /**
         * Re-layout all existing items (called when width changes).
         *
         * @private
         */
        _relayout() {
            const itemsToLayout = [...this._items];
            this.clear();
            this.addItems(itemsToLayout, {});
        }

        /**
         * Clean up resources when the widget is destroyed.
         */
        destroy() {
            this._cleanupPendingCallbacks();
            this._relayoutDebouncer?.destroy();
            super.destroy();
        }
    },
);
