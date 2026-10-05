import GObject from 'gi://GObject';

import { ExclusionUtils } from '../../../shared/utilities/utilityExclusions.js';
import { Logger } from '../../../shared/utilities/utilityLogger.js';

import { ClipboardCaptureGuardService } from '../services/clipboardCaptureGuardService.js';
import { ClipboardContentRouterService } from '../services/clipboardContentRouterService.js';
import { ClipboardCopyService } from '../services/clipboardCopyService.js';
import { ClipboardHistoryDeduperService } from '../services/clipboardHistoryDeduperService.js';
import { ClipboardHistoryService } from '../services/clipboardHistoryService.js';
import { ClipboardItemRemovalService } from '../services/clipboardItemRemovalService.js';
import { ClipboardItemStore } from '../logic/clipboardItemStore.js';
import { ClipboardItemUpdateService } from '../services/clipboardItemUpdateService.js';
import { ClipboardMonitor } from '../logic/clipboardMonitor.js';
import { ClipboardPinnedService } from '../services/clipboardPinnedService.js';
import { ClipboardRegistry } from '../registry/clipboardRegistry.js';
import { ClipboardStorage } from '../logic/clipboardStorage.js';

// Configuration Keys
const CLIPBOARD_HISTORY_MAX_ITEMS_KEY = 'clipboard-history-max-items';

/**
 * ClipboardManager
 *
 * Orchestrates clipboard history and pinned items.
 * Delegates content routing to ClipboardContentRouterService and clipboard I/O to ClipboardCopyService.
 *
 * @emits history-changed Emitted when the clipboard history changes.
 * @emits pinned-changed Emitted when the pinned items list changes.
 */
