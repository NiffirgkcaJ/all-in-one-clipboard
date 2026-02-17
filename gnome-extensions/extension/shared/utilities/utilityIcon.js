import Gio from 'gi://Gio';
import Rsvg from 'gi://Rsvg';
import St from 'gi://St';

import { ResourcePath } from '../constants/storagePaths.js';

/**
 * Create a static icon.
 *
 * @example
 * const icon = createStaticIcon(
 *     { icon: ClipboardIcons.CHECKBOX_UNCHECKED, iconSize: 16 },
 *     { styleClass: 'my-icon-class' }
 * );
 *
 * @param {Object} config - Icon config object with `icon`, `iconSize`, and optional `iconOptions`
 * @param {Object} [options={}] - Options object
 * @param {string} [options.styleClass='system-status-icon'] - CSS style class
 * @returns {St.Icon} Static icon widget
 */
export function createStaticIcon(config, options = {}) {
    const styleClass = options.styleClass || 'system-status-icon';

    const icon = new St.Icon({
        icon_size: config.iconSize || 16,
        style_class: styleClass,
    });
    _applyIconConfig(icon, config);
    return icon;
}

/**
 * Create a dynamic icon that supports state-based switching.
 *
 * @example
 * const icon = createDynamicIcon(
 *     { unchecked: ClipboardIcons.CHECKBOX_UNCHECKED, checked: ClipboardIcons.CHECKBOX_CHECKED },
 *     { initial: 'unchecked', styleClass: 'my-icon-class' }
 * );
 * icon.state = 'checked';  // Switch state
 *
 * @param {Object} states - State map: { stateName: iconConfig, ... }
 * @param {Object} [options={}] - Options object
 * @param {string} [options.initial] - Initial state name (defaults to first state)
 * @param {string} [options.styleClass='system-status-icon'] - CSS style class
 * @returns {St.Icon} Icon widget with `state` property for switching
 */
export function createDynamicIcon(states, options = {}) {
    const styleClass = options.styleClass || 'system-status-icon';

    const stateNames = Object.keys(states);
    const initialState = options.initial || stateNames[0];

    const firstConfig = states[stateNames[0]];
    const icon = new St.Icon({
        icon_size: firstConfig.iconSize || 16,
        style_class: styleClass,
    });

    let _currentState = initialState;
    _applyIconConfig(icon, states[_currentState]);

    Object.defineProperty(icon, 'state', {
        get: () => _currentState,
        set: (newState) => {
            if (states[newState] && newState !== _currentState) {
                _currentState = newState;
                _applyIconConfig(icon, states[_currentState]);
            }
        },
    });

    return icon;
}

/**
 * Create a button with a static icon child.
 *
 * @example
 * const button = createStaticIconButton(
 *     { icon: ClipboardIcons.CHECKBOX_UNCHECKED, iconSize: 16 },
 *     { tooltip_text: 'Toggle' }
 * );
 *
 * @param {Object} config - Icon configuration object
 * @param {Object} [buttonParams={}] - Button parameters
 * @param {string} [buttonParams.iconStyleClass] - CSS class for the icon
 * @param {string} [buttonParams.tooltip_text] - Tooltip text
 * @returns {St.Button} Button with icon child
 */
