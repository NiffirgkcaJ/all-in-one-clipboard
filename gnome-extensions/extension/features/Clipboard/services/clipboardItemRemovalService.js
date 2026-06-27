/**
 * ClipboardItemRemovalService
 *
 * Removes clipboard items from state and cleans up their associated files.
 */
export class ClipboardItemRemovalService {
    // ========================================================================
    // Initialization
    // ========================================================================

    /**
     * Initialize the removal service.
     *
     * @param {ClipboardItemStore} itemStore Clipboard item store.
     * @param {ClipboardStorage} storage Clipboard storage.
     * @param {Function} onHistoryChanged Called when history changes.
     * @param {Function} onPinnedChanged Called when pinned items change.
     */
    constructor(itemStore, storage, onHistoryChanged, onPinnedChanged) {
        this._itemStore = itemStore;
        this._storage = storage;
        this._onHistoryChanged = onHistoryChanged;
        this._onPinnedChanged = onPinnedChanged;
    }

    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Delete one item by ID.
     *
     * @param {string} id Item ID.
     */
    deleteItem(id) {
        this.deleteItems([id]);
    }

    /**
     * Delete multiple items by ID.
     *
     * @param {Array<string>} ids Item IDs.
     */
    deleteItems(ids) {
        const removedItems = this._itemStore.removeItemsByIds(ids);
        if (removedItems.length === 0) return;

        removedItems.forEach((item) => this._storage.deleteItemFiles(item));
        this._storage.saveAll(this._itemStore.getHistoryItems(), this._itemStore.getPinnedItems());
        this._onHistoryChanged();
        this._onPinnedChanged();
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    /**
     * Release references.
     */
    destroy() {
        this._itemStore = null;
        this._storage = null;
        this._onHistoryChanged = null;
        this._onPinnedChanged = null;
    }
}
