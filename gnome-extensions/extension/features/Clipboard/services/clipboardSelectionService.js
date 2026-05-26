/**
 * ClipboardSelectionService
 *
 * Manages the selection state for clipboard items.
 * Handles select-all, deselect-all, and state synchronization with the action bar.
 */
export class ClipboardSelectionService {
    // ========================================================================
    // Initialization
    // ========================================================================

    /**
     * Initialize the selection service.
     */
    constructor() {
        this._selectedIds = new Set();
    }

    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Get the set of selected item IDs.
     *
     * @returns {Set<string>} Selected item IDs.
     */
    get selectedIds() {
        return this._selectedIds;
    }

    /**
     * Handle select-all or deselect-all based on current state.
     *
     * @param {Function} getAllItems Returns all currently visible items.
     * @param {Function} getCheckboxIconsMap Returns the checkbox icons map.
     */
    toggleSelectAll(getAllItems, getCheckboxIconsMap) {
        const allItems = getAllItems();
        const iconsMap = getCheckboxIconsMap();
        const shouldSelectAll = this._selectedIds.size < allItems.length;

        if (shouldSelectAll) {
            allItems.forEach((item) => {
                this._selectedIds.add(item.id);
                const icon = iconsMap.get(item.id);
                if (icon) icon.state = 'checked';
            });
        } else {
            this._selectedIds.clear();
            allItems.forEach((item) => {
                const icon = iconsMap.get(item.id);
                if (icon) icon.state = 'unchecked';
            });
        }
    }

    /**
     * Prune stale IDs and update the action bar state.
     *
     * @param {Function} getAllItems Returns all currently visible items.
     * @param {ClipboardActionBar} actionBar The action bar to update.
     */
    updateSelectionState(getAllItems, actionBar) {
        const allItems = getAllItems();
        const validIds = new Set(allItems.map((i) => i.id));

        for (const id of this._selectedIds) {
            if (!validIds.has(id)) {
                this._selectedIds.delete(id);
            }
        }

        actionBar.updateSelectionState(allItems.length);
    }

    /**
     * Clear all selections.
     *
     * @param {Function} [getCheckboxIconsMap] Returns the checkbox icons map.
     */
    clearSelection(getCheckboxIconsMap) {
        if (typeof getCheckboxIconsMap === 'function') {
            const iconsMap = getCheckboxIconsMap();
            if (iconsMap) {
                for (const id of this._selectedIds) {
                    const icon = iconsMap.get(id);
                    if (icon) icon.state = 'unchecked';
                }
            }
        }
        this._selectedIds.clear();
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    /**
     * Clean up resources.
     */
    destroy() {
        this._selectedIds.clear();
    }
}
