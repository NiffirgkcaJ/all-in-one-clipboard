import { Logger } from './utilityLogger.js';

// ========================================================================
// Geometries
// ========================================================================

/**
 * 1D linear layout geometry.
 */
export class LinearGeometry {
    /**
     * Initialize linear geometry.
     *
     * @param {Object} [config] Geometry configuration.
     */
    constructor(config = {}) {
        this.calculateItemHeight = config.calculateItemHeight || null;
        this.spacing = typeof config.spacing === 'number' ? config.spacing : 0;
        this.paddingTop = typeof config.paddingTop === 'number' ? config.paddingTop : 0;
    }

    /**
     * Compute item height from dimensions or callback.
     *
     * @param {Object} item Raw item data.
     * @returns {number} Resolved height in pixels.
     * @private
     */
    _resolveItemHeight(item) {
        if (this.calculateItemHeight) {
            return this.calculateItemHeight(item);
        }

        if (item && typeof item.height === 'number' && item.height > 0) {
            return Math.max(1, Math.round(item.height));
        }

        Logger.assert(false, 'LinearGeometry requires items to provide height metadata or calculateItemHeight callback.', 'Virtualization');
        return 0;
    }

    /**
     * Compute vertical positions for items.
     *
     * @param {Array<Object>} items List of items.
     * @returns {Object} Layout data and total height.
     */
    reconcile(items) {
        let currentY = this.paddingTop;
        const layoutData = [];

        for (const item of items) {
            const height = this._resolveItemHeight(item);
            layoutData.push({
                id: item.id,
                x: 0,
                y: currentY,
                width: 0,
                height,
                itemData: item,
            });
            currentY += height + this.spacing;
        }

        if (items.length > 0) {
            currentY -= this.spacing;
        }

        return {
            layoutData,
            totalHeight: Math.max(0, currentY),
        };
    }
}

/**
 * 2D columnar layout geometry.
 */
export class ColumnarGeometry {
    /**
     * Initialize columnar geometry.
     *
     * @param {Object} config Geometry configuration.
     */
    constructor(config) {
        Logger.assert(Boolean(config), 'ColumnarGeometry requires a configuration object.', 'Virtualization');

        const hasTargetWidth = typeof config.targetItemWidth === 'number' && config.targetItemWidth > 0;
        const hasColumns = typeof config.columns === 'number' && config.columns > 0;
        Logger.assert(hasTargetWidth || hasColumns, 'ColumnarGeometry requires either targetItemWidth or columns.', 'Virtualization');
        Logger.assert(typeof config.spacing === 'number' && config.spacing >= 0, 'ColumnarGeometry requires a non negative spacing number.', 'Virtualization');
        Logger.assert(typeof config.effectiveWidth === 'number' && config.effectiveWidth >= 0, 'ColumnarGeometry requires an effectiveWidth number.', 'Virtualization');

        this.columns = hasColumns ? config.columns : 1;
        this.targetItemWidth = hasTargetWidth ? config.targetItemWidth : 0;
        this.spacing = config.spacing;
        this.paddingLeft = typeof config.paddingLeft === 'number' ? config.paddingLeft : 0;
        this.effectiveWidth = config.effectiveWidth;
        this.maxColumns = typeof config.maxColumns === 'number' && config.maxColumns > 0 ? config.maxColumns : null;
        this.calculateItemHeight = config.calculateItemHeight || null;
        this._columnWidth = 0;
    }

    /**
     * Compute column count from effective width.
     *
     * @returns {number} Resolved column count.
     * @private
     */
    _resolveColumnCount() {
        if (!this.targetItemWidth || this.effectiveWidth <= 0) {
            return this.columns;
        }

        const cellWidth = this.targetItemWidth + this.spacing;
        let cols = Math.max(1, Math.floor((this.effectiveWidth + this.spacing) / cellWidth));
        if (this.maxColumns) {
            cols = Math.min(cols, this.maxColumns);
        }
        return cols;
    }

    /**
     * Compute item height from dimensions or aspect ratio.
     *
     * @param {Object} item Raw item data.
     * @returns {number} Calculated height in pixels.
     * @private
     */
    _resolveItemHeight(item) {
        if (this.calculateItemHeight) {
            return this.calculateItemHeight(item, this._columnWidth);
        }

        if (item && item.height && item.width) {
            const aspectRatio = item.height / item.width;
            return Math.max(1, Math.round(this._columnWidth * aspectRatio));
        }

        if (item && typeof item.height === 'number' && item.height > 0) {
            return Math.max(1, Math.round(item.height));
        }

        Logger.assert(false, 'ColumnarGeometry requires items to provide height metadata or calculateItemHeight callback.', 'Virtualization');
        return 0;
    }

