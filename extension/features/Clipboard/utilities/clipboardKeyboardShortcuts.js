import Clutter from 'gi://Clutter';

import { resolveKeySymbol } from '../../../shared/utilities/utilityShortcutMatcher.js';

/**
 * Settings keys for clipboard item keyboard shortcuts.
 */
export const ClipboardKeySettings = {
    TOGGLE_SELECT: 'clipboard-key-toggle-select',
    TOGGLE_PIN: 'clipboard-key-toggle-pin',
    DELETE: 'clipboard-key-delete',
};

/**
 * Handle keyboard shortcuts for clipboard item actions.
 * Used by both grid and list views for consistent behavior.
 *
 * @param {Clutter.Event} event - The key-press event
 * @param {Object} options - Handler options
 * @param {Gio.Settings} options.settings - Extension settings (required for key bindings)
 * @param {string} options.itemId - The item's ID
 * @param {boolean} options.isPinned - Whether the item is currently pinned
 * @param {Set} options.selectedIds - Set of selected item IDs
 * @param {Object} options.checkboxIcon - The checkbox icon with state property
 * @param {Object} options.manager - ClipboardManager for pin/delete actions
 * @param {Function} options.onSelectionChanged - Callback when selection changes
 * @returns {number} Clutter.EVENT_STOP if handled, Clutter.EVENT_PROPAGATE otherwise
 */
export function handleClipboardItemKeyPress(event, options) {
    const { settings, itemId, isPinned, selectedIds, checkboxIcon, manager, onSelectionChanged } = options;

    if (!settings) {
        return Clutter.EVENT_PROPAGATE;
    }

    const keyName = event.get_key_symbol();

    // Get configured keys from settings
    const selectKeyName = settings.get_string(ClipboardKeySettings.TOGGLE_SELECT);
    const pinKeyName = settings.get_string(ClipboardKeySettings.TOGGLE_PIN);
    const deleteKeyName = settings.get_string(ClipboardKeySettings.DELETE);

    const selectRecKey = resolveKeySymbol(selectKeyName);
    const pinRecKey = resolveKeySymbol(pinKeyName);
    const deleteRecKey = resolveKeySymbol(deleteKeyName);

    // Toggle Selection
    if (selectRecKey !== null && keyName === selectRecKey) {
        if (selectedIds.has(itemId)) {
            selectedIds.delete(itemId);
            checkboxIcon.state = 'unchecked';
        } else {
            selectedIds.add(itemId);
            checkboxIcon.state = 'checked';
        }
        onSelectionChanged?.();
        return Clutter.EVENT_STOP;
    }

    // Delete Item
    if (deleteRecKey !== null && keyName === deleteRecKey) {
        manager.deleteItem(itemId);
        return Clutter.EVENT_STOP;
    }

    // Toggle Pin
    if (pinRecKey !== null && keyName === pinRecKey) {
        if (isPinned) {
            manager.unpinItem(itemId);
        } else {
            manager.pinItem(itemId);
        }
        return Clutter.EVENT_STOP;
    }

    return Clutter.EVENT_PROPAGATE;
}
