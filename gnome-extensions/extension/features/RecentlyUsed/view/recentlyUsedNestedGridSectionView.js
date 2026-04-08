import Clutter from 'gi://Clutter';
import St from 'gi://St';

import { RecentlyUsedDefaultPolicy } from '../constants/recentlyUsedPolicyConstants.js';
import { RecentlyUsedNestedScrollView } from '../utilities/recentlyUsedNestedScrollView.js';
import { RecentlyUsedUI } from '../constants/recentlyUsedConstants.js';
import { RecentlyUsedNestedGridViewTuning, RecentlyUsedNestedViewTuning } from '../constants/recentlyUsedViewConstants.js';

// ========================================================================
// Width/Measurement Helpers
// ========================================================================

/**
 * Reads the allocated width of a Clutter actor.
 *
 * @param {Clutter.Actor} actor Target actor.
 * @returns {number} Allocated width or 0.
 */
function readAllocatedWidth(actor) {
    const allocation = actor?.get_allocation_box?.();
    if (!allocation) {
        return 0;
    }

    const width = allocation.x2 - allocation.x1;
    return Number.isFinite(width) && width > 0 ? Math.floor(width) : 0;
}

/**
 * Reads the natural preferred width of a Clutter actor.
 *
 * @param {Clutter.Actor} actor Target actor.
 * @returns {number} Preferred width or 0.
 */
function readPreferredWidth(actor) {
    const preferred = actor?.get_preferred_width?.(-1);
    const naturalWidth = Array.isArray(preferred) ? preferred[1] : 0;
    return Number.isFinite(naturalWidth) && naturalWidth > 0 ? Math.floor(naturalWidth) : 0;
}

// ========================================================================
// Layout Resolution
// ========================================================================

/**
 * Resolves the effective column count for a nested grid section.
 *
 * @param {object} params Resolution context.
 * @param {object} params.sectionData Section state.
 * @param {St.ScrollView} params.nestedScrollView Inner scroll container.
 * @param {St.Widget} params.grid Grid widget.
 * @param {Gio.Settings} params.settings Extension settings.
 * @param {number} params.requestedColumnCount Requested column count.
 * @returns {number} Effective column count.
 */
function resolveEffectiveNestedGridColumnCount({ sectionData, nestedScrollView, grid, settings, requestedColumnCount }) {
    const settingsWidth = settings?.get_int?.('extension-width') ?? 0;
    const widthCandidates = [
        sectionData?.bodyContainer?.get_width?.() ?? 0,
        readAllocatedWidth(sectionData?.bodyContainer),
        readPreferredWidth(sectionData?.bodyContainer),
        nestedScrollView.get_width?.() ?? 0,
        readAllocatedWidth(nestedScrollView),
        readPreferredWidth(nestedScrollView),
        sectionData?.section?.get_width?.() ?? 0,
        readAllocatedWidth(sectionData?.section),
        settingsWidth,
        grid.get_width?.() ?? 0,
    ];

    const availableWidth = widthCandidates.reduce((maxWidth, candidate) => {
        if (!Number.isFinite(candidate)) {
            return maxWidth;
        }

        const normalized = Math.floor(candidate);
        return normalized > maxWidth ? normalized : maxWidth;
    }, 0);

    if (availableWidth <= 0) {
        return Math.max(1, Math.min(requestedColumnCount, RecentlyUsedDefaultPolicy.GRID_WINDOW_COLUMNS));
    }

    const spacing = RecentlyUsedUI.GRID_COLUMN_SPACING;
    const usableWidth = Math.max(0, availableWidth - RecentlyUsedNestedGridViewTuning.HORIZONTAL_PADDING);
    const fitColumns = Math.max(1, Math.floor((usableWidth + spacing) / (RecentlyUsedNestedGridViewTuning.MIN_ITEM_WIDTH + spacing)));
    return Math.max(1, Math.min(requestedColumnCount, fitColumns));
}

/**
 * Resolves layout configuration for a nested grid section.
 *
 * @param {object} nestedLayout Nested layout values.
 * @param {object} resolvedPolicy Resolved display policy model.
 * @returns {object} Resolved configuration.
 */
