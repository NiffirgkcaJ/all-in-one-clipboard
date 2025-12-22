import Clutter from 'gi://Clutter';

/**
 * Utility for handling keyboard focus navigation and trapping.
 * Collates common patterns for preventing focus escape at component boundaries.
 */
export const FocusUtils = {
    /**
     * Handles linear navigation (Left/Right) within a list of items.
     * Traps focus at the boundaries unless a custom boundary handler is provided.
     *
     * @param {Clutter.Event} event - The key press event.
     * @param {Array<Clutter.Actor>} items - The list of focusable items.
     * @param {number} currentIndex - The index of the currently focused item.
     * @param {Object} options - Configuration options.
     * @param {boolean} [options.wrap=false] - Whether to wrap around at edges (e.g., Last -> First).
     * @param {Function} [options.onBoundary] - Callback when navigating past a boundary.
     *                                           Receives 'start' or 'end'. Should return Clutter.EVENT_STOP if handled.
     *                                           If not provided, focus is trapped (EVENT_STOP).
     * @returns {number} Clutter.EVENT_STOP if handled/trapped, Clutter.EVENT_PROPAGATE otherwise.
     */
    handleLinearNavigation(event, items, currentIndex, { wrap = false, onBoundary = null } = {}) {
        const symbol = event.get_key_symbol();
        const len = items.length;

        if (len === 0) return Clutter.EVENT_PROPAGATE;

        if (symbol === Clutter.KEY_Left) {
            if (currentIndex > 0) {
                items[currentIndex - 1].grab_key_focus();
                return Clutter.EVENT_STOP;
            } else if (wrap) {
                items[len - 1].grab_key_focus();
                return Clutter.EVENT_STOP;
            } else {
                if (onBoundary) {
                    const result = onBoundary('start');
                    if (result !== undefined) return result;
                }
                return Clutter.EVENT_STOP;
            }
        } else if (symbol === Clutter.KEY_Right) {
            if (currentIndex < len - 1) {
                items[currentIndex + 1].grab_key_focus();
                return Clutter.EVENT_STOP;
            } else if (wrap) {
                items[0].grab_key_focus();
                return Clutter.EVENT_STOP;
            } else {
                if (onBoundary) {
                    const result = onBoundary('end');
                    if (result !== undefined) return result;
                }
                return Clutter.EVENT_STOP;
            }
        }

        return Clutter.EVENT_PROPAGATE;
    },

    /**
     * Handles grid navigation (Up/Down/Left/Right).
     * Left/Right behaves linearly (wrapping between rows).
     * Up/Down moves by column.
     *
     * @param {Clutter.Event} event - The key press event.
     * @param {Array<Clutter.Actor>} items - The list of focusable items.
     * @param {number} currentIndex - The index of the currently focused item.
     * @param {number} itemsPerRow - Number of items per row.
     * @param {Object} options - Configuration options.
     * @param {Function} [options.onBoundary] - Callback when navigating past a boundary.
     *                                           Receives 'up', 'down', 'start', or 'end'.
     * @returns {number} Clutter.EVENT_STOP if handled/trapped, Clutter.EVENT_PROPAGATE otherwise.
     */
    handleGridNavigation(event, items, currentIndex, itemsPerRow, { onBoundary = null } = {}) {
        const symbol = event.get_key_symbol();

        if (symbol === Clutter.KEY_Left || symbol === Clutter.KEY_Right) {
            return this.handleLinearNavigation(event, items, currentIndex, { wrap: false, onBoundary });
        }

        if (symbol === Clutter.KEY_Up || symbol === Clutter.KEY_Down) {
            return this.handleColumnNavigation(event, items, currentIndex, itemsPerRow, onBoundary);
        }

        return Clutter.EVENT_PROPAGATE;
    },

    /**
     * Handles horizontal navigation within rows (Left/Right).
     * Respects row boundaries (does not wrap to next/prev row).
     *
     * @param {Clutter.Event} event - The key press event.
     * @param {Array<Clutter.Actor>} items - The list of focusable items.
     * @param {number} currentIndex - The index of the currently focused item.
     * @param {number} itemsPerRow - Number of items per row.
     * @param {Function} [onBoundary] - Callback when navigating past a boundary.
     *                                  Receives 'start' or 'end'.
     * @returns {number} Clutter.EVENT_STOP if handled/trapped, Clutter.EVENT_PROPAGATE otherwise.
     */
    handleRowNavigation(event, items, currentIndex, itemsPerRow, onBoundary = null) {
        const symbol = event.get_key_symbol();
        const len = items.length;

        if (symbol === Clutter.KEY_Left) {
            if (currentIndex % itemsPerRow > 0) {
                return this.handleLinearNavigation(event, items, currentIndex, { wrap: false, onBoundary });
            } else {
                if (onBoundary) {
                    const result = onBoundary('start');
                    if (result !== undefined) return result;
                }
                return Clutter.EVENT_STOP;
            }
        } else if (symbol === Clutter.KEY_Right) {
            if (currentIndex % itemsPerRow < itemsPerRow - 1 && currentIndex < len - 1) {
                return this.handleLinearNavigation(event, items, currentIndex, { wrap: false, onBoundary });
            } else {
                if (onBoundary) {
                    const result = onBoundary('end');
                    if (result !== undefined) return result;
                }
                return Clutter.EVENT_STOP;
            }
        }
        return Clutter.EVENT_PROPAGATE;
    },

    /**
     * Handles vertical navigation between columns (Up/Down).
     *
     * @param {Clutter.Event} event - The key press event.
     * @param {Array<Clutter.Actor>} items - The list of focusable items.
     * @param {number} currentIndex - The index of the currently focused item.
     * @param {number} itemsPerRow - Number of items per row.
     * @param {Function} [onBoundary] - Callback when navigating past a boundary.
     *                                  Receives 'up' or 'down'.
     * @returns {number} Clutter.EVENT_STOP if handled/trapped, Clutter.EVENT_PROPAGATE otherwise.
     */
    handleColumnNavigation(event, items, currentIndex, itemsPerRow, onBoundary = null) {
        const symbol = event.get_key_symbol();
        const len = items.length;
        let targetIndex = -1;

        if (symbol === Clutter.KEY_Up) {
            if (currentIndex >= itemsPerRow) {
                targetIndex = currentIndex - itemsPerRow;
            } else {
                if (onBoundary) {
                    const result = onBoundary('up');
                    if (result !== undefined) return result;
                }
                return Clutter.EVENT_STOP;
            }
        } else if (symbol === Clutter.KEY_Down) {
            if (currentIndex + itemsPerRow < len) {
                targetIndex = currentIndex + itemsPerRow;
            } else {
                if (onBoundary) {
                    const result = onBoundary('down');
                    if (result !== undefined) return result;
                }
                return Clutter.EVENT_STOP;
            }
        }

        if (targetIndex !== -1) {
            items[targetIndex].grab_key_focus();
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    },

    /**
     * Attempts to navigate focus internally within a container.
     * If internal navigation fails, it traps focus (returns EVENT_STOP).
     * This is useful for complex widgets like Search entries.
     *
     * @param {Clutter.Actor} actor - The actor initiating the navigation (usually the container or a child).
     * @param {Clutter.Actor} container - The container to navigate within.
     * @param {St.DirectionType} direction - The direction to navigate.
     * @returns {number} Clutter.EVENT_STOP.
     */
    trapFocusInContainer(actor, container, direction) {
        actor.navigate_focus(container, direction, false);
        return Clutter.EVENT_STOP;
    },
};
