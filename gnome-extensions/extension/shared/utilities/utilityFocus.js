import Clutter from 'gi://Clutter';

import { resolveKeySymbol } from './utilityShortcutMatcher.js';

/**
 * Checks if a key event matches a specific key name.
 * Handles symbol equivalence like Tab and ISO_Left_Tab.
 *
 * @param {Clutter.Event} event The key event.
 * @param {string} keyName The key name to match.
 * @returns {boolean} True if the event matches the key name.
 */
export function isKey(event, keyName) {
    const symbol = event.get_key_symbol();
    if (keyName === 'Tab' || keyName === 'ISO_Left_Tab') {
        return symbol === resolveKeySymbol('Tab') || symbol === resolveKeySymbol('ISO_Left_Tab');
    }
    return symbol === resolveKeySymbol(keyName);
}

/**
 * Evaluates whether an event is a Tab navigation key press.
 * Identifies forward Tab and backward Shift+Tab.
 *
 * @param {Clutter.Event} event The key event.
 * @returns {{ isTab: boolean, isBackward: boolean, isForward: boolean }} Tab navigation state.
 */
export function getTabNavigation(event) {
    const symbol = event.get_key_symbol();
    const isTabSymbol = symbol === resolveKeySymbol('Tab');
    const isIsoLeftTab = symbol === resolveKeySymbol('ISO_Left_Tab');

    if (!isTabSymbol && !isIsoLeftTab) {
        return { isTab: false, isBackward: false, isForward: false };
    }

    const hasShift = (event.get_state() & Clutter.ModifierType.SHIFT_MASK) !== 0;
    const isBackward = isIsoLeftTab || (isTabSymbol && hasShift);

    return {
        isTab: true,
        isBackward,
        isForward: !isBackward,
    };
}

/**
 * Utility for handling keyboard focus navigation and trapping.
 * Collates common patterns for preventing focus escape at component boundaries.
 */
