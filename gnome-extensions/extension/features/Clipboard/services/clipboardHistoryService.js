/**
 * ClipboardHistoryService
 *
 * Handles history-specific workflows while ClipboardItemStore owns the list state.
 */
export class ClipboardHistoryService {
    // ========================================================================
    // Initialization
    // ========================================================================

    /**
     * Initialize the history service.
     *
     * @param {ClipboardItemStore} itemStore Clipboard item store.
     * @param {ClipboardStorage} storage Clipboard storage.
     * @param {ClipboardHistoryDeduperService} historyDeduper Duplicate handling service.
     * @param {Function} onHistoryChanged Called when history changes.
     */
    constructor(itemStore, storage, historyDeduper, onHistoryChanged) {
        this._itemStore = itemStore;
        this._storage = storage;
        this._historyDeduper = historyDeduper;
        this._onHistoryChanged = onHistoryChanged;
    }

    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Add an externally created item to history.
     *
     * @param {Object} item Item to add.
     */
    addExternalItem(item) {
        this._historyDeduper.addItemToHistory(item);
    }

    /**
     * Insert an item into history and persist the change.
     *
     * @param {Object} item Item to insert.
     */
    insertItemToHistory(item) {
        if (!this._itemStore.insertHistoryItem(item)) return;
        this._storage.pruneHistory(this._itemStore.getHistoryItems());
        this._saveHistoryAndNotify();
    }

    /**
     * Promote a history item by index.
     *
     * @param {number} index History item index.
     */
    promoteHistoryItem(index) {
        if (!this._itemStore.promoteHistoryItem(index)) return;
        this._saveHistoryAndNotify();
    }

    /**
     * Prune history according to the current max-history setting.
     *
     * @param {boolean} shouldNotify Whether to emit history change notification.
     */
    pruneHistory(shouldNotify = true) {
        this._storage.pruneHistory(this._itemStore.getHistoryItems());
        this._storage.saveHistory(this._itemStore.getHistoryItems());
        if (shouldNotify) this._onHistoryChanged();
    }

    /**
     * Clear all history items and delete their associated files.
     */
    clearHistory() {
        const removedItems = this._itemStore.clearHistoryItems();
        removedItems.forEach((item) => this._storage.deleteItemFiles(item));
        this._saveHistoryAndNotify();
    }

    // ========================================================================
    // Internal Helpers
    // ========================================================================

    /**
     * Save history and emit the history change callback.
     *
     * @private
     */
    _saveHistoryAndNotify() {
        this._storage.saveHistory(this._itemStore.getHistoryItems());
        this._onHistoryChanged();
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
        this._historyDeduper = null;
        this._onHistoryChanged = null;
    }
}
