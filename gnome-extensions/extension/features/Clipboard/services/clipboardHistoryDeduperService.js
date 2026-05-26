/**
 * ClipboardHistoryDeduperService
 *
 * Centralizes history/pinned duplicate handling and recency promotion.
 */
export class ClipboardHistoryDeduperService {
    // ========================================================================
    // Initialization
    // ========================================================================

    /**
     * Initialize the deduplication service.
     *
     * @param {ClipboardManager} manager Clipboard manager instance.
     */
    constructor(manager) {
        this._manager = manager;
    }

    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Add a new item to the history, handling duplicates and pinning.
     *
     * @param {Object} newItem The new item to add.
     */
    addItemToHistory(newItem) {
        const hash = newItem.hash;

        const historyIndex = this._manager._history.findIndex((item) => item.hash === hash);
        if (historyIndex > -1) {
            if (this._manager._settings.get_boolean('update-recency-on-copy') && historyIndex > 0) {
                this._manager._promoteExistingItem(historyIndex, this._manager._history);
            }
            return;
        }

        const pinnedIndex = this._manager._pinned.findIndex((item) => item.hash === hash);
        if (pinnedIndex > -1) {
            this._manager._promotePinnedItem(pinnedIndex);
            return;
        }

        this._manager._history.unshift(newItem);
        this._manager._storage.pruneHistory(this._manager._history);
        this._manager._saveHistory();
        this._manager.emit('history-changed');
    }

    /**
     * Handle duplicate check and recency promotion for extracted content.
     *
     * @param {string} hash Content hash.
     * @returns {boolean} True if content is a duplicate and was handled.
     */
    handleDuplicateCheck(hash) {
        const historyIndex = this._manager._history.findIndex((item) => item.hash === hash);
        if (historyIndex > -1) {
            if (this._manager._settings.get_boolean('update-recency-on-copy') && historyIndex > 0) {
                this._manager._promoteExistingItem(historyIndex, this._manager._history);
            }
            return true;
        }

        const pinnedIndex = this._manager._pinned.findIndex((item) => item.hash === hash);
        if (pinnedIndex > -1) {
            this._manager._promotePinnedItem(pinnedIndex);
            return true;
        }

        return false;
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    /**
     * Clean up resources.
     */
    destroy() {
        this._manager = null;
    }
}
