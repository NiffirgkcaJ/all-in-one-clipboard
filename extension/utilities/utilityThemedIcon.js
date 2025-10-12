import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

/**
 * Create a themed icon from a symbolic SVG file
 * @param {string} extensionPath - Path to the extension directory
 * @param {string} iconFilename - Name of the SVG file (e.g., 'utility-recents-symbolic.svg')
 * @param {number} iconSize - Size of the icon in pixels (default: 16)
 * @returns {St.Icon} A themed icon widget
 */
export function createThemedIcon(extensionPath, iconFilename, iconSize = 16) {
    const iconPath = GLib.build_filenamev([extensionPath, 'icons', iconFilename]);
    const gicon = new Gio.FileIcon({
        file: Gio.File.new_for_path(iconPath)
    });

    return new St.Icon({
        gicon: gicon,
        icon_size: iconSize,
        style_class: 'system-status-icon'
    });
}