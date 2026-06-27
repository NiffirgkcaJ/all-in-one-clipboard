/**
 * ClipboardHistoryDeduperService
 *
 * Handles duplicate detection and recency policy for clipboard history.
 * Applies decisions through ClipboardItemStore without depending on manager internals.
 */
export class ClipboardHistoryDeduperService {
    // ========================================================================
    // Initialization
    // ========================================================================

    /**
     * Initialize the deduplication service.
     *
     * @param {Gio.Settings} settings Extension settings.
     * @param {ClipboardItemStore} itemStore Clipboard item store.
     * @param {ClipboardHistoryService} historyService Clipboard history service.
     * @param {ClipboardPinnedService} pinnedService Clipboard pinned service.
     */
    constructor(settings, itemStore, historyService = null, pinnedService = null) {
        this._settings = settings;
        this._itemStore = itemStore;
        this._historyService = historyService;
        this._pinnedService = pinnedService;
    }

    /**
     * Attach services that are created after the deduper.
     *
     * @param {ClipboardHistoryService} historyService Clipboard history service.
     * @param {ClipboardPinnedService} pinnedService Clipboard pinned service.
     */
    bindServices(historyService, pinnedService) {
        this._historyService = historyService;
        this._pinnedService = pinnedService;
    }

    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Add a new item to history, handling duplicates and pinning policy.
     *
     * @param {Object} newItem Item to add.
     */
    addItemToHistory(newItem) {
        if (!newItem) return;
        if (this.handleDuplicateCheck(newItem.hash)) return;

        this._historyService.insertItemToHistory(newItem);
    }

    /**
     * Handle duplicate check and recency promotion.
     *
     * @param {string} hash Content hash.
     * @returns {boolean} True if content is a duplicate and was handled.
     */
    handleDuplicateCheck(hash) {
        if (!hash) return false;

        const historyIndex = this._itemStore.findHistoryIndexByHash(hash);
        if (historyIndex > -1) {
            if (this._settings.get_boolean('update-recency-on-copy') && historyIndex > 0) {
                this._historyService.promoteHistoryItem(historyIndex);
            }
            return true;
        }

        const pinnedIndex = this._itemStore.findPinnedIndexByHash(hash);
        if (pinnedIndex > -1) {
            if (this._settings.get_boolean('unpin-on-paste')) {
                this._pinnedService.movePinnedItemToHistory(pinnedIndex);
            }
            return true;
        }

        return false;
    }

    /**
     * Promote an item after copy according to recency settings.
     *
     * @param {string} id Item ID.
     */
    promoteItemToTop(id) {
        const pinnedIndex = this._itemStore.findPinnedIndexById(id);
        if (pinnedIndex > -1) {
            if (this._settings.get_boolean('unpin-on-paste')) {
                this._pinnedService.movePinnedItemToHistory(pinnedIndex);
            }
            return;
        }

        const historyIndex = this._itemStore.findHistoryIndexById(id);
        if (historyIndex > -1 && this._settings.get_boolean('update-recency-on-copy') && historyIndex > 0) {
            this._historyService.promoteHistoryItem(historyIndex);
        }
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    /**
     * Release references.
     */
    destroy() {
        this._settings = null;
        this._itemStore = null;
        this._historyService = null;
        this._pinnedService = null;
    }
}
