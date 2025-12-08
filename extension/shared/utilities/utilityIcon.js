import Gio from 'gi://Gio';
import St from 'gi://St';
import { ResourcePaths } from '../constants/storagePaths.js';

/**
 * Create a static icon from a symbolic SVG file in the GResource bundle or system icon.
 * The returned icon uses gicon and cannot have its icon changed at runtime.
 *
 * @param {string} iconName - Name of the SVG file (e.g., 'utility-recents-symbolic.svg') or system icon name
 * @param {number} iconSize - Size of the icon in pixels (default: 16)
 * @param {string} styleClass - Optional CSS style class (default: 'system-status-icon')
 * @returns {St.Icon} A static themed icon widget
 */
export function createStaticIcon(iconName, iconSize = 16, styleClass = 'system-status-icon') {
    const icon = new St.Icon({
        icon_size: iconSize,
        style_class: styleClass,
    });

    setIcon(icon, iconName);

    return icon;
}

/**
 * Create a dynamic icon that can have its icon changed at runtime.
 * Supports both system icon names and custom SVG files.
 *
 * @param {string} iconName - System icon name or SVG filename
 * @param {number} iconSize - Size of the icon in pixels (default: 16)
 * @param {string} styleClass - Optional CSS style class (default: 'popup-menu-icon')
 * @returns {St.Icon} A dynamic icon widget
 */
export function createDynamicIcon(iconName, iconSize = 16, styleClass = 'popup-menu-icon') {
    const icon = new St.Icon({
        icon_size: iconSize,
        style_class: styleClass,
    });

    setIcon(icon, iconName);

    return icon;
}

/**
 * Create a button with a static icon child.
 * Convenience function for the common pattern of a button containing an icon.
 *
 * @param {string} iconName - Icon filename or system icon name
 * @param {number} iconSize - Icon size in pixels (default: 16)
 * @param {Object} buttonParams - Additional St.Button parameters to merge
 * @returns {St.Button} Button with icon child
 */
export function createStaticIconButton(iconName, iconSize = 16, buttonParams = {}) {
    const { tooltip_text, ...otherParams } = buttonParams;
    const icon = createStaticIcon(iconName, iconSize);

    const button = new St.Button({
        style_class: 'button',
        can_focus: true,
        child: icon,
        ...otherParams,
    });

    if (tooltip_text) {
        button.tooltip_text = tooltip_text;
    }

    return button;
}

/**
 * Create a button with a dynamic icon child.
 * The icon can be accessed via button.child to change its icon_name.
 *
 * @param {string} iconName - Initial system icon name
 * @param {number} iconSize - Icon size in pixels (default: 16)
 * @param {Object} buttonParams - Additional St.Button parameters
 * @returns {St.Button} Button with dynamic icon child
 */
export function createDynamicIconButton(iconName, iconSize = 16, buttonParams = {}) {
    const { tooltip_text, ...otherParams } = buttonParams;
    const icon = createDynamicIcon(iconName, iconSize);

    const button = new St.Button({
        style_class: 'button',
        can_focus: true,
        child: icon,
        ...otherParams,
    });

    if (tooltip_text) {
        button.tooltip_text = tooltip_text;
    }

    return button;
}

/**
 * Set the icon of an existing St.Icon widget.
 * Handles switching between system icon names and custom SVG files.
 *
 * @param {St.Icon} iconWidget - The icon widget to update
 * @param {string} iconName - System icon name or SVG filename
 */
export function setIcon(iconWidget, iconName, iconSize = null) {
    if (iconSize) {
        iconWidget.set_icon_size(iconSize);
    }

    if (iconName && iconName.includes('.')) {
        const resourceUri = `${ResourcePaths.ASSETS.ICONS}/${iconName}`;
        const file = Gio.File.new_for_uri(resourceUri);

        // Explicitly clear icon_name FIRST
        iconWidget.set_icon_name(null);
        iconWidget.set_gicon(new Gio.FileIcon({ file: file }));
    } else {
        // Explicitly clear gicon FIRST
        iconWidget.set_gicon(null);
        iconWidget.set_icon_name(iconName);
    }
}
