import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

let _instance = null;

/**
 * A singleton manager for triggering a virtual paste command.
 * It encapsulates the virtual keyboard device and its state.
 */
class AutoPaster {
    constructor() {
        this._virtualKeyboard = null;
        this._pasteTimeoutId = 0;
    }

    /**
     * Get or create the virtual keyboard device.
     * @private
     */
    _getVirtualKeyboard() {
        if (!this._virtualKeyboard) {
            this._virtualKeyboard = Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        }
        return this._virtualKeyboard;
    }

    /**
     * Simulate Shift+Insert key press to paste.
     * This is more reliable than Ctrl+V across different applications.
     * @returns {Promise<void>}
     */
    trigger() {
        return new Promise((resolve) => {
            if (this._pasteTimeoutId) {
                GLib.source_remove(this._pasteTimeoutId);
            }
            this._pasteTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                const keyboard = this._getVirtualKeyboard();
                const timestamp = GLib.get_monotonic_time();

                const KEY_LEFTSHIFT = 42; // Left Shift
                const KEY_INSERT = 110; // Insert

                try {
                    keyboard.notify_key(timestamp, KEY_LEFTSHIFT, Clutter.KeyState.PRESSED);
                    keyboard.notify_key(timestamp + 10, KEY_INSERT, Clutter.KeyState.PRESSED);
                    keyboard.notify_key(timestamp + 20, KEY_INSERT, Clutter.KeyState.RELEASED);
                    keyboard.notify_key(timestamp + 30, KEY_LEFTSHIFT, Clutter.KeyState.RELEASED);
                } catch (e) {
                    console.error('[AIO-Clipboard] Failed to trigger paste:', e);
                }

                this._pasteTimeoutId = 0;
                resolve();
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    /**
     * Checks if auto-paste should be triggered for a specific feature.
     * This is a static method because it does not depend on an instance's state.
     *
     * @param {Gio.Settings} settings - Extension settings
     * @param {string} featureKey - The feature-specific setting key (e.g., 'auto-paste-emoji')
     * @returns {boolean} Whether auto-paste should be triggered
     */
    static shouldAutoPaste(settings, featureKey) {
        if (!settings.get_boolean('enable-auto-paste')) {
            return false;
        }
        return settings.get_boolean(featureKey);
    }

    /**
     * Cleans up the virtual keyboard and any pending timeouts.
     */
    destroy() {
        if (this._pasteTimeoutId) {
            GLib.source_remove(this._pasteTimeoutId);
            this._pasteTimeoutId = 0;
        }
        this._virtualKeyboard = null;
    }
}

/**
 * Initializes and/or returns the singleton instance of the AutoPaster.
 * @returns {AutoPaster} The singleton instance.
 */
export function getAutoPaster() {
    if (_instance === null) {
        _instance = new AutoPaster();
    }
    return _instance;
}

/**
 * Destroys the singleton instance of the AutoPaster, cleaning up its resources.
 */
export function destroyAutoPaster() {
    if (_instance !== null) {
        _instance.destroy();
        _instance = null;
    }
}

// Export the class as well to allow access to the static method
export { AutoPaster };
