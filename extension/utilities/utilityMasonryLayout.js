import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

/**
 * MasonryLayout - A Pinterest-style masonry layout widget for displaying items in columns.
 *
 * Items are distributed across columns with the shortest column always receiving the next item.
 * Automatically re-layouts when the widget width changes.
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
    _init(params) {
        super._init({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true
        });

        const { columns = 4, spacing = 2, renderItemFn } = params;

        this._columns = columns;
        this._spacing = spacing;
        this._renderItemFn = renderItemFn;
        this._columnHeights = new Array(this._columns).fill(0);
        this._items = [];
        this._pendingAllocationId = null;
        this._pendingTimeoutId = null;
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
    }

    /**
     * Check if the current width is valid for rendering.
     *
     * @returns {boolean} True if width is valid
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
            this._cleanupPendingCallbacks();

            if (this._isValidWidth()) {
                this.addItems(items, renderSession);
            }
        };

        this._pendingAllocationId = this.connect('notify::width', tryRender);

        this._pendingTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this._pendingTimeoutId = null;
            tryRender();
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
            this.disconnect(this._pendingAllocationId);
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
        return (effectiveWidth - totalSpacing) / this._columns;
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
        itemWidget.x = paddingLeft + (columnIndex * (columnWidth + this._spacing));
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
});