    /**
     * Reconcile masonry layout and compute 2D positions.
     *
     * @param {Array<Object>} items List of items.
     * @returns {Object} Layout data and total height.
     */
    reconcile(items) {
        const cols = this._resolveColumnCount();
        const totalSpacing = this.spacing * (cols - 1);
        this._columnWidth = Math.max(1, Math.floor((this.effectiveWidth - totalSpacing) / cols));

        const columnHeights = new Array(cols).fill(0);
        const layoutData = [];

        for (const item of items) {
            const height = this._resolveItemHeight(item);

            let shortestIndex = 0;
            let shortestHeight = columnHeights[0];

            for (let i = 1; i < cols; i++) {
                if (columnHeights[i] < shortestHeight) {
                    shortestHeight = columnHeights[i];
                    shortestIndex = i;
                }
            }

            const x = this.paddingLeft + shortestIndex * (this._columnWidth + this.spacing);
            const y = columnHeights[shortestIndex];

            layoutData.push({
                id: item.id,
                x,
                y,
                width: this._columnWidth,
                height,
                itemData: item,
            });

            columnHeights[shortestIndex] += height + this.spacing;
        }

        const totalHeight = Math.max(0, ...columnHeights);
        return { layoutData, totalHeight };
    }
}

// ========================================================================
// Spatial Navigation
// ========================================================================

/**
 * Pure mathematical spatial navigation for grid and stack layouts.
 */
export class SpatialNavigator {
    /**
     * Find nearest candidate in specified direction.
     *
     * @param {Array<Object>} layoutData Computed layout data.
     * @param {string|number} currentId Current item identifier.
     * @param {string} direction Navigation direction.
     * @param {number} [columnTolerance] Column alignment tolerance.
     * @returns {Object|null} Nearest target layout item.
     */
    static findInDirection(layoutData, currentId, direction, columnTolerance = 20) {
        if (!layoutData || layoutData.length === 0) return null;

        const currentItem = layoutData.find((d) => String(d.id) === String(currentId));
        if (!currentItem) return null;

        if (direction === 'left' || direction === 'right') {
            return this._findHorizontal(layoutData, currentItem, direction, columnTolerance);
        }

        if (direction === 'up' || direction === 'down') {
            return this._findVertical(layoutData, currentItem, direction);
        }

        return null;
    }

    /**
     * Find nearest item in horizontal direction.
     *
     * @param {Array<Object>} layoutData Computed layout data.
     * @param {Object} currentItem Current layout item.
     * @param {string} direction Left or right direction.
     * @param {number} columnTolerance Column alignment tolerance.
     * @returns {Object|null} Matching candidate.
     * @private
     */
    static _findHorizontal(layoutData, currentItem, direction, columnTolerance) {
        const currentCenterX = currentItem.x + currentItem.width / 2;
        const currentCenterY = currentItem.y + currentItem.height / 2;

        const candidates = layoutData.filter((d) => {
            if (d.id === currentItem.id) return false;
            const cX = d.x + d.width / 2;
            return direction === 'right' ? cX > currentCenterX : cX < currentCenterX;
        });

        if (candidates.length === 0) return null;

        let minHorizontalDist = Infinity;
        for (const d of candidates) {
            const dist = Math.abs(d.x + d.width / 2 - currentCenterX);
            if (dist < minHorizontalDist) minHorizontalDist = dist;
        }

        const inTargetColumn = candidates.filter((d) => Math.abs(d.x + d.width / 2 - currentCenterX) < minHorizontalDist + columnTolerance);

        let bestCandidate = null;
        let maxOverlap = -1;

        for (const cand of inTargetColumn) {
            const overlapTop = Math.max(currentItem.y, cand.y);
            const overlapBottom = Math.min(currentItem.y + currentItem.height, cand.y + cand.height);
            const overlap = Math.max(0, overlapBottom - overlapTop);
            if (overlap > maxOverlap) {
                maxOverlap = overlap;
                bestCandidate = cand;
            }
        }

        if (!bestCandidate || maxOverlap <= 0) {
            let minCenterYDist = Infinity;
            for (const cand of inTargetColumn) {
                const dist = Math.abs(cand.y + cand.height / 2 - currentCenterY);
                if (dist < minCenterYDist) {
                    minCenterYDist = dist;
                    bestCandidate = cand;
                }
            }
        }

        return bestCandidate;
    }

