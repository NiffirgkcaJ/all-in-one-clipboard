import GLib from 'gi://GLib';

/**
 * A class that creates a debounced function. It delays invoking the function
 * until after `wait` milliseconds have elapsed since the last time `call()`
 * was invoked.
 */
export class Debouncer {
    /**
     * @param {Function} func The function to debounce.
     * @param {number} wait The number of milliseconds to delay.
     */
    constructor(func, wait) {
        this._func = func;
        this._wait = wait;
        this._timeoutId = 0;
        this._isDestroyed = false;
    }

    /**
     * Triggers the debounced function. Each call will reset the waiting period.
     * @param {...any} args - Arguments to pass to the original function.
     */
    trigger(...args) {
        // Do not schedule new timeouts if destroyed.
        if (this._isDestroyed) {
            return;
        }

        // If there's an existing timeout, clear it.
        if (this._timeoutId > 0) {
            GLib.source_remove(this._timeoutId);
        }

        // Set a new timeout.
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_LOW, this._wait, () => {
            // Do not execute the callback if destroyed.
            if (this._isDestroyed) {
                return GLib.SOURCE_REMOVE;
            }

            // When the timeout fires, execute the original function.
            this._func.apply(this, args);
            this._timeoutId = 0; // Clear the ID
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Cancels any pending execution without destroying the debouncer.
     */
    cancel() {
        if (this._timeoutId > 0) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
    }

    /**
     * Cancels any pending timeout, preventing the debounced function from executing.
     * This must be called when the object that uses the debouncer is destroyed.
     */
    destroy() {
        this._isDestroyed = true;
        if (this._timeoutId > 0) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        this._func = null; // Clear reference to the function
    }
}
