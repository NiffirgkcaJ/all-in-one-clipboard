/**
 * ClipboardItemUpdateService
 *
 * Persists in-place item updates for either history or pinned items.
 */
export class ClipboardItemUpdateService {
    // ========================================================================
    // Initialization
    // ========================================================================

    /**
     * Initialize the update service.
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
     * Update an item and persist the owning list.
     *
     * @param {string} id Item ID.
     * @param {Function} updater Mutates and returns whether the item changed.
     * @returns {boolean} True when an item changed and was persisted.
     */
    updateItemById(id, updater) {
        const owner = this._itemStore.updateItemById(id, updater);

        if (owner === 'history') {
            this._storage.saveHistory(this._itemStore.getHistoryItems());
            this._onHistoryChanged();
            return true;
        }

        if (owner === 'pinned') {
            this._storage.savePinned(this._itemStore.getPinnedItems());
            this._onPinnedChanged();
            return true;
        }

        return false;
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
