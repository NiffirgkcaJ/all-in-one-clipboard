import Gio from 'gi://Gio';
import St from 'gi://St';

/**
 * Create a themed icon from a symbolic SVG file in the GResource bundle.
 * @param {string} iconFilename - Name of the SVG file (e.g., 'utility-recents-symbolic.svg')
 * @param {number} iconSize - Size of the icon in pixels (default: 16)
 * @returns {St.Icon} A themed icon widget
 */
export function createThemedIcon(iconFilename, iconSize = 16) {
    // Construct the special URI for a file inside the GResource bundle.
    const resourceUri = `resource:///org/gnome/shell/extensions/all-in-one-clipboard/assets/icons/${iconFilename}`;

    // Create a Gio.File object from this special URI.
    const file = Gio.File.new_for_uri(resourceUri);

    // Create a Gio.FileIcon object from the file.
    const gicon = new Gio.FileIcon({ file: file });

    return new St.Icon({
        gicon: gicon,
        icon_size: iconSize,
        style_class: 'system-status-icon',
    });
}