function resolveNestedGridConfig(nestedLayout, resolvedPolicy) {
    const policyColumns = resolvedPolicy?.limits?.gridColumns;
    const rawColumnCount = policyColumns ?? nestedLayout?.columnCount;
    const requestedColumnCount = Number.isFinite(rawColumnCount) && rawColumnCount > 0 ? Math.floor(rawColumnCount) : RecentlyUsedDefaultPolicy.GRID_WINDOW_COLUMNS;

    const policyVisibleRows = resolvedPolicy?.limits?.gridVisibleRows;
    const rawMaxVisibleRows = policyVisibleRows ?? nestedLayout?.maxVisibleRows;
    const maxVisibleRows = Number.isFinite(rawMaxVisibleRows) && rawMaxVisibleRows > 0 ? Math.floor(rawMaxVisibleRows) : RecentlyUsedDefaultPolicy.GRID_WINDOW_ROWS;

    const rawItemHeight = nestedLayout?.itemHeight;
    const itemHeight = Number.isFinite(rawItemHeight) && rawItemHeight > 0 ? Math.floor(rawItemHeight) : RecentlyUsedUI.NESTED_ITEM_HEIGHT;
    const bottomThresholdPx = Math.max(Math.floor(itemHeight * RecentlyUsedNestedViewTuning.BOTTOM_THRESHOLD_ITEM_HEIGHT_MULTIPLIER), RecentlyUsedNestedViewTuning.BOTTOM_THRESHOLD_MIN_PX);

    return { requestedColumnCount, maxVisibleRows, itemHeight, bottomThresholdPx };
}

// ========================================================================
// Scroll Lifecycle
// ========================================================================

/**
 * Connects scroll-triggered virtual append and teardown lifecycle.
 *
 * @param {object} params Lifecycle context.
 * @param {St.ScrollView} params.nestedScrollView Inner scroll container.
 * @param {number} params.bottomThresholdPx Remaining scroll distance to trigger append.
 * @param {number} params.appendChunkSize Items per append batch.
 * @param {Function} params.isComplete Returns true when all items are rendered.
 * @param {Function} params.appendItems Appends a batch of items.
 */
function connectNestedScrollLifecycle({ nestedScrollView, bottomThresholdPx, appendChunkSize, isComplete, appendItems }) {
    const maybeAppendMore = () => {
        if (isComplete()) {
            return;
        }

        let safety = 0;

        while (!isComplete() && safety < RecentlyUsedNestedViewTuning.MAX_SCROLL_APPEND_ITERATIONS) {
            const adjustment = nestedScrollView.vadjustment;
            if (!adjustment) {
                break;
            }

            const maxValue = Math.max(adjustment.lower, adjustment.upper - adjustment.page_size);
            const remaining = maxValue - adjustment.value;
            if (remaining > bottomThresholdPx) {
                break;
            }

            appendItems(appendChunkSize);
            safety++;
        }
    };

    const adjustment = nestedScrollView.vadjustment;
    let adjustmentSignalId = 0;

    if (adjustment && !isComplete()) {
        adjustmentSignalId = adjustment.connect('notify::value', () => {
            maybeAppendMore();
        });
    }

    nestedScrollView.connect('destroy', () => {
        if (!adjustment || !adjustmentSignalId) {
            return;
        }

        try {
            adjustment.disconnect(adjustmentSignalId);
        } catch {
            // Ignore stale disconnect during actor teardown.
        }
        adjustmentSignalId = 0;
    });

    maybeAppendMore();
}

// ========================================================================
// Public Renderer
// ========================================================================

/**
 * Render a nested grid section with wrapped rows inside an inner scroll container.
 * Returns layout result for focus wiring.
 *
 * @param {object} params
 * @param {string} params.id Section id
 * @param {object} params.nestedLayout Nested layout values
 * @param {number} params.nestedLayout.columnCount Number of columns per row
 * @param {number} params.nestedLayout.maxVisibleRows Max visible rows in nested viewport
 * @param {number} params.nestedLayout.itemHeight Height per nested row item
 * @param {object} [params.resolvedPolicy] Resolved display policy model
 * @param {object} params.sections Section map
 * @param {Array<object>} params.items Pre-resolved items
 * @param {Array<Array<object>>} params.focusGrid Focus matrix
 * @param {Function} params.createItemWidget Callback creating item widgets
 * @param {object} params.scrollLockController Scroll lock controller
 * @param {Gio.Settings} [params.settings] Extension settings object
 * @returns {object} Layout result for focus wiring
 */
