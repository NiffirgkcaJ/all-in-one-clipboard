import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Soup from 'gi://Soup';

import { ExclusionUtils } from '../../../shared/utilities/utilityExclusions.js';
import { ServiceImage } from '../../../shared/services/serviceImage.js';
import { clipboardSetText, clipboardSetContent } from '../../../shared/utilities/utilityClipboard.js';

import { ClipboardMonitor } from './clipboardMonitor.js';
import { ClipboardStorage } from './clipboardStorage.js';
import { ClipboardType } from '../constants/clipboardConstants.js';
import { ContactProcessor } from '../processors/clipboardContactProcessor.js';
import { ImageProcessor } from '../processors/clipboardImageProcessor.js';
import { LinkProcessor } from '../processors/clipboardLinkProcessor.js';
import { TextProcessor } from '../processors/clipboardTextProcessor.js';

// Configuration Keys
const CLIPBOARD_HISTORY_MAX_ITEMS_KEY = 'clipboard-history-max-items';

/**
 * ClipboardManager
 *
 * Orchestrates clipboard history and pinned items.
 * This class connects the input monitor to the output storage and handles content-specific logic.
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

            this._monitor = new ClipboardMonitor(this._exclusionUtils, this._storage.imagesDir, (result) => this._processResult(result));

            this._history = [];
            this._pinned = [];
            this._lastContent = null;
            this._isPaused = false;
            this._settingsSignalIds = [];

            this._setupSettingsMonitoring();

            this._linkProcessor = new LinkProcessor();
            this._httpSession = new Soup.Session();
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
                .verifyAndHealData(this._history, this._pinned, this._linkProcessor, this._httpSession)
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

        // ========================================================================
        // Internal Processing
        // ========================================================================

        /**
         * Process captured clipboard content and route it to the appropriate handler.
         *
         * @param {Object} result Extracted clipboard content.
         * @private
         */
        _processResult(result) {
            if (!result || result.hash === this._lastContent) return;
            this._lastContent = result.hash;

            switch (result.type) {
                case ClipboardType.IMAGE:
                    this._handleExtractedContent(result, ImageProcessor, this._storage.imagesDir);
                    break;
                case ClipboardType.FILE:
                    this._handleGenericFileItem(result);
                    break;
                case ClipboardType.URL:
                    this._handleLinkItem(result);
                    break;
                case ClipboardType.CONTACT:
                    this._handleContactItem(result);
                    break;
                case ClipboardType.COLOR:
                    this._handleColorItem(result);
                    break;
                case ClipboardType.CODE:
                    this._handleCodeItem(result);
                    break;
                case ClipboardType.TEXT:
                    this._handleExtractedContent(result, TextProcessor, this._storage.textsDir);
                    break;
                default:
                    console.warn(`[AIO-Clipboard] Unknown type: ${result.type}`);
            }
        }

        // ========================================================================
        // Content Type Handlers
        // ========================================================================

        /**
         * Handle generic file items captured from the clipboard.
         *
         * @param {Object} fileResult Extracted file content.
         * @private
         */
        _handleGenericFileItem(fileResult) {
            const newItem = {
                id: GLib.uuid_string_random(),
                type: ClipboardType.FILE,
                timestamp: Math.floor(Date.now() / 1000),
                preview: fileResult.preview,
                file_uri: fileResult.file_uri,
                hash: fileResult.hash,
            };

            this._addItemToHistory(newItem);
        }

        /**
         * Handle link items and fetch their metadata.
         *
         * @param {Object} linkResult Extracted link content.
         * @private
         */
        _handleLinkItem(linkResult) {
            const newItem = {
                id: GLib.uuid_string_random(),
                type: ClipboardType.URL,
                timestamp: Math.floor(Date.now() / 1000),
                url: linkResult.url,
                title: linkResult.title,
                hash: linkResult.hash,
                icon_filename: null,
            };

            this._addItemToHistory(newItem);

            if (this._exclusionUtils.isAddressExcluded(newItem.url)) return;

            this._linkProcessor.fetchMetadata(newItem.url).then(async (metadata) => {
                let updated = false;
                const item = this._history.find((i) => i.id === newItem.id);
                if (!item) return;

                if (metadata.title) {
                    item.title = metadata.title;
                    updated = true;
                }

                if (metadata.iconUrl) {
                    const filename = await this._linkProcessor.downloadFavicon(metadata.iconUrl, this._storage.linkPreviewsDir, newItem.id);
                    if (filename) {
                        item.icon_filename = filename;
                        updated = true;
                    }
                }

                if (updated) {
                    this._saveHistory();
                    this.emit('history-changed');
                }
            });
        }

        /**
         * Handle contact items and attempt to fetch favicon if it's an email.
         *
         * @param {Object} contactResult Extracted contact content.
         * @private
         */
        _handleContactItem(contactResult) {
            const newItem = {
                id: GLib.uuid_string_random(),
                type: ClipboardType.CONTACT,
                timestamp: Math.floor(Date.now() / 1000),
                subtype: contactResult.subtype,
                text: contactResult.text,
                preview: contactResult.preview,
                hash: contactResult.hash,
                metadata: contactResult.metadata,
            };

            this._addItemToHistory(newItem);

            if (newItem.subtype === 'email') {
                if (this._exclusionUtils.isAddressExcluded(newItem.text)) return;

                const parts = newItem.text.split('@');
                if (parts.length === 2) {
                    const url = `https://${parts[1]}`;
                    this._linkProcessor
                        .fetchMetadata(url)
                        .then(async (metadata) => {
                            if (metadata.iconUrl) {
                                const filename = await this._linkProcessor.downloadFavicon(metadata.iconUrl, this._storage.linkPreviewsDir, newItem.id);
                                if (filename) {
                                    newItem.icon_filename = filename;
                                    this._saveHistory();
                                    this.emit('history-changed');
                                }
                            }
                        })
                        .catch(() => {});
                }
            }
        }

        /**
         * Handle color items.
         *
         * @param {Object} colorResult Extracted color content.
         * @private
         */
        _handleColorItem(colorResult) {
            const newItem = {
                id: GLib.uuid_string_random(),
                type: ClipboardType.COLOR,
                timestamp: Math.floor(Date.now() / 1000),
                color_value: colorResult.color_value,
                format_type: colorResult.format_type,
                hash: colorResult.hash,
                preview: colorResult.color_value,
                gradient_filename: colorResult.gradient_filename || null,
                subtype: colorResult.subtype || 'single',
            };

            this._addItemToHistory(newItem);
        }

        /**
         * Handle code items by treating them as extracted text.
         *
         * @param {Object} codeResult Extracted code content.
         * @private
         */
        _handleCodeItem(codeResult) {
            this._handleExtractedContent(codeResult, TextProcessor, this._storage.textsDir, true);
        }

        /**
         * Save extracted content to disk and update history.
         *
         * @param {Object} extraction Extracted content.
         * @param {class} ProcessorClass Processor class for saving.
         * @param {string} storageDir Target storage directory.
         * @param {boolean} forceFileSave Whether to force saving to a file.
         * @private
         */
        async _handleExtractedContent(extraction, ProcessorClass, storageDir, forceFileSave = false) {
            const hash = extraction.hash;

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

            const newItem =
                ProcessorClass === ImageProcessor
                    ? await ProcessorClass.save(extraction, storageDir, this._storage.imagePreviewsDir)
                    : await ProcessorClass.save(extraction, storageDir, forceFileSave);

            if (newItem) {
                this._history.unshift(newItem);
                this._storage.pruneHistory(this._history);
                this._saveHistory();
                this.emit('history-changed');
            }
        }

        // ========================================================================
        // History Management
        // ========================================================================

        /**
         * Add a new item to the history, handling duplicates and pinning.
         *
         * @param {Object} newItem The new item to add.
         * @private
         */
        _addItemToHistory(newItem) {
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
            try {
                switch (itemData.type) {
                    case ClipboardType.IMAGE: {
                        if (itemData.file_uri) {
                            const bytes = new GLib.Bytes(new TextEncoder().encode(itemData.file_uri + '\r\n'));
                            clipboardSetContent('text/uri-list', bytes);
                            return true;
                        }

                        const imagePath = GLib.build_filenamev([this._storage.imagesDir, itemData.image_filename]);
                        const bytes = ServiceImage.decode(await this._storage.readRaw(imagePath));

                        if (!bytes) return false;
                        clipboardSetContent(ServiceImage.getMimeType(itemData.image_filename), bytes);
                        return true;
                    }
                    case ClipboardType.FILE: {
                        const bytes = new GLib.Bytes(new TextEncoder().encode(itemData.file_uri + '\r\n'));
                        clipboardSetContent('text/uri-list', bytes);
                        return true;
                    }
                    case ClipboardType.URL:
                    case ClipboardType.COLOR:
                        clipboardSetText(itemData.url || itemData.color_value);
                        return true;
                    case ClipboardType.CONTACT:
                    case ClipboardType.CODE:
                    case ClipboardType.TEXT: {
                        let content = itemData.text || (await this.getContent(itemData.id));

                        if (!content && itemData.preview && itemData.type !== ClipboardType.CODE) {
                            content = itemData.preview;
                        }

                        if (!content) return false;
                        clipboardSetText(content);
                        return true;
                    }
                    default:
                        return false;
                }
            } catch (e) {
                console.error(`[AIO-Clipboard] Copy failed: ${e.message}`);
                return false;
            }
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
            this._addItemToHistory(item);
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

            this._linkProcessor?.destroy();
            this._httpSession?.abort();
            this._exclusionUtils?.destroy();
        }
    },
);