    /**
     * Find nearest item in vertical direction.
     *
     * @param {Array<Object>} layoutData Computed layout data.
     * @param {Object} currentItem Current layout item.
     * @param {string} direction Up or down direction.
     * @returns {Object|null} Matching candidate.
     * @private
     */
    static _findVertical(layoutData, currentItem, direction) {
        const currentCenterY = currentItem.y + currentItem.height / 2;

        const candidates = layoutData.filter((d) => {
            if (d.id === currentItem.id) return false;
            const cY = d.y + d.height / 2;
            const inDirection = direction === 'up' ? cY < currentCenterY : cY > currentCenterY;
            if (!inDirection) return false;

            const isSameStackColumn = currentItem.width <= 0 && d.width <= 0;
            const isOverlappingColumn = d.x < currentItem.x + currentItem.width && d.x + d.width > currentItem.x;
            return isSameStackColumn || isOverlappingColumn;
        });

        if (candidates.length === 0) return null;

        let minVertDist = Infinity;
        let bestCandidate = null;

        for (const cand of candidates) {
            const dY = Math.abs(cand.y + cand.height / 2 - currentCenterY);
            if (dY < minVertDist) {
                minVertDist = dY;
                bestCandidate = cand;
            }
        }

        return bestCandidate;
    }

    /**
     * Find top row item closest to target horizontal center.
     *
     * @param {Array<Object>} layoutData Computed layout data.
     * @param {number} [targetCenterX] Optional target horizontal center.
     * @returns {Object|null} Matching item.
     */
    static findFirst(layoutData, targetCenterX) {
        if (!layoutData || layoutData.length === 0) return null;
        if (targetCenterX === undefined) return layoutData[0];

        const minY = Math.min(...layoutData.map((d) => d.y));
        const topRowItems = layoutData.filter((d) => d.y <= minY + 2);
        let minDistance = Infinity;
        let best = topRowItems[0] || layoutData[0];

        for (const d of topRowItems) {
            const centerX = d.x + d.width / 2;
            const dist = Math.abs(centerX - targetCenterX);
            if (dist < minDistance) {
                minDistance = dist;
                best = d;
            }
        }

        return best;
    }

    /**
     * Find bottom row item closest to target horizontal center.
     *
     * @param {Array<Object>} layoutData Computed layout data.
     * @param {number} [targetCenterX] Optional target horizontal center.
     * @returns {Object|null} Matching item.
     */
    static findLast(layoutData, targetCenterX) {
        if (!layoutData || layoutData.length === 0) return null;
        if (targetCenterX === undefined) return layoutData[layoutData.length - 1];

        let bestY = -Infinity;
        let minXDistance = Infinity;
        let target = layoutData[layoutData.length - 1];

        for (const d of layoutData) {
            const centerX = d.x + d.width / 2;
            const xDistance = Math.abs(centerX - targetCenterX);
            const hasColumnOverlap = d.x < targetCenterX && d.x + d.width > targetCenterX;
            if (!hasColumnOverlap && xDistance > d.width / 2) continue;

            const bottomY = d.y + d.height;
            if (bottomY > bestY || (bottomY === bestY && xDistance < minXDistance)) {
                bestY = bottomY;
                minXDistance = xDistance;
                target = d;
            }
        }

        return target;
    }
}

// ========================================================================
// VirtualizationEngine
// ========================================================================

/**
 * Pure math engine for computing viewport visibility and layout coordinates.
 */
export class VirtualizationEngine {
    /**
     * Initialize virtualization engine.
     *
     * @param {Object} config Engine configuration.
     */
    constructor(config = {}) {
        this._mode = config.mode || config.strategy;
        Logger.assert(Boolean(this._mode), 'VirtualizationEngine requires a mode.', 'Virtualization');

        this._geometryConfig = config.geometryConfig || config.strategyConfig || {};
        this._overscanPx = typeof config.overscanPx === 'number' ? config.overscanPx : 0;

        this._scrollTop = 0;
        this._viewportHeight = 0;
        this._totalHeight = 0;
        this._pinnedItemId = null;

        this._layoutData = [];
        this._visibleIndices = new Set();
        this._onVisibleItemsChanged = config.onVisibleItemsChanged || null;

        this._initGeometry();
    }

    /**
     * Initialize active math geometry.
     *
     * @private
     */
    _initGeometry() {
        const normalizedMode = this._mode === 'stack' ? 'linear' : this._mode === 'masonry' ? 'columnar' : this._mode;

        if (normalizedMode === 'linear') {
            this._geometry = new LinearGeometry(this._geometryConfig);
        } else if (normalizedMode === 'columnar') {
            this._geometry = new ColumnarGeometry(this._geometryConfig);
        } else {
            Logger.assert(false, `Unknown virtualization mode: ${this._mode}`, 'Virtualization');
        }
    }

