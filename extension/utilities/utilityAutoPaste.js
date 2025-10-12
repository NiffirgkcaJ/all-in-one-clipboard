import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

let _virtualKeyboard = null;

/**
 * Get or create the virtual keyboard device
 */
function getVirtualKeyboard() {
    if (!_virtualKeyboard) {
        _virtualKeyboard = Clutter.get_default_backend()
            .get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    }
    return _virtualKeyboard;
}

/**
 * Simulate Shift+Insert key press to paste
 * This is more reliable than Ctrl+V across different applications
 */
export function triggerPaste() {
    return new Promise((resolve) => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            const keyboard = getVirtualKeyboard();
            const timestamp = GLib.get_monotonic_time();

            const KEY_LEFTSHIFT = 42;  // Left Shift
            const KEY_INSERT = 110;    // Insert

            try {
                keyboard.notify_key(timestamp, KEY_LEFTSHIFT, Clutter.KeyState.PRESSED);
                keyboard.notify_key(timestamp + 10, KEY_INSERT, Clutter.KeyState.PRESSED);
                keyboard.notify_key(timestamp + 20, KEY_INSERT, Clutter.KeyState.RELEASED);
                keyboard.notify_key(timestamp + 30, KEY_LEFTSHIFT, Clutter.KeyState.RELEASED);
            } catch (e) {
                console.error('[AIO-Clipboard] Failed to trigger paste:', e);
            }

            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

/**
 * Check if auto-paste should be triggered for a specific feature
 *
 * @param {Gio.Settings} settings - Extension settings
 * @param {string} featureKey - The feature-specific setting key (e.g., 'auto-paste-emoji')
 * @returns {boolean} Whether auto-paste should be triggered
 */
export function shouldAutoPaste(settings, featureKey) {
    if (!settings.get_boolean('enable-auto-paste')) {
        return false;
    }

    return settings.get_boolean(featureKey);
}

/**
 * Cleanup virtual keyboard on extension disable
 */
export function cleanup() {
    _virtualKeyboard = null;
}