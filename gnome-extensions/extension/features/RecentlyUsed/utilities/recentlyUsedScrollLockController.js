/**
 * Encapsulates outer scroll locking behavior for the Recently Used tab.
 */
export class RecentlyUsedScrollLockController {
    // ========================================================================
    // Lifecycle
    // ========================================================================

    /**
     * Creates a scroll lock controller.
     *
     * @param {St.ScrollView} scrollView Outer scroll view to control.
     */
    constructor(scrollView) {
        this._scrollView = scrollView;
        this._outerScrollLocked = false;
        this._lockedScrollValue = 0;
        this._scrollLockHandler = null;
    }

    // ========================================================================
    // Lock Controls
    // ========================================================================

    /**
     * Lock the outer scroll view to prevent automatic layout adjustments.
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
     * Unlocks the outer scroll view.
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

    // ========================================================================
    // Nested Handoff Integration
    // ========================================================================

    /**
     * Wire nested scroll handoff callbacks for parent lock behavior.
     *
     * @param {object} nestedScrollView Nested section scroll view.
     */
    configureNestedScrollHandoff(nestedScrollView) {
        if (!nestedScrollView || typeof nestedScrollView.setHandoffCallbacks !== 'function') {
            return;
        }

        nestedScrollView.setHandoffCallbacks({
            onInnerScroll: () => {
                this.lock();
            },
            onBoundaryHandoff: () => {
                this.unlock();
            },
        });
    }

    // ========================================================================
    // Teardown
    // ========================================================================

    /**
     * Releases controller resources.
     */
    destroy() {
        this.unlock();
        this._scrollView = null;
    }
}