export function createStaticIconButton(config, buttonParams = {}) {
    const { tooltip_text, iconStyleClass, ...otherParams } = buttonParams;
    const icon = createStaticIcon(config, { styleClass: iconStyleClass });

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
 * Create a button with a dynamic (stateful) icon child.
 *
 * @example
 * const button = createDynamicIconButton(
 *     { unchecked: ClipboardIcons.X, checked: ClipboardIcons.Y },
 *     { initial: 'unchecked', tooltip_text: 'Toggle' }
 * );
 * button.child.state = 'checked';
 *
 * @param {Object} states - State map: { stateName: iconConfig, ... }
 * @param {Object} [buttonParams={}] - Button parameters
 * @param {string} [buttonParams.initial] - Initial icon state
 * @param {string} [buttonParams.iconStyleClass] - CSS class for the icon
 * @param {string} [buttonParams.tooltip_text] - Tooltip text
 * @returns {St.Button} Button with dynamic icon child
 */
export function createDynamicIconButton(states, buttonParams = {}) {
    const { tooltip_text, initial, iconStyleClass, ...otherParams } = buttonParams;
    const icon = createDynamicIcon(states, { initial, styleClass: iconStyleClass });

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
 * Apply icon configuration to an icon widget.
 * @param {St.Icon} iconWidget - The icon widget to configure
 * @param {Object} iconConfig - Config with `icon`, `iconSize`, and optional `iconOptions`
 * @private
 */
function _applyIconConfig(iconWidget, iconConfig) {
    const options = { ...iconConfig.iconOptions };
    if (iconConfig.iconSize) {
        options.iconSize = iconConfig.iconSize;
    }
    if (iconConfig.basePath) {
        options.basePath = iconConfig.basePath;
    }
    _setIcon(iconWidget, iconConfig.icon, options);
}

/**
 * Set the icon of an existing St.Icon widget.
 * Handles switching between system icon names and custom SVG files.
 * @param {St.Icon} iconWidget - The icon widget
 * @param {string} iconName - Icon name or filename (with extension for SVGs)
 * @param {Object} [options={}] - Options: iconSize, color, opacity
 * @private
 */
function _setIcon(iconWidget, iconName, options = {}) {
    if (options.iconSize) {
        iconWidget.set_icon_size(options.iconSize);
    }

    const styles = [];
    if (options.color) {
        styles.push(`color: ${options.color}`);
    }

    if (styles.length > 0) {
        iconWidget.set_style(styles.join('; ') + ';');
    } else {
        iconWidget.set_style(null);
    }

    if (options.opacity !== undefined) {
        iconWidget.set_opacity(Math.round(options.opacity * 255));
    } else {
        iconWidget.set_opacity(255);
    }

    if (iconName && iconName.includes('.')) {
        const base = options.basePath || ResourcePath.UI;
        const resourceUri = `${base}/${iconName}`;
        const file = Gio.File.new_for_uri(resourceUri);

        iconWidget.set_icon_name(null);
        iconWidget.set_gicon(new Gio.FileIcon({ file: file }));
    } else {
        iconWidget.set_gicon(null);
        iconWidget.set_icon_name(iconName);
    }
}

/**
 * Creates a logo widget from an SVG resource file using Rsvg and St.DrawingArea
 * for crisp vector rendering at the correct aspect ratio.
 *
 * SVGs using `currentColor` will auto-resolve from the parent widget's CSS
 * `color` at paint time, unless an explicit `config.color` is provided.
 *
 * @param {Object} config
 * @param {string} config.icon - The SVG filename
 * @param {number} config.height - The desired display height in pixels
 * @param {string} [config.basePath] - Resource path prefix (defaults to ResourcePath.LOGOS)
 * @param {string} [config.color] - Explicit color to replace `currentColor` with (overrides CSS)
 * @returns {St.DrawingArea|null} A widget displaying the logo, or null on error
 */
export function createLogo(config) {
    const basePath = config.basePath || ResourcePath.LOGOS;
    const resourceUri = `${basePath}/${config.icon}`;
    const file = Gio.File.new_for_uri(resourceUri);
    let [, contents] = file.load_contents(null);

    const svgText = new TextDecoder().decode(contents);
    const usesCurrentColor = svgText.includes('currentColor');

    if (config.color && usesCurrentColor) {
        contents = new TextEncoder().encode(svgText.replaceAll('currentColor', config.color));
    }

    try {
        let handle = Rsvg.Handle.new_from_data(contents);
        const dim = handle.get_dimensions();
        const aspectRatio = dim.width / dim.height;
        const height = config.height;
        const width = Math.round(height * aspectRatio);

        let resolvedColor = config.color || null;

        const area = new St.DrawingArea({ width, height });
        area.connect('repaint', () => {
            const cr = area.get_context();

            if (usesCurrentColor && !config.color) {
                let parentColor = null;
                try {
                    const parent = area.get_parent();
                    if (parent?.get_theme_node) {
                        const c = parent.get_theme_node().get_color('color');
                        parentColor = `rgba(${c.red},${c.green},${c.blue},${c.alpha / 255})`;
                    }
                } catch {
                    // Ignore
                }

                if (parentColor && parentColor !== resolvedColor) {
                    resolvedColor = parentColor;
                    const resolved = svgText.replaceAll('currentColor', resolvedColor);
                    handle = Rsvg.Handle.new_from_data(new TextEncoder().encode(resolved));
                }
            }

            const [w, h] = area.get_surface_size();
            cr.scale(w / dim.width, h / dim.height);
            handle.render_cairo(cr);
            cr.$dispose();
        });

        return area;
    } catch (e) {
        console.error(`Failed to create logo for ${config.icon}:`, e);
        return null;
    }
}
