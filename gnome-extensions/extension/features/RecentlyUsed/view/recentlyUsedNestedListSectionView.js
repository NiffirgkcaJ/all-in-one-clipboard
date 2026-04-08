import St from 'gi://St';

import { RecentlyUsedDefaultPolicy } from '../constants/recentlyUsedPolicyConstants.js';
import { RecentlyUsedNestedScrollView } from '../utilities/recentlyUsedNestedScrollView.js';
import { RecentlyUsedNestedViewTuning } from '../constants/recentlyUsedViewConstants.js';
import { RecentlyUsedUI } from '../constants/recentlyUsedConstants.js';

// ========================================================================
// Layout Resolution
// ========================================================================

/**
 * Resolves layout configuration for a nested list section.
 *
 * @param {object} nestedLayout Nested layout values.
 * @param {object} resolvedPolicy Resolved display policy model.
 * @returns {object} Resolved configuration.
 */
function resolveNestedListConfig(nestedLayout, resolvedPolicy) {
    const policyWindowLimit = resolvedPolicy?.limits?.windowLimit;
    const maxVisible =
        Number.isFinite(nestedLayout?.maxVisible) && nestedLayout.maxVisible > 0
            ? Math.floor(nestedLayout.maxVisible)
            : Number.isFinite(policyWindowLimit) && policyWindowLimit > 0
              ? Math.floor(policyWindowLimit)
              : RecentlyUsedDefaultPolicy.LIST_VISIBLE_ITEMS;

    const rawItemHeight = nestedLayout?.itemHeight;
    const itemHeight = Number.isFinite(rawItemHeight) && rawItemHeight > 0 ? Math.floor(rawItemHeight) : RecentlyUsedUI.NESTED_ITEM_HEIGHT;
    const appendChunkSize = Number.isFinite(resolvedPolicy?.limits?.listVisibleLimit) && resolvedPolicy.limits.listVisibleLimit > 0 ? Math.floor(resolvedPolicy.limits.listVisibleLimit) : maxVisible;
    const bottomThresholdPx = Math.max(Math.floor(itemHeight * RecentlyUsedNestedViewTuning.BOTTOM_THRESHOLD_ITEM_HEIGHT_MULTIPLIER), RecentlyUsedNestedViewTuning.BOTTOM_THRESHOLD_MIN_PX);

    return { maxVisible, itemHeight, appendChunkSize, bottomThresholdPx };
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
 * Render a nested list section with items inside an inner scroll container.
 * Returns layout result for focus wiring.
 *
 * @param {object} params
 * @param {string} params.id Section id
 * @param {object} params.nestedLayout Nested layout values
 * @param {number} params.nestedLayout.maxVisible Max visible items in nested viewport
 * @param {number} params.nestedLayout.itemHeight Height per nested row item
 * @param {object} [params.resolvedPolicy] Resolved display policy model
 * @param {object} params.sections Section map
 * @param {Array<object>} params.items Pre-resolved items
 * @param {Array<Array<object>>} params.focusGrid Focus matrix
 * @param {Function} params.createItemWidget Callback creating item widgets
 * @param {object} params.scrollLockController Scroll lock controller
 * @returns {object} Layout result for focus wiring
 */
export function renderRecentlyUsedNestedListSection({ id, nestedLayout, resolvedPolicy, sections, items, focusGrid, createItemWidget, scrollLockController }) {
    const sectionData = sections[id];

    const sourceItems = Array.isArray(items) ? items : [];
    const config = resolveNestedListConfig(nestedLayout, resolvedPolicy);

    sectionData.section.show();
    focusGrid.push([sectionData.showAllBtn]);

    const nestedScrollView = new RecentlyUsedNestedScrollView({
        hscrollbar_policy: St.PolicyType.NEVER,
        vscrollbar_policy: St.PolicyType.AUTOMATIC,
        overlay_scrollbars: true,
        x_expand: true,
    });

    const container = new St.BoxLayout({ vertical: true, x_expand: true });

    nestedScrollView.set_child(container);
    sectionData.bodyContainer.set_child(nestedScrollView);
    scrollLockController?.configureNestedScrollHandoff(nestedScrollView);

    const widgets = [];
    let renderedCount = 0;
    let viewportMaxHeight = 0;

    const resolveContentHeight = () => {
        const [, naturalHeight] = container.get_preferred_height(-1);
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
            const widget = createItemWidget(item, id);
            container.add_child(widget);
            widgets.push(widget);
            focusGrid.push([widget]);
            renderedCount++;
        }

        updateViewportHeight();
    };

    appendItems(config.maxVisible);

    viewportMaxHeight = resolveContentHeight();
    updateViewportHeight();

    connectNestedScrollLifecycle({
        nestedScrollView,
        bottomThresholdPx: config.bottomThresholdPx,
        appendChunkSize: config.appendChunkSize,
        isComplete: () => renderedCount >= sourceItems.length,
        appendItems,
    });

    return {
        widgets,
        nestedScrollView,
        showAllBtn: sectionData.showAllBtn,
    };
}