export const FocusUtils = {
    isKey,
    getTabNavigation,
    /**
     * Handles linear navigation Left or Right within a list of items.
     * Traps focus at the boundaries unless a custom boundary handler is provided.
     *
     * @param {Clutter.Event} event The key press event.
     * @param {Array<Clutter.Actor>} items The list of focusable items.
     * @param {number} currentIndex The index of the currently focused item.
     * @param {Object} options Configuration options.
     * @param {boolean} [options.wrap=false] Whether to wrap around at edges.
     * @param {Function} [options.onBoundary] Callback when navigating past a boundary.
     * @returns {number} Clutter.EVENT_STOP if handled or trapped and Clutter.EVENT_PROPAGATE otherwise.
     */
    handleLinearNavigation(event, items, currentIndex, { wrap = false, onBoundary = null } = {}) {
        const len = items.length;

        if (len === 0) return Clutter.EVENT_PROPAGATE;

        if (isKey(event, 'Left')) {
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
        } else if (isKey(event, 'Right')) {
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
     * Handles sequential Tab and Shift+Tab navigation within a list of items.
     * Tab advances forward with wrap-around, and Shift+Tab moves backward.
     * Navigating backward from the start triggers the onBoundary callback.
     *
     * @param {Clutter.Event} event The key press event.
     * @param {Array<Clutter.Actor>} items The list of focusable items.
     * @param {number} currentIndex The index of the currently focused item.
     * @param {Object} [options] Configuration options.
     * @param {boolean} [options.wrap=true] Whether forward Tab wraps from the end to the start.
     * @param {Function} [options.onBoundary] Callback when navigating past the boundary.
     * @returns {number} Clutter.EVENT_STOP if handled or trapped and Clutter.EVENT_PROPAGATE otherwise.
     */
    handleTabNavigation(event, items, currentIndex, { wrap = true, onBoundary = null } = {}) {
        const len = items.length;

        if (len === 0) return Clutter.EVENT_PROPAGATE;

        const tabNav = getTabNavigation(event);
        if (!tabNav.isTab) {
            return Clutter.EVENT_PROPAGATE;
        }

        if (tabNav.isBackward) {
            if (currentIndex > 0) {
                items[currentIndex - 1].grab_key_focus();
                return Clutter.EVENT_STOP;
            }
            if (onBoundary) {
                const result = onBoundary('backward');
                if (result !== undefined) return result;
            }
            if (wrap) {
                items[len - 1].grab_key_focus();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_STOP;
        }

        if (tabNav.isForward) {
            if (currentIndex < len - 1) {
                items[currentIndex + 1].grab_key_focus();
                return Clutter.EVENT_STOP;
            }
            if (wrap) {
                items[0].grab_key_focus();
                return Clutter.EVENT_STOP;
            }
            if (onBoundary) {
                const result = onBoundary('forward');
                if (result !== undefined) return result;
            }
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    },

    /**
     * Handles grid navigation including Up, Down, Left, Right, Tab, and Shift+Tab.
     * Left and Right behave linearly and wrap between rows.
     * Up and Down moves by column.
     * Tab and Shift+Tab cycle through items sequentially.
     *
     * @param {Clutter.Event} event The key press event.
     * @param {Array<Clutter.Actor>} items The list of focusable items.
     * @param {number} currentIndex The index of the currently focused item.
     * @param {number} itemsPerRow Number of items per row.
     * @param {Object} [options] Configuration options.
     * @param {boolean} [options.wrapTab=true] Whether Tab wraps around at boundaries.
     * @param {Function} [options.onBoundary] Callback when navigating past a boundary.
     * @returns {number} Clutter.EVENT_STOP if handled or trapped and Clutter.EVENT_PROPAGATE otherwise.
     */
    handleGridNavigation(event, items, currentIndex, itemsPerRow, { wrapTab = true, onBoundary = null } = {}) {
        if (isKey(event, 'Left') || isKey(event, 'Right')) {
            return this.handleLinearNavigation(event, items, currentIndex, { wrap: false, onBoundary });
        }

        if (isKey(event, 'Up') || isKey(event, 'Down')) {
            return this.handleColumnNavigation(event, items, currentIndex, itemsPerRow, onBoundary);
        }

        if (getTabNavigation(event).isTab) {
            return this.handleTabNavigation(event, items, currentIndex, { wrap: wrapTab, onBoundary });
        }

        return Clutter.EVENT_PROPAGATE;
    },

    /**
     * Handles horizontal navigation within rows using Left and Right.
     * Respects row boundaries and does not wrap to the next or previous row.
     *
     * @param {Clutter.Event} event The key press event.
     * @param {Array<Clutter.Actor>} items The list of focusable items.
     * @param {number} currentIndex The index of the currently focused item.
     * @param {number} itemsPerRow Number of items per row.
     * @param {Function} [onBoundary] Callback when navigating past a boundary.
     * @returns {number} Clutter.EVENT_STOP if handled or trapped and Clutter.EVENT_PROPAGATE otherwise.
     */
    handleRowNavigation(event, items, currentIndex, itemsPerRow, onBoundary = null) {
        const len = items.length;

        if (isKey(event, 'Left')) {
            if (currentIndex % itemsPerRow > 0) {
                return this.handleLinearNavigation(event, items, currentIndex, { wrap: false, onBoundary });
            } else {
                if (onBoundary) {
                    const result = onBoundary('start');
                    if (result !== undefined) return result;
                }
                return Clutter.EVENT_STOP;
            }
        } else if (isKey(event, 'Right')) {
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
     * Handles vertical navigation between columns using Up and Down.
     *
     * @param {Clutter.Event} event The key press event.
     * @param {Array<Clutter.Actor>} items The list of focusable items.
     * @param {number} currentIndex The index of the currently focused item.
     * @param {number} itemsPerRow Number of items per row.
     * @param {Function} [onBoundary] Callback when navigating past a boundary.
     * @returns {number} Clutter.EVENT_STOP if handled or trapped and Clutter.EVENT_PROPAGATE otherwise.
     */
    handleColumnNavigation(event, items, currentIndex, itemsPerRow, onBoundary = null) {
        const len = items.length;
        let targetIndex = -1;

        if (isKey(event, 'Up')) {
            if (currentIndex >= itemsPerRow) {
                targetIndex = currentIndex - itemsPerRow;
            } else {
                if (onBoundary) {
                    const result = onBoundary('up');
                    if (result !== undefined) return result;
                }
                return Clutter.EVENT_STOP;
            }
        } else if (isKey(event, 'Down')) {
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
     * If internal navigation fails, it traps focus by returning EVENT_STOP.
     *
     * @param {Clutter.Actor} actor The actor initiating the navigation.
     * @param {Clutter.Actor} container The container to navigate within.
     * @param {St.DirectionType} direction The direction to navigate.
     * @returns {number} Clutter.EVENT_STOP.
     */
    trapFocusInContainer(actor, container, direction) {
        actor.navigate_focus(container, direction, false);
        return Clutter.EVENT_STOP;
    },
};
