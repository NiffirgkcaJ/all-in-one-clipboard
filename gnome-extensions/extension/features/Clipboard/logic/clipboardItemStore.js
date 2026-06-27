/**
 * ClipboardItemStore
 *
 * Holds clipboard item lists and provides primitive list operations only.
 */
export class ClipboardItemStore {
    // ========================================================================
    // Initialization
    // ========================================================================

    /**
     * Initialize empty clipboard state.
     */
    constructor() {
        this._history = [];
        this._pinned = [];
        this._lastContent = null;
    }

    // ========================================================================
    // Loading
    // ========================================================================

    /**
     * Load persisted clipboard state into memory.
     *
     * @param {Array} history Clipboard history items.
     * @param {Array} pinned Pinned clipboard items.
     */
    load(history, pinned) {
        this._history = history || [];
        this._pinned = pinned || [];
    }

    // ========================================================================
    // Queries
    // ========================================================================

    /**
     * Get mutable history items.
     *
     * @returns {Array} History items.
     */
    getHistoryItems() {
        return this._history;
    }

    /**
     * Get mutable pinned items.
     *
     * @returns {Array} Pinned items.
     */
    getPinnedItems() {
        return this._pinned;
    }

    /**
     * Get all clipboard items.
     *
     * @returns {Array} Combined history and pinned items.
     */
    getAllItems() {
        return [...this._history, ...this._pinned];
    }

    /**
     * Find an item by ID.
     *
     * @param {string} id Item ID.
     * @returns {Object|null} Matching item or null.
     */
    findItemById(id) {
        return this._history.find((item) => item.id === id) || this._pinned.find((item) => item.id === id) || null;
    }

    /**
     * Find a history item index by ID.
     *
     * @param {string} id Item ID.
     * @returns {number} Matching index or -1.
     */
    findHistoryIndexById(id) {
        if (!id) return -1;
        return this._history.findIndex((item) => item.id === id);
    }

    /**
     * Find a pinned item index by ID.
     *
     * @param {string} id Item ID.
     * @returns {number} Matching index or -1.
     */
    findPinnedIndexById(id) {
        if (!id) return -1;
        return this._pinned.findIndex((item) => item.id === id);
    }

    /**
     * Find a history item index by content hash.
     *
     * @param {string} hash Content hash.
     * @returns {number} Matching index or -1.
     */
    findHistoryIndexByHash(hash) {
        if (!hash) return -1;
        return this._history.findIndex((item) => item.hash === hash);
    }

    /**
     * Find a pinned item index by content hash.
     *
     * @param {string} hash Content hash.
     * @returns {number} Matching index or -1.
     */
    findPinnedIndexByHash(hash) {
        if (!hash) return -1;
        return this._pinned.findIndex((item) => item.hash === hash);
    }

    /**
     * Find an item by source URL.
     *
     * @param {string} url Source URL.
     * @returns {Object|null} Matching item or null.
     */
    getItemBySourceUrl(url) {
        if (!url) return null;
        return this._history.find((item) => item.source_url === url) || this._pinned.find((item) => item.source_url === url) || null;
    }

    /**
     * Get the last captured content hash.
     *
     * @returns {string|null} Last content hash.
     */
    get lastContent() {
        return this._lastContent;
    }

    /**
     * Set the last captured content hash.
     *
     * @param {string|null} value Content hash.
     */
    set lastContent(value) {
        this._lastContent = value;
    }

    // ========================================================================
    // Mutations
    // ========================================================================

    /**
     * Insert an item at the top of history.
     *
     * @param {Object} item Item to insert.
     * @returns {boolean} True when inserted.
     */
    insertHistoryItem(item) {
        if (!item) return false;
        this._history.unshift(item);
        return true;
    }

