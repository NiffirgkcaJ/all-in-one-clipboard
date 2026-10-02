import GLib from 'gi://GLib';

/**
 * A class that creates a debounced function. It delays invoking the function
 * until after wait milliseconds have elapsed since the last time trigger was invoked.
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
        this._args = null;
    }

    /**
     * Triggers the debounced function. Each call will reset the waiting period.
     * @param {...any} args Arguments to pass to the original function.
     */
    trigger(...args) {
        if (!this._func) return;

        this._args = args;

        if (this._timeoutId > 0) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }

        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_LOW, this._wait, () => {
            if (!this._func) return GLib.SOURCE_REMOVE;

            const pendingArgs = this._args;
            this._args = null;
            this._timeoutId = 0;
            this._func.apply(this, pendingArgs);
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Flushes any pending execution immediately.
     */
    flush() {
        if (this._timeoutId > 0) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
            if (this._func) {
                const pendingArgs = this._args;
                this._args = null;
                this._func.apply(this, pendingArgs);
            }
        }
    }

    /**
     * Cancels any pending execution without destroying the debouncer.
     */
    cancel() {
        if (this._timeoutId > 0) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        this._args = null;
    }

    /**
     * Cancels any pending timeout and prevents further execution.
     * This must be called when the object using the debouncer is destroyed.
     */
    destroy() {
        if (this._timeoutId > 0) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        this._args = null;
        this._func = null;
    }
}