export function renderRecentlyUsedNestedGridSection({ id, nestedLayout, resolvedPolicy, sections, items, focusGrid, createItemWidget, scrollLockController, settings = null }) {
    const sectionData = sections[id];

    const sourceItems = Array.isArray(items) ? items : [];
    const config = resolveNestedGridConfig(nestedLayout, resolvedPolicy);

    sectionData.section.show();
    focusGrid.push([sectionData.showAllBtn]);

    const nestedScrollView = new RecentlyUsedNestedScrollView({
        hscrollbar_policy: St.PolicyType.NEVER,
        vscrollbar_policy: St.PolicyType.AUTOMATIC,
        overlay_scrollbars: true,
        x_expand: true,
    });

    const container = new St.BoxLayout({ vertical: true, x_expand: true });

    const grid = new St.Widget({
        layout_manager: new Clutter.GridLayout({
            column_homogeneous: true,
            column_spacing: RecentlyUsedUI.GRID_COLUMN_SPACING,
            row_spacing: RecentlyUsedUI.GRID_ROW_SPACING,
        }),
        x_expand: true,
    });

    container.add_child(grid);

    nestedScrollView.set_child(container);
    sectionData.bodyContainer.set_child(nestedScrollView);
    scrollLockController?.configureNestedScrollHandoff(nestedScrollView);

    const effectiveColumnCount = resolveEffectiveNestedGridColumnCount({
        sectionData,
        nestedScrollView,
        grid,
        settings,
        requestedColumnCount: config.requestedColumnCount,
    });
    const windowSize = effectiveColumnCount * config.maxVisibleRows;
    const appendChunkSize = Number.isFinite(resolvedPolicy?.limits?.gridWindowSize) && resolvedPolicy.limits.gridWindowSize > 0 ? Math.floor(resolvedPolicy.limits.gridWindowSize) : windowSize;

    const layout = grid.get_layout_manager();
    const widgets = [];
    const focusRowsByIndex = new Map();
    let renderedCount = 0;
    let viewportMaxHeight = 0;

    const resolveContentHeight = () => {
        const [, naturalHeight] = grid.get_preferred_height(-1);
        return Math.max(0, Math.ceil(naturalHeight));
    };

    const updateViewportHeight = () => {
        const contentHeight = resolveContentHeight();
        const targetHeight = viewportMaxHeight > 0 ? Math.min(viewportMaxHeight, contentHeight) : contentHeight;
        const adjustedHeight = targetHeight > 0 ? targetHeight + RecentlyUsedNestedViewTuning.VIEWPORT_HEIGHT_EPSILON : 0;
        nestedScrollView.style = `height: ${adjustedHeight}px;`;
    };

    const appendItems = (count) => {
        if (!Number.isFinite(count) || count <= 0 || renderedCount >= sourceItems.length) {
            return;
        }

        const targetCount = Math.min(renderedCount + Math.floor(count), sourceItems.length);

        while (renderedCount < targetCount) {
            const item = sourceItems[renderedCount];
            const row = Math.floor(renderedCount / effectiveColumnCount);
            const col = renderedCount % effectiveColumnCount;

            const widget = createItemWidget(item, id);
            layout.attach(widget, col, row, 1, 1);
            widgets.push(widget);

            let rowWidgets = focusRowsByIndex.get(row);
            if (!rowWidgets) {
                rowWidgets = [];
                focusRowsByIndex.set(row, rowWidgets);
                focusGrid.push(rowWidgets);
            }

            rowWidgets.push(widget);
            renderedCount++;
        }

        updateViewportHeight();
    };

    appendItems(windowSize);

    viewportMaxHeight = resolveContentHeight();
    updateViewportHeight();

    connectNestedScrollLifecycle({
        nestedScrollView,
        bottomThresholdPx: config.bottomThresholdPx,
        appendChunkSize,
        isComplete: () => renderedCount >= sourceItems.length,
        appendItems,
    });

    return {
        widgets,
        nestedScrollView,
        showAllBtn: sectionData.showAllBtn,
    };
}
