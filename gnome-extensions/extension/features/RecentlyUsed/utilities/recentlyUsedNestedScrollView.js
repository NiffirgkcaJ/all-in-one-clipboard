import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import { RecentlyUsedNestedViewTuning } from '../constants/recentlyUsedViewConstants.js';

// ========================================================================
// Scroll Helpers
// ========================================================================

/**
 * Converts a scroll event into a vertical scroll intent.
 *
 * @param {Clutter.Event} event Scroll event.
 * @returns {number} -1 for up, 1 for down, 0 for no vertical intent.
 */
function getVerticalScrollIntent(event) {
    const direction = event.get_scroll_direction();

    if (direction === Clutter.ScrollDirection.SMOOTH) {
        const [dx, dy] = event.get_scroll_delta();
        if (Math.abs(dy) <= Math.abs(dx) || dy === 0) {
            return 0;
        }
        return dy > 0 ? 1 : -1;
    }

    if (direction === Clutter.ScrollDirection.UP) {
        return -1;
    }

    if (direction === Clutter.ScrollDirection.DOWN) {
        return 1;
    }

    return 0;
}

/**
 * Checks whether an adjustment is at its boundary for a given intent.
 *
 * @param {St.Adjustment} adjustment Vertical adjustment.
 * @param {number} scrollIntent Intended scroll direction.
 * @returns {boolean} True when boundary is reached.
 */
function isScrollAdjustmentAtBoundary(adjustment, scrollIntent) {
    const lower = adjustment.lower;
    const upper = Math.max(adjustment.lower, adjustment.upper - adjustment.page_size);
    const epsilon = RecentlyUsedNestedViewTuning.SCROLL_BOUNDARY_EPSILON;
    const atTop = adjustment.value <= lower + epsilon;
    const atBottom = adjustment.value >= upper - epsilon;

    return (scrollIntent < 0 && atTop) || (scrollIntent > 0 && atBottom);
}

// ========================================================================
// Nested Scroll View
// ========================================================================

/**
 * Scroll view that supports inner-scroll and boundary handoff callbacks.
 */
export const RecentlyUsedNestedScrollView = GObject.registerClass(
    class RecentlyUsedNestedScrollView extends St.ScrollView {
        /**
         * Creates a nested scroll view instance.
         *
         * @param {object} params Scroll view constructor params.
         */
        constructor(params = {}) {
            super(params);
            this._onInnerScroll = null;
            this._onBoundaryHandoff = null;
        }

        /**
         * Sets callbacks for inner scrolling and boundary handoff.
         *
         * @param {object} callbacks Callback object.
         * @param {Function|null} callbacks.onInnerScroll Called during inner scroll.
         * @param {Function|null} callbacks.onBoundaryHandoff Called on boundary handoff.
         */
        setHandoffCallbacks({ onInnerScroll = null, onBoundaryHandoff = null } = {}) {
            this._onInnerScroll = onInnerScroll;
            this._onBoundaryHandoff = onBoundaryHandoff;
        }

        /**
         * Handles scroll events and delegates to callbacks when needed.
         *
         * @param {Clutter.Event} event Scroll event.
         * @returns {boolean} Clutter event propagation status.
         */
        vfunc_scroll_event(event) {
            const scrollIntent = getVerticalScrollIntent(event);
            if (scrollIntent === 0) {
                return super.vfunc_scroll_event(event);
            }

            const adjustment = this.vadjustment;
            if (!adjustment) {
                return super.vfunc_scroll_event(event);
            }

            if (isScrollAdjustmentAtBoundary(adjustment, scrollIntent)) {
                this._onBoundaryHandoff?.();
                return Clutter.EVENT_PROPAGATE;
            }

            this._onInnerScroll?.();
            return super.vfunc_scroll_event(event);
        }
    },
);