export const ClipboardManager = GObject.registerClass(
    {
        Signals: {
            'history-changed': {},
            'pinned-changed': {},
        },
    },
    class ClipboardManager extends GObject.Object {
        // ========================================================================
        // Initialization
        // ========================================================================

        /**
         * Initialize the clipboard manager.
         *
         * @param {string} uuid Extension UUID.
         * @param {Gio.Settings} settings Extension settings.
         */
        constructor(uuid, settings) {
            super();
            this._uuid = uuid;
            this._settings = settings;

            this._clipboardRegistry = new ClipboardRegistry();
            this._storage = new ClipboardStorage(settings, this._clipboardRegistry);
            this._exclusionUtils = new ExclusionUtils();
            this._exclusionUtils.initialize(settings);

            this._isPaused = false;
            this._settingsSignalIds = [];

            this._captureGuard = new ClipboardCaptureGuardService();
            this._itemStore = new ClipboardItemStore();
            const onHistoryChanged = () => this.emit('history-changed');
            const onPinnedChanged = () => this.emit('pinned-changed');

            this._historyDeduper = new ClipboardHistoryDeduperService(this._settings, this._itemStore);
            this._historyService = new ClipboardHistoryService(this._itemStore, this._storage, this._historyDeduper, onHistoryChanged);
            this._pinnedService = new ClipboardPinnedService(this._itemStore, this._storage, onHistoryChanged, onPinnedChanged);
            this._removalService = new ClipboardItemRemovalService(this._itemStore, this._storage, onHistoryChanged, onPinnedChanged);
            this._itemUpdateService = new ClipboardItemUpdateService(this._itemStore, this._storage, onHistoryChanged, onPinnedChanged);
            this._historyDeduper.bindServices(this._historyService, this._pinnedService);

            this._monitor = new ClipboardMonitor(this._exclusionUtils, this._storage.imagesDir, this._clipboardRegistry, (result) => this._contentRouter.processResult(result), this._captureGuard);

            this._contentRouter = new ClipboardContentRouterService(
                this._itemStore,
                this._historyDeduper,
                this._historyService,
                this._itemUpdateService,
                this._clipboardRegistry,
                this._storage,
                this._exclusionUtils,
            );

            this._setupSettingsMonitoring();
        }

        /**
         * Set up listeners for settings changes.
         *
         * @private
         */
        _setupSettingsMonitoring() {
            const maxHistorySignalId = this._settings.connect(`changed::${CLIPBOARD_HISTORY_MAX_ITEMS_KEY}`, () => {
                this._historyService.pruneHistory();
            });
            this._settingsSignalIds.push(maxHistorySignalId);
        }

        /**
         * Load clipboard data from disk and start monitoring.
         *
         * @returns {Promise<boolean>} True if data loaded successfully.
         */
        async loadAndPrepare() {
            await this._clipboardRegistry.initialize();

            const data = await this._storage.loadData();
            this._itemStore.load(data.history, data.pinned);

            this.emit('history-changed');
            this.emit('pinned-changed');

            this._monitor.start();

            this._storage
                .verifyAndHealData(this._itemStore.getHistoryItems(), this._itemStore.getPinnedItems(), this._contentRouter.httpSession)
                .then((changed) => {
                    if (changed) {
                        this._storage.saveAll(this._itemStore.getHistoryItems(), this._itemStore.getPinnedItems());
                        this.emit('history-changed');
                        this.emit('pinned-changed');
                    }
                })
                .catch((e) => {
                    Logger.error(`Data healing failed: ${e.message}`);
                });

            return true;
        }

        // ========================================================================
        // Getters
        // ========================================================================

        /**
         * Get the path to the images directory.
         *
         * @returns {string} Directory path.
         */
        get imagesDir() {
            return this._storage.imagesDir;
        }

        /**
         * Get the path to the image previews directory.
         *
         * @returns {string} Directory path.
         */
        get imagePreviewsDir() {
            return this._storage.imagePreviewsDir;
        }

        /**
         * Get the path to the link previews directory.
         *
         * @returns {string} Directory path.
         */
        get linkPreviewsDir() {
            return this._storage.linkPreviewsDir;
        }

        /**
         * Get the path to the texts directory.
         *
         * @returns {string} Directory path.
         */
        get textsDir() {
            return this._storage.textsDir;
        }

        /**
         * Get the extension settings.
         *
         * @returns {Gio.Settings} Extension settings.
         */
        get settings() {
            return this._settings;
        }

        /**
         * Get the storage instance.
         *
         * @returns {ClipboardStorage} Storage instance.
         */
        get storage() {
            return this._storage;
        }

        /**
         * Get the capture guard instance.
         *
         * @returns {ClipboardCaptureGuardService} Capture guard instance.
         */
        get captureGuard() {
            return this._captureGuard;
        }

        // ========================================================================
        // History Management
        // ========================================================================

        /**
         * Add a new item to the history, handling duplicates and pinning.
         *
         * @param {Object} newItem The new item to add.
         */
        addItemToHistory(newItem) {
            this._historyDeduper.addItemToHistory(newItem);
        }

        /**
         * Handle duplicate check and recency promotion for extracted content.
         *
         * @param {string} hash Content hash.
         * @returns {boolean} True if content is a duplicate and was handled.
         */
        handleDuplicateCheck(hash) {
            return this._historyDeduper.handleDuplicateCheck(hash);
        }

        // ========================================================================
        // Public API
        // ========================================================================

        /**
         * Get all clipboard history items.
         *
         * @returns {Array} List of history items.
         */
        getHistoryItems() {
            return this._itemStore.getHistoryItems();
        }

        /**
         * Get all pinned clipboard items.
         *
         * @returns {Array} List of pinned items.
         */
        getPinnedItems() {
            return this._itemStore.getPinnedItems();
        }

        /**
         * Get the full content for a specific item by ID.
         *
         * @param {string} id Item ID.
         * @returns {Promise<string|null>} Item content.
         */
        async getContent(id) {
            return await this._storage.getContent(id, this._itemStore.getAllItems());
        }

        /**
         * Get rich HTML content for an item from disk.
         *
         * @param {string} id Item ID.
         * @returns {Promise<Uint8Array|null>} Full content or null if not found.
         */
        async getRichContent(id) {
            return await this._storage.getRichContent(id, this._itemStore.getAllItems());
        }

        /**
         * Paste embedded images from a rich text item.
         *
         * @param {Object} itemData Rich text item data.
         * @param {Object} [options] Paste options.
         * @returns {Promise<boolean>} True if successful.
         */
        async pasteImagesFromItem(itemData, options = {}) {
            return await this._copyService.pasteImagesFromItem(itemData, this._storage, this, options);
        }

        /**
         * Copy an item's content to the system clipboard.
         *
         * @param {Object} itemData Data of the item to copy.
         * @param {Object} [options] Copy options.
         * @returns {Promise<boolean>} True if successful.
         */
        async copyToSystemClipboard(itemData, options = {}) {
            return ClipboardCopyService.copy(itemData, this._storage, this, options);
        }

        /**
         * Pin an item from the history.
         *
         * @param {string} id Item ID.
         */
        pinItem(id) {
            this._pinnedService.pinItem(id);
        }

        /**
         * Pin multiple items from the history.
         *
         * @param {Array<string>} ids List of item IDs.
         */
        pinItems(ids) {
            this._pinnedService.pinItems(ids);
        }

        /**
         * Unpin an item and move it back to history.
         *
         * @param {string} id Item ID.
         */
        unpinItem(id) {
            this._pinnedService.unpinItem(id);
        }

        /**
         * Unpin multiple items and move them back to history.
         *
         * @param {Array<string>} ids List of item IDs.
         */
        unpinItems(ids) {
            this._pinnedService.unpinItems(ids);
        }

        /**
         * Promote an item to the top of its respective list.
         *
         * @param {string} id Item ID.
         */
        promoteItemToTop(id) {
            this._historyDeduper.promoteItemToTop(id);
        }

        /**
         * Delete an item from history or pinned items.
         *
         * @param {string} id Item ID.
         */
        deleteItem(id) {
            this._removalService.deleteItem(id);
        }

        /**
         * Delete multiple items by their IDs.
         *
         * @param {Array<string>} ids List of item IDs.
         */
        deleteItems(ids) {
            this._removalService.deleteItems(ids);
        }

        /**
         * Clear all items from the clipboard history.
         */
        clearHistory() {
            this._historyService.clearHistory();
        }

        /**
         * Clear all pinned clipboard items.
         */
        clearPinned() {
            this._pinnedService.clearPinned();
        }

        /**
         * Run garbage collection to clean up orphaned files.
         */
        runGarbageCollection() {
            this._storage.runGarbageCollection(this._itemStore.getHistoryItems(), this._itemStore.getPinnedItems());
        }

        /**
         * Schedule the background generation of image previews.
         */
        scheduleImagePreviewWarmup() {
            this._storage.scheduleImagePreviewWarmup(this._itemStore.getHistoryItems(), this._itemStore.getPinnedItems(), () => {
                this._storage.saveAll(this._itemStore.getHistoryItems(), this._itemStore.getPinnedItems());
            });
        }

        /**
         * Set the paused state of clipboard monitoring.
         *
         * @param {boolean} isPaused Whether monitoring should be paused.
         */
        setPaused(isPaused) {
            this._isPaused = isPaused;
            this._monitor.setPaused(isPaused);
        }

        /**
         * Add an externally created item to the clipboard history.
         *
         * @param {Object} item The item to add.
         */
        addExternalItem(item) {
            this._historyService.addExternalItem(item);
        }

        /**
         * Find a clipboard item by its source URL.
         *
         * @param {string} url Source URL.
         * @returns {Object|null} Matching item or null.
         */
        getItemBySourceUrl(url) {
            return this._itemStore.getItemBySourceUrl(url);
        }

        /**
         * Get or set the last content hash for deduplication.
         *
         * @type {string|null}
         */
        get lastContent() {
            return this._itemStore.lastContent;
        }

        set lastContent(value) {
            this._itemStore.lastContent = value;
        }

        // ========================================================================
        // Lifecycle
        // ========================================================================

        /**
         * Clean up resources and disconnect listeners before destruction.
         */
        destroy() {
            if (this._settingsSignalIds.length) {
                this._settingsSignalIds.forEach((id) => this._settings.disconnect(id));
            }

            this._monitor.destroy();
            this._storage.destroy();
            this._contentRouter.destroy();
            this._exclusionUtils.destroy();
            this._captureGuard.destroy();
            this._clipboardRegistry.destroy();
            this._historyDeduper.destroy();
            this._historyService.destroy();
            this._pinnedService.destroy();
            this._removalService.destroy();
            this._itemUpdateService.destroy();
            this._itemStore.destroy();
        }
    },
);
