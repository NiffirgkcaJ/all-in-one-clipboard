import GObject from 'gi://GObject';

import { ExclusionUtils } from '../../../shared/utilities/utilityExclusions.js';

import { ClipboardContentRouter } from '../services/clipboardContentRouter.js';
import { ClipboardCopyService } from '../services/clipboardCopyService.js';
import { ClipboardMonitor } from '../logic/clipboardMonitor.js';
import { ClipboardStorage } from '../logic/clipboardStorage.js';
import { ContactProcessor } from '../processors/clipboardContactProcessor.js';

// Configuration Keys
const CLIPBOARD_HISTORY_MAX_ITEMS_KEY = 'clipboard-history-max-items';

/**
 * ClipboardManager
 *
 * Orchestrates clipboard history and pinned items.
 * Delegates content routing to ClipboardContentRouter and clipboard I/O to ClipboardCopyService.
 *
 * @emits history-changed Emitted when the clipboard history changes.
 * @emits pinned-list-changed Emitted when the pinned items list changes.
 */
export const ClipboardManager = GObject.registerClass(
    {
        Signals: {
            'history-changed': {},
            'pinned-list-changed': {},
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

            this._storage = new ClipboardStorage(settings);
            this._exclusionUtils = new ExclusionUtils();
            this._exclusionUtils.initialize(settings);

            this._monitor = new ClipboardMonitor(this._exclusionUtils, this._storage.imagesDir, (result) => this._contentRouter.processResult(result));

            this._history = [];
            this._pinned = [];
            this._lastContent = null;
            this._isPaused = false;
            this._settingsSignalIds = [];

            this._contentRouter = new ClipboardContentRouter(this, this._storage, this._exclusionUtils);

            this._setupSettingsMonitoring();
        }

        /**
         * Set up listeners for settings changes.
         *
         * @private
         */
        _setupSettingsMonitoring() {
            const maxHistorySignalId = this._settings.connect(`changed::${CLIPBOARD_HISTORY_MAX_ITEMS_KEY}`, () => {
                this._storage.pruneHistory(this._history);
                this._saveHistory();
                this.emit('history-changed');
            });
            this._settingsSignalIds.push(maxHistorySignalId);
        }

        /**
         * Load clipboard data from disk and start monitoring.
         *
         * @returns {Promise<boolean>} True if data loaded successfully.
         */
        async loadAndPrepare() {
            try {
                ContactProcessor.init();
            } catch (e) {
                console.error(`[AIO-Clipboard] ContactProcessor init failed: ${e.message}`);
            }

            const data = await this._storage.loadData();
            this._history = data.history;
            this._pinned = data.pinned;

            this.emit('history-changed');
            this.emit('pinned-list-changed');

            this._monitor.start();

            this._storage
                .verifyAndHealData(this._history, this._pinned, this._contentRouter.linkProcessor, this._contentRouter.httpSession)
                .then((changed) => {
                    if (changed) {
                        this._saveAll();
                        this.emit('history-changed');
                        this.emit('pinned-list-changed');
                    }
                })
                .catch((e) => {
                    console.error(`[AIO-Clipboard] Data healing failed: ${e.message}`);
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

        // ========================================================================
        // History Management
        // ========================================================================

        /**
         * Add a new item to the history, handling duplicates and pinning.
         *
         * @param {Object} newItem The new item to add.
         */
        addItemToHistory(newItem) {
            const hash = newItem.hash;

            const historyIndex = this._history.findIndex((item) => item.hash === hash);
            if (historyIndex > -1) {
                if (this._settings.get_boolean('update-recency-on-copy') && historyIndex > 0) {
                    this._promoteExistingItem(historyIndex, this._history);
                }
                return;
            }

            const pinnedIndex = this._pinned.findIndex((item) => item.hash === hash);
            if (pinnedIndex > -1) {
                this._promotePinnedItem(pinnedIndex);
                return;
            }

            this._history.unshift(newItem);
            this._storage.pruneHistory(this._history);
            this._saveHistory();
            this.emit('history-changed');
        }

        /**
         * Promote an existing item to the top of its list.
         *
         * @param {number} index Item index.
         * @param {Array} list Target list.
         * @private
         */
        _promoteExistingItem(index, list) {
            const [item] = list.splice(index, 1);
            list.unshift(item);

            if (list === this._history) this._saveHistory();
            this.emit('history-changed');
        }

        /**
         * Promote a pinned item, unpinning it if configured.
         *
         * @param {number} index Pinned item index.
         * @private
         */
        _promotePinnedItem(index) {
            if (this._settings.get_boolean('unpin-on-paste')) {
                const [item] = this._pinned.splice(index, 1);
                this._history.unshift(item);

                this._saveAll();
                this.emit('history-changed');
                this.emit('pinned-list-changed');
            }
        }

        /**
         * Handle duplicate check and recency promotion for extracted content.
         *
         * @param {string} hash Content hash.
         * @returns {boolean} True if content is a duplicate and was handled.
         */
        handleDuplicateCheck(hash) {
            const historyIndex = this._history.findIndex((item) => item.hash === hash);
            if (historyIndex > -1) {
                if (this._settings.get_boolean('update-recency-on-copy') && historyIndex > 0) {
                    this._promoteExistingItem(historyIndex, this._history);
                }
                return true;
            }

            const pinnedIndex = this._pinned.findIndex((item) => item.hash === hash);
            if (pinnedIndex > -1) {
                this._promotePinnedItem(pinnedIndex);
                return true;
            }

            return false;
        }

        // ========================================================================
        // Persistence Proxies
        // ========================================================================

        /**
         * Save clipboard history to storage.
         *
         * @private
         */
        _saveHistory() {
            this._storage.saveHistory(this._history);
        }

        /**
         * Save pinned items to storage.
         *
         * @private
         */
        _savePinned() {
            this._storage.savePinned(this._pinned);
        }

        /**
         * Save both history and pinned items to storage.
         *
         * @private
         */
        _saveAll() {
            this._storage.saveAll(this._history, this._pinned);
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
            return this._history;
        }

        /**
         * Get all pinned clipboard items.
         *
         * @returns {Array} List of pinned items.
         */
        getPinnedItems() {
            return this._pinned;
        }

        /**
         * Get the full content for a specific item by ID.
         *
         * @param {string} id Item ID.
         * @returns {Promise<string|null>} Item content.
         */
        async getContent(id) {
            return await this._storage.getContent(id, [...this._history, ...this._pinned]);
        }

        /**
         * Copy an item's content to the system clipboard.
         *
         * @param {Object} itemData Data of the item to copy.
         * @returns {Promise<boolean>} True if successful.
         */
        async copyToSystemClipboard(itemData) {
            return ClipboardCopyService.copy(itemData, this._storage, this);
        }

        /**
         * Pin an item from the history.
         *
         * @param {string} id Item ID.
         */
        pinItem(id) {
            const index = this._history.findIndex((item) => item.id === id);
            if (index === -1) return;

            const [item] = this._history.splice(index, 1);
            this._pinned.unshift(item);

            this._saveAll();
            this.emit('history-changed');
            this.emit('pinned-list-changed');
        }

        /**
         * Pin multiple items from the history.
         *
         * @param {Array<string>} ids List of item IDs.
         */
        pinItems(ids) {
            let changed = false;

            for (const id of ids.reverse()) {
                const index = this._history.findIndex((item) => item.id === id);
                if (index > -1) {
                    const [item] = this._history.splice(index, 1);
                    this._pinned.unshift(item);
                    changed = true;
                }
            }

            if (changed) {
                this._saveAll();
                this.emit('history-changed');
                this.emit('pinned-list-changed');
            }
        }

        /**
         * Unpin an item and move it back to history.
         *
         * @param {string} id Item ID.
         */
        unpinItem(id) {
            const index = this._pinned.findIndex((item) => item.id === id);
            if (index === -1) return;

            const [item] = this._pinned.splice(index, 1);
            this._history.unshift(item);
            this._storage.pruneHistory(this._history);

            this._saveAll();
            this.emit('history-changed');
            this.emit('pinned-list-changed');
        }

        /**
         * Unpin multiple items and move them back to history.
         *
         * @param {Array<string>} ids List of item IDs.
         */
        unpinItems(ids) {
            let changed = false;

            for (const id of ids.reverse()) {
                const index = this._pinned.findIndex((item) => item.id === id);
                if (index > -1) {
                    const [item] = this._pinned.splice(index, 1);
                    this._history.unshift(item);
                    changed = true;
                }
            }

            if (changed) {
                this._storage.pruneHistory(this._history);
                this._saveAll();
                this.emit('history-changed');
                this.emit('pinned-list-changed');
            }
        }

        /**
         * Promote an item to the top of its respective list.
         *
         * @param {string} id Item ID.
         */
        promoteItemToTop(id) {
            const pinnedIndex = this._pinned.findIndex((item) => item.id === id);
            if (pinnedIndex > -1) {
                this._promotePinnedItem(pinnedIndex);
                return;
            }

            const historyIndex = this._history.findIndex((item) => item.id === id);
            if (historyIndex > -1) {
                if (this._settings.get_boolean('update-recency-on-copy') && historyIndex > 0) {
                    this._promoteExistingItem(historyIndex, this._history);
                }
            }
        }

        /**
         * Delete an item from history or pinned items.
         *
         * @param {string} id Item ID.
         */
        deleteItem(id) {
            let wasDeleted = false;

            const deleteLogic = (list) => {
                const index = list.findIndex((item) => item.id === id);
                if (index > -1) {
                    const [item] = list.splice(index, 1);
                    if (item.hash === this._lastContent) this._lastContent = null;
                    this._storage.deleteItemFiles(item);
                    wasDeleted = true;
                }
            };

            deleteLogic(this._history);
            deleteLogic(this._pinned);

            if (wasDeleted) {
                this._saveAll();
                this.emit('history-changed');
                this.emit('pinned-list-changed');
            }
        }

        /**
         * Delete multiple items by their IDs.
         *
         * @param {Array<string>} ids List of item IDs.
         */
        deleteItems(ids) {
            let wasDeleted = false;

            const deleteLogic = (list, id) => {
                const index = list.findIndex((item) => item.id === id);
                if (index > -1) {
                    const [item] = list.splice(index, 1);
                    if (item.hash === this._lastContent) this._lastContent = null;
                    this._storage.deleteItemFiles(item);
                    wasDeleted = true;
                }
            };

            for (const id of ids) {
                deleteLogic(this._history, id);
                deleteLogic(this._pinned, id);
            }

            if (wasDeleted) {
                this._saveAll();
                this.emit('history-changed');
                this.emit('pinned-list-changed');
            }
        }

        /**
         * Clear all items from the clipboard history.
         */
        clearHistory() {
            this._history.forEach((item) => this._storage.deleteItemFiles(item));
            this._history = [];

            this._saveHistory();
            this.emit('history-changed');
        }

        /**
         * Clear all pinned clipboard items.
         */
        clearPinned() {
            this._pinned.forEach((item) => this._storage.deleteItemFiles(item));
            this._pinned = [];

            this._savePinned();
            this.emit('pinned-list-changed');
        }

        /**
         * Run garbage collection to clean up orphaned files.
         */
        runGarbageCollection() {
            this._storage.runGarbageCollection(this._history, this._pinned);
        }

        /**
         * Schedule the background generation of image previews.
         */
        scheduleImagePreviewWarmup() {
            this._storage.scheduleImagePreviewWarmup(this._history, this._pinned, () => {
                this._saveAll();
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
            this.addItemToHistory(item);
        }

        /**
         * Find a clipboard item by its source URL.
         *
         * @param {string} url Source URL.
         * @returns {Object|null} Matching item or null.
         */
        getItemBySourceUrl(url) {
            if (!url) return null;
            return this._history.find((item) => item.source_url === url) || this._pinned.find((item) => item.source_url === url);
        }

        /**
         * Get or set the last content hash for deduplication.
         *
         * @type {string|null}
         */
        get lastContent() {
            return this._lastContent;
        }

        set lastContent(value) {
            this._lastContent = value;
        }

        // ========================================================================
        // Lifecycle
        // ========================================================================

        /**
         * Clean up resources and disconnect listeners before destruction.
         */
        destroy() {
            if (this._settingsSignalIds?.length) {
                this._settingsSignalIds.forEach((id) => this._settings.disconnect(id));
            }

            this._monitor.destroy();
            this._storage.destroy();
            this._contentRouter?.destroy();
            this._exclusionUtils?.destroy();
        }
    },
);
