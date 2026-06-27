/**
 * ClipboardPinnedService
 *
 * Handles pinning workflows while ClipboardItemStore owns list mutation.
 */
export class ClipboardPinnedService {
    // ========================================================================
    // Initialization
    // ========================================================================

    /**
     * Initialize the pinned service.
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
     * Pin one history item.
     *
     * @param {string} id Item ID.
     */
    pinItem(id) {
        this.pinItems([id]);
    }

    /**
     * Pin multiple history items.
     *
     * @param {Array<string>} ids Item IDs.
     */
    pinItems(ids) {
        if (!this._itemStore.moveHistoryItemsToPinned([...ids].reverse())) return;
        this._saveAllAndNotify();
    }

    /**
     * Unpin one pinned item.
     *
     * @param {string} id Item ID.
     */
    unpinItem(id) {
        this.unpinItems([id]);
    }

    /**
     * Unpin multiple pinned items.
     *
     * @param {Array<string>} ids Item IDs.
     */
    unpinItems(ids) {
        if (!this._itemStore.movePinnedItemsToHistory([...ids].reverse())) return;
        this._storage.pruneHistory(this._itemStore.getHistoryItems());
        this._saveAllAndNotify();
    }

    /**
     * Move one pinned item to history by index.
     *
     * @param {number} index Pinned item index.
     */
    movePinnedItemToHistory(index) {
        if (!this._itemStore.movePinnedItemToHistory(index)) return;
        this._saveAllAndNotify();
    }

    /**
     * Clear all pinned items and delete their associated files.
     */
    clearPinned() {
        const removedItems = this._itemStore.clearPinnedItems();
        removedItems.forEach((item) => this._storage.deleteItemFiles(item));
        this._storage.savePinned(this._itemStore.getPinnedItems());
        this._onPinnedChanged();
    }

    // ========================================================================
    // Internal Helpers
    // ========================================================================

    /**
     * Save history and pinned items, then notify both views.
     *
     * @private
     */
    _saveAllAndNotify() {
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
