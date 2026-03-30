/**
 * Encapsulates outer scroll locking behavior for the Recently Used tab.
 */
export class RecentlyUsedScrollLockController {
    /**
     * @param {St.ScrollView} scrollView Outer scroll view to control
     */
    constructor(scrollView) {
        this._scrollView = scrollView;
        this._outerScrollLocked = false;
        this._lockedScrollValue = 0;
        this._scrollLockHandler = null;
    }

    /**
     * Lock the outer scroll view to prevent automatic focus tracking.
     */
    lock() {
        if (this._outerScrollLocked || !this._scrollView?.vadjustment) {
            return;
        }

        this._lockedScrollValue = this._scrollView.vadjustment.value;
        this._outerScrollLocked = true;

        this._scrollLockHandler = this._scrollView.vadjustment.connect('notify::value', () => {
            if (!this._outerScrollLocked) {
                return;
            }

            if (this._scrollView.vadjustment.value !== this._lockedScrollValue) {
                this._scrollView.vadjustment.set_value(this._lockedScrollValue);
            }
        });
    }

    /**
     * Unlock the outer scroll view to allow normal scrolling.
     */
    unlock() {
        if (!this._outerScrollLocked) {
            return;
        }

        this._outerScrollLocked = false;

        if (this._scrollLockHandler && this._scrollView?.vadjustment) {
            this._scrollView.vadjustment.disconnect(this._scrollLockHandler);
            this._scrollLockHandler = null;
        }
    }

    /**
     * Wire nested pinned scroll handoff callbacks for parent lock behavior.
     *
     * @param {object} pinnedScrollView Nested pinned list scroll view
     */
    configurePinnedScrollHandoff(pinnedScrollView) {
        if (!pinnedScrollView || typeof pinnedScrollView.setHandoffCallbacks !== 'function') {
            return;
        }

        pinnedScrollView.setHandoffCallbacks({
            onInnerScroll: () => {
                this.lock();
            },
            onBoundaryHandoff: () => {
                this.unlock();
            },
        });
    }

    /**
     * Cleanup controller resources.
     */
    destroy() {
        this.unlock();
        this._scrollView = null;
    }
}
