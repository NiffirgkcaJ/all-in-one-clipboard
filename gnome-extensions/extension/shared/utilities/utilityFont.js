import Gio from 'gi://Gio';
import Pango from 'gi://Pango';

let _desktopSettings = null;
let _signalIds = [];
let _cachedInterfaceFamily = null;
let _cachedMonospaceFamily = null;
const _fontChangeListeners = new Set();

/**
 * Dispatch notification to all registered font change listeners.
 *
 * @private
 */
function _notifyFontChange() {
    _fontChangeListeners.forEach((listener) => {
        listener();
    });
}

/**
 * Ensure desktop interface settings and listeners are initialized.
 *
 * @private
 */
function _ensureSettings() {
    if (_desktopSettings) return;

    try {
        _desktopSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        _signalIds.push(
            _desktopSettings.connect('changed::monospace-font-name', () => {
                _cachedMonospaceFamily = null;
                _notifyFontChange();
            }),
        );
        _signalIds.push(
            _desktopSettings.connect('changed::font-name', () => {
                _cachedInterfaceFamily = null;
                _notifyFontChange();
            }),
        );
    } catch {
        _desktopSettings = null;
    }
}

/**
 * Resolve the system interface font family.
 *
 * @returns {string} Active interface font family name.
 */
export function getInterfaceFontFamily() {
    if (_cachedInterfaceFamily !== null) {
        return _cachedInterfaceFamily;
    }

    _ensureSettings();

    try {
        const fontName = _desktopSettings?.get_string('font-name');
        if (fontName) {
            const desc = Pango.FontDescription.from_string(fontName);
            _cachedInterfaceFamily = desc.get_family() || 'sans-serif';
        } else {
            _cachedInterfaceFamily = 'sans-serif';
        }
    } catch {
        _cachedInterfaceFamily = 'sans-serif';
    }

    return _cachedInterfaceFamily;
}

/**
 * Build the inline style for the active system interface font.
 *
 * @returns {string} Font family style.
 */
export function getInterfaceFontStyle() {
    const fontFamily = getInterfaceFontFamily();
    return `font-family: "${fontFamily}", sans-serif;`;
}

/**
 * Resolve the system monospace font family.
 *
 * @returns {string} Active monospace font family name.
 */
export function getMonospaceFontFamily() {
    if (_cachedMonospaceFamily !== null) {
        return _cachedMonospaceFamily;
    }

    _ensureSettings();

    try {
        const fontName = _desktopSettings?.get_string('monospace-font-name');
        if (fontName) {
            const desc = Pango.FontDescription.from_string(fontName);
            _cachedMonospaceFamily = desc.get_family() || 'monospace';
        } else {
            _cachedMonospaceFamily = 'monospace';
        }
    } catch {
        _cachedMonospaceFamily = 'monospace';
    }

    return _cachedMonospaceFamily;
}

/**
 * Build the inline style for the active system monospace font.
 *
 * @returns {string} Font family style.
 */
export function getMonospaceFontStyle() {
    const fontFamily = getMonospaceFontFamily();
    return `font-family: "${fontFamily}", monospace;`;
}

/**
 * Register a listener invoked whenever desktop font settings change.
 *
 * @param {Function} listener Callback function.
 * @returns {Function} Cleanup function to unregister the listener.
 */
export function addFontChangeListener(listener) {
    _fontChangeListeners.add(listener);
    return () => {
        _fontChangeListeners.delete(listener);
    };
}

/**
 * Destroy the desktop interface settings listeners and reset all font caches.
 */
export function destroyFontListener() {
    if (_desktopSettings) {
        _signalIds.forEach((id) => {
            _desktopSettings.disconnect(id);
        });
        _signalIds = [];
        _desktopSettings = null;
    }
    _cachedInterfaceFamily = null;
    _cachedMonospaceFamily = null;
    _fontChangeListeners.clear();
}
