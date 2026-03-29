import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

/**
 * Get the vertical scroll intent from a scroll event
 * @param {Clutter.Event} event The scroll event
 * @returns {number} The scroll intent with -1 for up, 1 for down, and 0 for no scroll
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
 * Check if the scroll adjustment is at a boundary
 * @param {St.Adjustment} adjustment The scroll adjustment
 * @param {number} scrollIntent The scroll intent with -1 for up, 1 for down, and 0 for no scroll
 * @returns {boolean} True if the adjustment is at a boundary
 */
function isScrollAdjustmentAtBoundary(adjustment, scrollIntent) {
    const lower = adjustment.lower;
    const upper = Math.max(adjustment.lower, adjustment.upper - adjustment.page_size);
    const epsilon = 0.5;
    const atTop = adjustment.value <= lower + epsilon;
    const atBottom = adjustment.value >= upper - epsilon;

    return (scrollIntent < 0 && atTop) || (scrollIntent > 0 && atBottom);
}

/**
 * A custom ScrollView that allows nested scrolling with pinned behavior.
 * It detects scroll direction and whether the scroll is at the boundary to determine when to hand off scrolling to an inner view or allow the outer view to scroll.
 * Used in the Recently Used extension to manage scrolling between the main list and pinned items.
 */
export const PinnedNestedScrollView = GObject.registerClass(
    class PinnedNestedScrollView extends St.ScrollView {
        /**
         * Initialize the PinnedNestedScrollView
         * @param {object} params The parameters for the ScrollView
         */
        constructor(params = {}) {
            super(params);
            this._onInnerScroll = null;
            this._onBoundaryHandoff = null;
        }

        /**
         * Set the callbacks for handling scroll handoff
         * @param {object} callbacks - The callbacks for inner scroll and boundary handoff
         * @param {function} callbacks.onInnerScroll - The callback for inner scroll events
         * @param {function} callbacks.onBoundaryHandoff - The callback for boundary handoff events
         */
        setHandoffCallbacks({ onInnerScroll = null, onBoundaryHandoff = null } = {}) {
            this._onInnerScroll = onInnerScroll;
            this._onBoundaryHandoff = onBoundaryHandoff;
        }

        /**
         * Handle scroll events
         * @param {Clutter.Event} event The scroll event
         * @returns {Clutter.EventPropagation} The event propagation result
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
