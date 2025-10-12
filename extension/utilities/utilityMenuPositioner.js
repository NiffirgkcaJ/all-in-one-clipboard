import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/**
 * Gets the monitor at the given coordinates.
 */
function getMonitorAtPosition(x, y) {
    const index = Main.layoutManager.monitors.findIndex(monitor => {
        return x >= monitor.x && x < monitor.x + monitor.width &&
               y >= monitor.y && y < monitor.y + monitor.height;
    });
    return index >= 0 ? Main.layoutManager.monitors[index] : Main.layoutManager.primaryMonitor;
}

/**
 * Gets the coordinates for the center of the primary monitor.
 */
function getPositionAtCenter(menuWidth, menuHeight) {
    const monitor = Main.layoutManager.primaryMonitor;
    const x = monitor.x + Math.round((monitor.width - menuWidth) / 2);
    const y = monitor.y + Math.round((monitor.height - menuHeight) / 2);
    return { x, y, monitor };
}

/**
 * Gets the coordinates of the mouse pointer.
 */
function getPositionAtCursor() {
    const [x, y] = global.get_pointer();
    const monitor = getMonitorAtPosition(x, y);
    return { x, y, monitor };
}

/**
 * Gets the coordinates of the top-center of the focused window.
 * Falls back to the cursor's position if no window is focused.
 */
function getPositionAtWindow() {
    const focusWindow = global.display.get_focus_window();
    if (focusWindow && !focusWindow.is_override_redirect()) {
        const rect = focusWindow.get_frame_rect();
        const x = Math.round(rect.x + rect.width / 2);
        const y = rect.y;
        const monitor = getMonitorAtPosition(x, y);
        return { x, y, monitor };
    }
    // If no window is focused (e.g., clicked on desktop), fall back to cursor.
    return getPositionAtCursor();
}

/**
 * Adjusts a given position to ensure the menu does not render off-screen.
 */
function keepOnScreen(pos, menuWidth, menuHeight) {
    const monitor = pos.monitor;
    
    // Adjust horizontally
    if (pos.x + menuWidth > monitor.x + monitor.width) {
        pos.x = monitor.x + monitor.width - menuWidth;
    }
    if (pos.x < monitor.x) {
        pos.x = monitor.x;
    }
    
    // Adjust vertically
    if (pos.y + menuHeight > monitor.y + monitor.height) {
        pos.y = monitor.y + monitor.height - menuHeight;
    }
    if (pos.y < monitor.y) {
        pos.y = monitor.y;
    }
    
    return pos;
}

/**
 * Main exported function to intelligently position a menu actor on the screen.
 * @param {Clutter.Actor} menuActor - The menu actor to be positioned.
 * @param {Gio.Settings} settings - The extension's settings object.
 */
export function positionMenu(menuActor, settings) {
    const [menuWidth, menuHeight] = menuActor.get_size();
    const mode = settings.get_string('hidden-icon-position-mode');
    let bestPosition;
    
    switch (mode) {
        case 'window':
            bestPosition = getPositionAtWindow();
            // Center the menu horizontally over the window's anchor point
            bestPosition.x -= Math.round(menuWidth / 2);
            break;
        case 'center':
            bestPosition = getPositionAtCenter(menuWidth, menuHeight);
            break;
        case 'cursor':
        default:
            bestPosition = getPositionAtCursor();
            break;
    }
    
    const finalPosition = keepOnScreen(bestPosition, menuWidth, menuHeight);
    menuActor.set_position(finalPosition.x, finalPosition.y);
}