    /**
     * Update configuration and reinitialize geometry when needed.
     *
     * @param {Object} config Updated configuration.
     */
    updateConfig(config) {
        let geometryChanged = false;

        const newMode = config.mode || config.strategy;
        if (newMode !== undefined && newMode !== this._mode) {
            this._mode = newMode;
            geometryChanged = true;
        }

        const newGeometryConfig = config.geometryConfig || config.strategyConfig;
        if (newGeometryConfig !== undefined) {
            this._geometryConfig = { ...this._geometryConfig, ...newGeometryConfig };
            geometryChanged = true;
        }

        if (config.overscanPx !== undefined) {
            this._overscanPx = config.overscanPx;
        }

        if (config.onVisibleItemsChanged !== undefined) {
            this._onVisibleItemsChanged = config.onVisibleItemsChanged;
        }

        if (geometryChanged) {
            this._initGeometry();
        }
    }

    /**
     * Update scroll viewport boundaries.
     *
     * @param {number} scrollTop Current scroll top position.
     * @param {number} viewportHeight Visible viewport height.
     */
    setViewport(scrollTop, viewportHeight) {
        let changed = false;

        if (scrollTop !== this._scrollTop) {
            this._scrollTop = scrollTop;
            changed = true;
        }

        if (viewportHeight !== this._viewportHeight) {
            this._viewportHeight = viewportHeight;
            changed = true;
        }

        if (changed) {
            this._recalculateVisible();
        }
    }

    /**
     * Set pinned item identifier that should never be unmounted.
     *
     * @param {string|number|null} itemId Identifier to pin or null to clear.
     */
    setPinnedItemId(itemId) {
        const normalizedId = itemId !== undefined && itemId !== null ? String(itemId) : null;
        if (this._pinnedItemId === normalizedId) return;
        this._pinnedItemId = normalizedId;
        this._recalculateVisible();
    }

    /**
     * Clear all layout data, visible items, and pins without notifying consumer.
     */
    clear() {
        this._pinnedItemId = null;
        this._scrollTop = 0;
        this._layoutData = [];
        this._visibleIndices.clear();
        this._totalHeight = 0;
    }

    /**
     * Permanently disconnect the visible items callback and clear all state.
     */
    dispose() {
        this._onVisibleItemsChanged = null;
        this.clear();
    }

    /**
     * Ingest items and compute layout coordinates.
     *
     * @param {Array<Object>} items Raw item objects.
     */
    reconcileItems(items) {
        const result = this._geometry.reconcile(items);
        this._layoutData = result.layoutData;
        this._totalHeight = result.totalHeight;
        this._recalculateVisible(true);
    }

    /**
     * Retrieve full computed layout data.
     *
     * @returns {Array<Object>} All layout items with coordinates.
     */
    getLayoutData() {
        return this._layoutData;
    }

    /**
     * Retrieve total container height.
     *
     * @returns {number} Total container height in pixels.
     */
    getTotalHeight() {
        return this._totalHeight;
    }

    /**
     * Retrieve visible items within viewport.
     *
     * @returns {Array<Object>} List of visible layout items.
     */
    getVisibleItems() {
        return Array.from(this._visibleIndices).map((idx) => this._layoutData[idx]);
    }

    /**
     * Retrieve identifiers of visible items.
     *
     * @returns {Set<string|number>} Set of visible item identifiers.
     */
    getVisibleIds() {
        return new Set(Array.from(this._visibleIndices).map((idx) => this._layoutData[idx].id));
    }

    /**
     * Recalculate intersecting items and notify on change.
     *
     * @param {boolean} [force] Force change notification regardless of index set equality.
     * @private
     */
    _recalculateVisible(force = false) {
        const topBound = Math.max(0, this._scrollTop - this._overscanPx);
        const bottomBound = this._scrollTop + this._viewportHeight + this._overscanPx;

        const newVisibleIndices = new Set();

        for (let i = 0; i < this._layoutData.length; i++) {
            const data = this._layoutData[i];
            const itemTop = data.y;
            const itemBottom = data.y + data.height;

            const isVisible = itemBottom >= topBound && itemTop <= bottomBound;
            const isPinned = Boolean(this._pinnedItemId && String(data.id) === this._pinnedItemId);

            if (isVisible || isPinned) {
                newVisibleIndices.add(i);
            }
        }

        let isChanged = newVisibleIndices.size !== this._visibleIndices.size;

        if (!isChanged) {
            for (const idx of newVisibleIndices) {
                if (!this._visibleIndices.has(idx)) {
                    isChanged = true;
                    break;
                }
            }
        }

        this._visibleIndices = newVisibleIndices;

        if ((isChanged || force) && this._onVisibleItemsChanged) {
            this._onVisibleItemsChanged({
                visibleItems: this.getVisibleItems(),
                visibleIds: this.getVisibleIds(),
                totalHeight: this._totalHeight,
            });
        }
    }
}
