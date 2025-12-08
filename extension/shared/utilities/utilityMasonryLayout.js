import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

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
         */
        constructor(params) {
            super({
                layout_manager: new Clutter.BinLayout(),
                x_expand: true,
            });

            const { columns = 4, spacing = 2, renderItemFn } = params;

            this._columns = columns;
            this._spacing = spacing;
            this._renderItemFn = renderItemFn;
            this._columnHeights = new Array(this._columns).fill(0);
            this._items = [];
            this._pendingAllocationId = null;
            this._pendingTimeoutId = null;
            this._spatialMap = [];
            this.reactive = true;
            this.connect('key-press-event', this.handleKeyPress.bind(this));

            this._isDestroyed = false;
            this.connect('destroy', () => {
                this._isDestroyed = true;
                this._cleanupPendingCallbacks();
            });
        }

        /**
         * Handle allocation changes - triggers re-layout when width changes.
         *
         * @param {Clutter.ActorBox} box - The allocation box
         */
        vfunc_allocate(box) {
            super.vfunc_allocate(box);

            const newWidth = box.get_width();
            if (this.width !== newWidth) {
                this.width = newWidth;

                if (this._items.length > 0) {
                    this._relayout();
                }
            }
        }

        /**
         * Clear all items from the layout.
         */
        clear() {
            this.destroy_all_children();
            this._columnHeights = new Array(this._columns).fill(0);
            this._items = [];
            this.height = 0;
            this._spatialMap = [];
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

            const columnWidth = this._calculateColumnWidth(effectiveWidth);
            if (!this._isValidColumnWidth(columnWidth)) {
                return;
            }

            this._renderItems(items, columnWidth, renderSession);
            this._updateContainerHeight();
            this._buildSpatialMap();
        }

        /**
         * Builds a cache of item positions for fast keyboard navigation.
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

            const mapData = widgets.map((widget) => {
                const x1 = widget.x;
                const y1 = widget.y;
                const width = widget.width;
                const height = widget.height;
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

            const tolerance = 2;
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

            if (
                (direction === 'up' && currentItem.isTopEdge) ||
                (direction === 'left' && currentItem.isLeftEdge) ||
                (direction === 'right' && currentItem.isRightEdge) ||
                (direction === 'down' && currentItem.isBottomEdge)
            ) {
                return direction === 'up' ? Clutter.EVENT_PROPAGATE : Clutter.EVENT_STOP;
            }

            const nextWidget = this._findClosestInDirection(currentFocus, direction);
            if (nextWidget) nextWidget.grab_key_focus();

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

                const tolerance = 20;
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

                // Fallback if no overlap, by finding the closest from the vertical center
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
                    return direction === 'up' ? item.centerY < currentItem.centerY : item.centerY > currentItem.centerY;
                });

                if (candidatesInDirection.length === 0) return null;

                let minWeightedDistance = Infinity;
                for (const candidate of candidatesInDirection) {
                    const dX = Math.abs(candidate.centerX - currentItem.centerX);
                    const dY = Math.abs(candidate.centerY - currentItem.centerY);
                    const weightedDistance = Math.sqrt(Math.pow(dX * 5, 2) + Math.pow(dY, 2));

                    if (weightedDistance < minWeightedDistance) {
                        minWeightedDistance = weightedDistance;
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
            return this.width && this.width > 32;
        }

        /**
         * Defer rendering until a valid width is available.
         *
         * @param {Array<object>} items - Items to render
         * @param {object} renderSession - Render session object
         * @private
         */
        _deferRender(items, renderSession) {
            this._cleanupPendingCallbacks();

            const tryRender = () => {
                if (this._isDestroyed) return;
                this._cleanupPendingCallbacks();

                if (this._isValidWidth()) {
                    this.addItems(items, renderSession);
                }
            };

            this._pendingAllocationId = this.connect('notify::width', tryRender);

            this._pendingTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
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
            const paddingLeft = 8;
            const paddingRight = 8;
            return this.width - paddingLeft - paddingRight;
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
            const paddingLeft = 8;

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
            itemWidget.width = columnWidth;
            itemWidget.height = itemHeight;
            itemWidget.x = paddingLeft + columnIndex * (columnWidth + this._spacing);
            itemWidget.y = this._columnHeights[columnIndex];

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
            super.destroy();
        }
    },
);