    /**
     * Promote a history item to the top of history.
     *
     * @param {number} index History item index.
     * @returns {boolean} True when moved.
     */
    promoteHistoryItem(index) {
        if (index < 0 || index >= this._history.length) return false;
        const [item] = this._history.splice(index, 1);
        this._history.unshift(item);
        return true;
    }

    /**
     * Move a pinned item back into history.
     *
     * @param {number} index Pinned item index.
     * @returns {boolean} True when moved.
     */
    movePinnedItemToHistory(index) {
        if (index < 0 || index >= this._pinned.length) return false;
        const [item] = this._pinned.splice(index, 1);
        this._history.unshift(item);
        return true;
    }

    /**
     * Move history items into pinned items.
     *
     * @param {Array<string>} orderedIds Item IDs in move order.
     * @returns {boolean} True when at least one item moved.
     */
    moveHistoryItemsToPinned(orderedIds) {
        return this._moveItemsById(this._history, this._pinned, orderedIds);
    }

    /**
     * Move pinned items into history.
     *
     * @param {Array<string>} orderedIds Item IDs in move order.
     * @returns {boolean} True when at least one item moved.
     */
    movePinnedItemsToHistory(orderedIds) {
        return this._moveItemsById(this._pinned, this._history, orderedIds);
    }

    /**
     * Update an item by ID.
     *
     * @param {string} id Item ID.
     * @param {Function} updater Mutates and returns whether the item changed.
     * @returns {string|null} Owning list name or null when unchanged/not found.
     */
    updateItemById(id, updater) {
        const historyItem = this._history.find((item) => item.id === id);
        if (historyItem) {
            return updater(historyItem) ? 'history' : null;
        }

        const pinnedItem = this._pinned.find((item) => item.id === id);
        if (pinnedItem) {
            return updater(pinnedItem) ? 'pinned' : null;
        }

        return null;
    }

    /**
     * Remove items by IDs from history and pinned lists.
     *
     * @param {Array<string>} ids Item IDs.
     * @returns {Array<Object>} Removed items.
     */
    removeItemsByIds(ids) {
        const removedItems = [];

        for (const id of ids) {
            this._removeFromList(this._history, id, removedItems);
            this._removeFromList(this._pinned, id, removedItems);
        }

        if (removedItems.some((item) => item.hash === this._lastContent)) {
            this._lastContent = null;
        }

        return removedItems;
    }

    /**
     * Clear history items.
     *
     * @returns {Array<Object>} Removed history items.
     */
    clearHistoryItems() {
        const removedItems = [...this._history];
        this._history = [];
        return removedItems;
    }

    /**
     * Clear pinned items.
     *
     * @returns {Array<Object>} Removed pinned items.
     */
    clearPinnedItems() {
        const removedItems = [...this._pinned];
        this._pinned = [];
        return removedItems;
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    /**
     * Clear in-memory references.
     */
    destroy() {
        this._history = [];
        this._pinned = [];
    }

    // ========================================================================
    // Internal Helpers
    // ========================================================================

    /**
     * Move items between two lists by ID.
     *
     * @param {Array} source Source list.
     * @param {Array} target Target list.
     * @param {Array<string>} orderedIds Item IDs in move order.
     * @returns {boolean} True when at least one item moved.
     * @private
     */
    _moveItemsById(source, target, orderedIds) {
        let changed = false;

        for (const id of orderedIds) {
            const index = source.findIndex((item) => item.id === id);
            if (index > -1) {
                const [item] = source.splice(index, 1);
                target.unshift(item);
                changed = true;
            }
        }

        return changed;
    }

    /**
     * Remove an item from a list and append it to removedItems.
     *
     * @param {Array} list List to mutate.
     * @param {string} id Item ID.
     * @param {Array<Object>} removedItems Removed item accumulator.
     * @private
     */
    _removeFromList(list, id, removedItems) {
        const index = list.findIndex((item) => item.id === id);
        if (index === -1) return;

        const [item] = list.splice(index, 1);
        removedItems.push(item);
    }
}
