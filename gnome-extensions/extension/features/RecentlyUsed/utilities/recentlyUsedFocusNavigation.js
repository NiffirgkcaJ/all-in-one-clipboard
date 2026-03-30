import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import { FocusUtils } from '../../../shared/utilities/utilityFocus.js';

/**
 * Focus the most appropriate visible widget in Recently Used.
 *
 * Priority:
 * 1) First visible Show All button
 * 2) First visible content item (excluding Show All and settings)
 * 3) First visible widget in the grid
 *
 * @param {object} params
 * @param {Array<Array<object>>} params.focusGrid Focus matrix
 * @param {object} params.sections Section map containing showAllBtn entries
 * @param {object} params.settingsBtn Floating settings button
 */
export function focusRecentlyUsedBestCandidate({ focusGrid, sections, settingsBtn }) {
    const showAllButtons = new Set();
    for (const section of Object.values(sections)) {
        if (section.showAllBtn) {
            showAllButtons.add(section.showAllBtn);
        }
    }

    if (tryFocusShowAllButton(showAllButtons)) {
        return;
    }

    if (tryFocusContentItem({ focusGrid, showAllButtons, settingsBtn })) {
        return;
    }

    tryFocusAnyWidget(focusGrid);
}

/**
 * Handle arrow-key navigation inside Recently Used.
 *
 * @param {object} params
 * @param {Clutter.Event} params.event Key press event
 * @param {Array<Array<object>>} params.focusGrid Focus matrix
 * @param {object} params.settingsBtn Floating settings button
 * @param {Function} params.onUnlockOuterScroll Callback that unlocks outer scroll
 * @param {number} params.settingsBtnFocusTimeoutId Existing timeout id
 * @param {Function} params.setSettingsBtnFocusTimeoutId Setter for timeout id
 * @returns {Clutter.EventPropagation} EVENT_STOP or EVENT_PROPAGATE
 */
export function handleRecentlyUsedKeyPress({ event, focusGrid, settingsBtn, onUnlockOuterScroll, settingsBtnFocusTimeoutId, setSettingsBtnFocusTimeoutId }) {
    const symbol = event.get_key_symbol();
    const currentFocus = global.stage.get_key_focus();
    const allFocusable = focusGrid.flat();

    if (!allFocusable.includes(currentFocus)) {
        if (symbol === Clutter.KEY_Down && focusGrid.length > 0) {
            focusGrid[0][0].grab_key_focus();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    let rowIndex = -1;
    let colIndex = -1;
    for (let r = 0; r < focusGrid.length; r++) {
        const c = focusGrid[r].indexOf(currentFocus);
        if (c !== -1) {
            rowIndex = r;
            colIndex = c;
            break;
        }
    }

    if (rowIndex === -1) {
        return Clutter.EVENT_PROPAGATE;
    }

    let nextRow = rowIndex;
    let nextCol = colIndex;

    if (symbol === Clutter.KEY_Left || symbol === Clutter.KEY_Right) {
        const currentRow = focusGrid[rowIndex];
        const currentRowIndex = currentRow.indexOf(currentFocus);

        if (currentRowIndex !== -1) {
            const result = FocusUtils.handleRowNavigation(event, currentRow, currentRowIndex, currentRow.length);
            if (result === Clutter.EVENT_STOP) {
                return Clutter.EVENT_STOP;
            }
        }

        return Clutter.EVENT_PROPAGATE;
    }

    if (symbol === Clutter.KEY_Up) {
        if (rowIndex > 0) {
            nextRow--;
        } else {
            onUnlockOuterScroll();
            return Clutter.EVENT_PROPAGATE;
        }
    } else if (symbol === Clutter.KEY_Down) {
        if (rowIndex < focusGrid.length - 1) {
            nextRow++;
        } else {
            return Clutter.EVENT_STOP;
        }
    } else {
        return Clutter.EVENT_PROPAGATE;
    }

    if (focusGrid[nextRow].length === 1) {
        nextCol = 0;
    } else {
        nextCol = Math.min(nextCol, focusGrid[nextRow].length - 1);
    }

    const targetWidget = focusGrid[nextRow][nextCol];

    if (targetWidget === settingsBtn) {
        settingsBtn.can_focus = true;
        settingsBtn.grab_key_focus();

        if (settingsBtnFocusTimeoutId) {
            GLib.source_remove(settingsBtnFocusTimeoutId);
        }

        const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
            settingsBtn.can_focus = false;
            setSettingsBtnFocusTimeoutId(0);
            return GLib.SOURCE_REMOVE;
        });

        setSettingsBtnFocusTimeoutId(timeoutId);
    } else {
        targetWidget.grab_key_focus();
    }

    return Clutter.EVENT_STOP;
}

/**
 * Attempts to focus the first visible content item in the focus grid
 * @param {object} params
 * @param {Array<Array<object>>} params.focusGrid Focus matrix
 * @param {Set<object>} params.showAllButtons Set of "Show All" buttons
 * @param {object} params.settingsBtn Floating settings button
 * @returns {boolean} True if an item was focused, false otherwise
 */
function tryFocusContentItem({ focusGrid, showAllButtons, settingsBtn }) {
    for (let i = 0; i < focusGrid.length; i++) {
        const row = focusGrid[i];
        if (!row || row.length === 0) {
            continue;
        }

        const firstItemInRow = row[0];
        if (!firstItemInRow || !firstItemInRow.visible || !firstItemInRow.get_stage()) {
            continue;
        }
        if (firstItemInRow === settingsBtn) {
            continue;
        }
        if (showAllButtons.has(firstItemInRow)) {
            continue;
        }

        try {
            firstItemInRow.grab_key_focus();
            return true;
        } catch {
            continue;
        }
    }

    return false;
}

/**
 * Attempts to focus a visible Show All button.
 * @param {Set<object>} showAllButtons Set of Show All buttons
 * @returns {boolean} True if a button was focused, false otherwise
 */
function tryFocusShowAllButton(showAllButtons) {
    for (const button of showAllButtons) {
        if (button && button.visible && button.get_stage()) {
            try {
                button.grab_key_focus();
                return true;
            } catch {
                continue;
            }
        }
    }

    return false;
}

/**
 * Attempts to focus any visible widget in the focus grid.
 * @param {Array<Array<object>>} focusGrid Focus matrix
 * @returns {boolean} True if an item was focused, false otherwise
 */
function tryFocusAnyWidget(focusGrid) {
    for (let i = 0; i < focusGrid.length; i++) {
        if (focusGrid[i] && focusGrid[i][0]) {
            const widget = focusGrid[i][0];
            if (widget && widget.visible && widget.get_stage()) {
                try {
                    widget.grab_key_focus();
                    return true;
                } catch {
                    continue;
                }
            }
        }
    }

    return false;
}
