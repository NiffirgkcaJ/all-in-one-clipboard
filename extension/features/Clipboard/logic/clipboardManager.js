import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { IOFile } from '../../../shared/utilities/utilityIO.js';
import { ServiceJson } from '../../../shared/services/serviceJson.js';
import { ServiceText } from '../../../shared/services/serviceText.js';
import { FilePath, FileItem } from '../../../shared/constants/storagePaths.js';

import { ClipboardType } from '../constants/clipboardConstants.js';
import { CodeProcessor } from '../processors/clipboardCodeProcessor.js';
import { ColorProcessor } from '../processors/clipboardColorProcessor.js';
import { ContactProcessor } from '../processors/clipboardContactProcessor.js';
import { FileProcessor } from '../processors/clipboardFileProcessor.js';
import { ImageProcessor } from '../processors/clipboardImageProcessor.js';
import { LinkProcessor } from '../processors/clipboardLinkProcessor.js';
import { TextProcessor } from '../processors/clipboardTextProcessor.js';

const CLIPBOARD_HISTORY_MAX_ITEMS_KEY = 'clipboard-history-max-items';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 100;

/**
 * ClipboardManager
 *
 * Manages clipboard history and pinned items, monitors system clipboard changes,
 * and processes various clipboard content types (text, code, images, files, links, colors).
 *
 * @emits history-changed - Emitted when the clipboard history changes
 * @emits pinned-list-changed - Emitted when the pinned items list changes
 */
export const ClipboardManager = GObject.registerClass(
    {
        Signals: {
            'history-changed': {},
            'pinned-list-changed': {},
        },
    },
    class ClipboardManager extends GObject.Object {
        /**
         * Initialize the clipboard manager
         *
         * @param {string} uuid - Extension UUID
         * @param {Gio.Settings} settings - Extension settings
         * @param {string} extensionPath - Path to extension directory
         */
        constructor(uuid, settings) {
            super();
            this._uuid = uuid;
            this._settings = settings;
            this._initialLoadSuccess = false;

            this._linkPreviewsDir = FilePath.LINK_PREVIEWS;
            this._imagesDir = FilePath.IMAGES;
            this._textsDir = FilePath.TEXTS;

            this.imagesDir = this._imagesDir;

            // File paths for history and pinned items
            this._historyFilePath = FileItem.CLIPBOARD_HISTORY;
            this._pinnedFilePath = FileItem.CLIPBOARD_PINNED;

            this._history = [];
            this._pinned = [];
            this._lastContent = null;
            this._selection = null;
            this._debouncing = 0;
            this._isPaused = false;
            this._maxHistory = this._settings.get_int(CLIPBOARD_HISTORY_MAX_ITEMS_KEY);
            this._processClipboardTimeoutId = 0;

            this._ensureDirectories();
            this._setupClipboardMonitoring();
            this._setupSettingsMonitoring();

            this._linkProcessor = new LinkProcessor();
        }

        // ========================================================================
        // Initialization
        // ========================================================================

        /**
         * Set up clipboard change monitoring
         * @private
         */
        _setupClipboardMonitoring() {
            this._selection = Shell.Global.get().get_display().get_selection();
            this._selectionOwnerChangedId = this._selection.connect('owner-changed', (selection, selectionType) => {
                if (selectionType === Meta.SelectionType.SELECTION_CLIPBOARD) {
                    this._onClipboardChanged();
                }
            });
        }

        /**
         * Set up settings change monitoring for max history items
         * @private
         */
        _setupSettingsMonitoring() {
            this._settingsChangedId = this._settings.connect(`changed::${CLIPBOARD_HISTORY_MAX_ITEMS_KEY}`, () => {
                this._maxHistory = this._settings.get_int(CLIPBOARD_HISTORY_MAX_ITEMS_KEY);
                this._pruneHistory();
            });
        }

        /**
         * Load clipboard data from disk and prepare the manager
         *
         * @returns {Promise<boolean>} True if data loaded successfully
         */
        async loadAndPrepare() {
            // Initialize ContactProcessor first before loading the history
            try {
                ContactProcessor.init();
            } catch (e) {
                console.error(`[AIO-Clipboard] ContactProcessor.init() failed: ${e.message}\n${e.stack}`);
            }

            this._initialLoadSuccess = await this.loadData();

            if (this._initialLoadSuccess) {
                this._verifyAndHealData().catch((e) => {
                    console.error(`[AIO-Clipboard] Healing failed: ${e.message}`);
                });
            }

            return this._initialLoadSuccess;
        }

        /**
         * Ensure all required directories exist
         * @private
         */
        _ensureDirectories() {
            [this._imagesDir, this._textsDir, this._linkPreviewsDir].forEach((path) => {
                IOFile.mkdir(path);
            });
        }

        // ========================================================================
        // Content Processing
        // ========================================================================

        /**
         * Handle clipboard change events
         * @private
         */
        _onClipboardChanged() {
            if (this._isPaused) return;

            if (this._processClipboardTimeoutId) {
                GLib.source_remove(this._processClipboardTimeoutId);
            }

            this._processClipboardTimeoutId = GLib.timeout_add(GLib.PRIORITY_LOW, 50, () => {
                this._processClipboardContent(1).catch((e) => console.error(`[AIO-Clipboard] Unhandled error: ${e.message}`));
                this._processClipboardTimeoutId = 0;
                return GLib.SOURCE_REMOVE;
            });
        }

        /**
         * Process clipboard content and detect its type
         *
         * @param {number} attempt - Current retry attempt number
         * @private
         */
        async _processClipboardContent(attempt = 1) {
            try {
                // Image
                const imageResult = await ImageProcessor.extract();
                if (imageResult) {
                    this._processResult(imageResult);
                    return;
                }

                // Text Extraction
                const textResult = await TextProcessor.extract();
                if (textResult) {
                    const text = textResult.text;

                    // File
                    const fileResult = await FileProcessor.process(text);
                    if (fileResult) {
                        this._processResult(fileResult);
                        return;
                    }

                    // Link
                    const linkResult = LinkProcessor.process(text);
                    if (linkResult) {
                        this._processResult(linkResult);
                        return;
                    }

                    // Contact
                    const contactResult = await ContactProcessor.process(text);
                    if (contactResult) {
                        this._processResult(contactResult);
                        return;
                    }

                    // Color
                    const colorResult = ColorProcessor.process(text, this._imagesDir);
                    if (colorResult) {
                        this._processResult(colorResult);
                        return;
                    }

                    // Code
                    const codeResult = CodeProcessor.process(text);
                    if (codeResult) {
                        this._processResult(codeResult);
                        return;
                    }

                    // Fallback Text
                    this._processResult(textResult);
                    return;
                }

                if (attempt <= MAX_RETRIES) {
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, RETRY_DELAY_MS, () => {
                        this._processClipboardContent(attempt + 1);
                        return GLib.SOURCE_REMOVE;
                    });
                }
            } catch (e) {
                console.warn(`[AIO-Clipboard] Could not process clipboard content: ${e.message}\n${e.stack}`);
            }
        }

        /**
         * Process extracted clipboard content and route to appropriate handler
         *
         * @param {Object} result - Extracted clipboard content with type and hash
         * @private
         */
        _processResult(result) {
            if (!result || result.hash === this._lastContent) return;
            this._lastContent = result.hash;

            switch (result.type) {
                case ClipboardType.IMAGE:
                    this._handleExtractedContent(result, ImageProcessor, this._imagesDir);
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
                    this._handleExtractedContent(result, TextProcessor, this._textsDir);
                    break;
                default:
                    console.warn(`[AIO-Clipboard] Unknown result type: ${result.type}`);
            }
        }

        // ========================================================================
        // Content Type Handlers
        // ========================================================================

        /**
         * Handle file clipboard items
         *
         * @param {Object} fileResult - Extracted file content
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
         * Handle URL/link clipboard items and fetch metadata
         *
         * @param {Object} linkResult - Extracted link content
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

            this._linkProcessor.fetchMetadata(newItem.url).then(async (metadata) => {
                let updated = false;
                const item = this._history.find((i) => i.id === newItem.id);
                if (!item) return;

                if (metadata.title) {
                    item.title = metadata.title;
                    updated = true;
                }
                if (metadata.iconUrl) {
                    const filename = await this._linkProcessor.downloadFavicon(metadata.iconUrl, this._linkPreviewsDir, newItem.id);
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
         * Handle contact clipboard items
         *
         * @param {Object} contactResult - Extracted contact content
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

            // For emails, try to fetch the provider's icon
            if (newItem.subtype === 'email') {
                const parts = newItem.text.split('@');
                if (parts.length === 2) {
                    const domain = parts[1];
                    const url = `https://${domain}`;

                    this._linkProcessor
                        .fetchMetadata(url)
                        .then(async (metadata) => {
                            if (metadata.iconUrl) {
                                const filename = await this._linkProcessor.downloadFavicon(metadata.iconUrl, this._linkPreviewsDir, newItem.id);
                                if (filename) {
                                    newItem.icon_filename = filename;
                                    this._saveHistory();
                                    this.emit('history-changed');
                                }
                            }
                        })
                        .catch(() => {
                            // Ignore errors for icon fetching
                        });
                }
            }
        }

        /**
         * Handle color clipboard items
         *
         * @param {Object} colorResult - Extracted color content
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
         * Handle code clipboard items
         *
         * @param {Object} codeResult - Extracted code content
         * @private
         */
        _handleCodeItem(codeResult) {
            this._handleExtractedContent(codeResult, TextProcessor, this._textsDir, true);
        }

        /**
         * Handle extracted content using processor class
         *
         * @param {Object} extraction - Extracted content
         * @param {Object} ProcessorClass - Processor class with save method
         * @param {string} storageDir - Directory to store content
         * @param {boolean} forceFileSave - If true, always save to file
         * @private
         */
        async _handleExtractedContent(extraction, ProcessorClass, storageDir, forceFileSave = false) {
            const hash = extraction.hash;

            const historyIndex = this._history.findIndex((item) => item.hash === hash);
            if (historyIndex > -1) {
                this._promoteExistingItem(historyIndex, this._history);
                return;
            }

            const pinnedIndex = this._pinned.findIndex((item) => item.hash === hash);
            if (pinnedIndex > -1) {
                this._promotePinnedItem(pinnedIndex);
                return;
            }

            const newItem = await ProcessorClass.save(extraction, storageDir, forceFileSave);
            if (newItem) {
                this._history.unshift(newItem);
                this._pruneHistory();
                this._saveHistory();
                this.emit('history-changed');
            }
        }

        /**
         * Add an item to history from an external source
         * @param {Object} item - The item to add
         */
        addExternalItem(item) {
            this._addItemToHistory(item);
        }

        /**
         * Find an existing item by its source URL
         * @param {string} url - The source URL to search for
         * @returns {Object|null} The found item or null
         */
        getItemBySourceUrl(url) {
            if (!url) return null;
            return this._history.find((item) => item.source_url === url) || this._pinned.find((item) => item.source_url === url);
        }

        // ========================================================================
        // History Management
        // ========================================================================

        /**
         * Add a new item to clipboard history
         *
         * @param {Object} newItem - Item to add to history
         * @private
         */
        _addItemToHistory(newItem) {
            const hash = newItem.hash;

            const historyIndex = this._history.findIndex((item) => item.hash === hash);
            if (historyIndex > -1) {
                this._promoteExistingItem(historyIndex, this._history);
                return;
            }

            const pinnedIndex = this._pinned.findIndex((item) => item.hash === hash);
            if (pinnedIndex > -1) {
                this._promotePinnedItem(pinnedIndex);
                return;
            }

            this._history.unshift(newItem);
            this._pruneHistory();
            this._saveHistory();
            this.emit('history-changed');
        }

        /**
         * Promote an existing item to the top of a list
         *
         * @param {number} index - Index of item to promote
         * @param {Array} list - List containing the item
         * @private
         */
        _promoteExistingItem(index, list) {
            const [item] = list.splice(index, 1);
            list.unshift(item);
            if (list === this._history) this._saveHistory();
            this.emit('history-changed');
        }

        /**
         * Promote a pinned item, optionally unpinning it based on settings
         *
         * @param {number} index - Index of pinned item to promote
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
        // Persistence
        // ========================================================================

        /**
         * Load clipboard history and pinned items from disk
         *
         * @returns {Promise<boolean>} True if load was successful
         */
        async loadData() {
            this._history = ServiceJson.parse(await IOFile.read(this._historyFilePath)) || [];
            this._pinned = ServiceJson.parse(await IOFile.read(this._pinnedFilePath)) || [];

            this.emit('history-changed');
            this.emit('pinned-list-changed');
            return true;
        }

        /**
         * Save clipboard history to disk
         * @private
         */
        _saveHistory() {
            if (!this._initialLoadSuccess) return;
            IOFile.write(this._historyFilePath, ServiceJson.stringify(this._history));
        }

        /**
         * Save pinned items to disk
         * @private
         */
        _savePinned() {
            if (!this._initialLoadSuccess) return;
            IOFile.write(this._pinnedFilePath, ServiceJson.stringify(this._pinned));
        }

        /**
         * Save both history and pinned items to disk
         * @private
         */
        _saveAll() {
            this._saveHistory();
            this._savePinned();
        }

        /**
         * Remove oldest items from history when exceeding max limit
         * @private
         */
        _pruneHistory() {
            if (!this._initialLoadSuccess || this._history.length <= this._maxHistory) return;

            // Identify items to remove
            const itemsToRemove = [];
            while (this._history.length > this._maxHistory) {
                itemsToRemove.push(this._history.pop());
            }

            // Process deletions in idle time to avoid flooding IO/locking UI
            const batchSize = 5;
            const processBatch = () => {
                if (itemsToRemove.length === 0) return GLib.SOURCE_REMOVE;

                const batch = itemsToRemove.splice(0, batchSize);
                for (const item of batch) {
                    if (item.icon_filename) this._deletePreviewFile(item.icon_filename);
                    if (item.gradient_filename) this._deleteImageFile(item.gradient_filename);
                    if (item.type === ClipboardType.IMAGE) this._deleteImageFile(item.image_filename);
                    if ((item.type === ClipboardType.TEXT || item.type === ClipboardType.CODE) && item.has_full_content) this._deleteTextFile(item.id);
                }

                return itemsToRemove.length > 0 ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
            };

            GLib.idle_add(GLib.PRIORITY_LOW, processBatch);
        }

        // ========================================================================
        // Public API
        // ========================================================================

        /**
         * Get clipboard history items
         *
         * @returns {Array} Array of clipboard history items
         */
        getHistoryItems() {
            return this._history;
        }

        /**
         * Get pinned clipboard items
         *
         * @returns {Array} Array of pinned clipboard items
         */
        getPinnedItems() {
            return this._pinned;
        }

        /**
         * Get full content for a text or code item
         *
         * @param {string} id - Item ID
         * @returns {Promise<string|null>} Full content or null if not found
         */
        async getContent(id) {
            const item = [...this._history, ...this._pinned].find((i) => i.id === id);

            // Support both TEXT and CODE types since CODE items are stored like TEXT items
            if (!item || (item.type !== ClipboardType.TEXT && item.type !== ClipboardType.CODE)) {
                return null;
            }

            // For long content saved to file
            if (item.has_full_content) {
                try {
                    const fullPath = GLib.build_filenamev([this._textsDir, `${item.id}.txt`]);
                    const bytes = await IOFile.read(fullPath);
                    return bytes ? ServiceText.fromBytes(bytes) : null;
                } catch {
                    return null;
                }
            }

            // For short content, return the text field if available
            return item.text || null;
        }

        /**
         * Pin an item from history to the pinned list
         *
         * @param {string} id - Item ID to pin
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
         * Unpin an item and move it back to history
         *
         * @param {string} id - Item ID to unpin
         */
        unpinItem(id) {
            const index = this._pinned.findIndex((item) => item.id === id);
            if (index === -1) return;
            const [item] = this._pinned.splice(index, 1);
            this._history.unshift(item);
            this._pruneHistory();
            this._saveAll();
            this.emit('history-changed');
            this.emit('pinned-list-changed');
        }

        /**
         * Promote an item to the top of its list, either history or pinned
         *
         * @param {string} id - Item ID to promote
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
         * Delete an item from history or pinned list
         *
         * @param {string} id - Item ID to delete
         */
        deleteItem(id) {
            let wasDeleted = false;
            const deleteLogic = (list) => {
                const index = list.findIndex((item) => item.id === id);
                if (index > -1) {
                    const [item] = list.splice(index, 1);

                    // If you delete the most recently copied item, clear the memory
                    if (item.hash === this._lastContent) {
                        this._lastContent = null;
                    }

                    if (item.icon_filename) this._deletePreviewFile(item.icon_filename);
                    if (item.gradient_filename) this._deleteImageFile(item.gradient_filename);
                    if (item.type === ClipboardType.IMAGE) this._deleteImageFile(item.image_filename);
                    if ((item.type === ClipboardType.TEXT || item.type === ClipboardType.CODE) && item.has_full_content) this._deleteTextFile(item.id);
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
         * Clear all clipboard history
         */
        clearHistory() {
            if (!this._initialLoadSuccess) return;
            this._history.forEach((item) => {
                if (item.icon_filename) this._deletePreviewFile(item.icon_filename);
                if (item.gradient_filename) this._deleteImageFile(item.gradient_filename);
                if (item.type === ClipboardType.IMAGE) this._deleteImageFile(item.image_filename);
                if (item.type === ClipboardType.TEXT && item.has_full_content) this._deleteTextFile(item.id);
            });
            this._history = [];
            this._saveHistory();
            this.emit('history-changed');
        }

        /**
         * Clear all pinned items
         */
        clearPinned() {
            if (!this._initialLoadSuccess) return;
            this._pinned.forEach((item) => {
                if (item.icon_filename) this._deletePreviewFile(item.icon_filename);
                if (item.gradient_filename) this._deleteImageFile(item.gradient_filename);
                if (item.type === ClipboardType.IMAGE) this._deleteImageFile(item.image_filename);
                if (item.type === ClipboardType.TEXT && item.has_full_content) this._deleteTextFile(item.id);
            });
            this._pinned = [];
            this._savePinned();
            this.emit('pinned-list-changed');
        }

        /**
         * Helper to delete a file from disk
         *
         * @param {string} dirPath - Directory path where the file is located
         * @param {string} filename - Filename to delete
         * @private
         */
        _deleteFile(dirPath, filename) {
            if (!filename) return;
            const fullPath = GLib.build_filenamev([dirPath, filename]);
            IOFile.delete(fullPath).catch(() => {});
        }

        /**
         * Delete an image file from disk
         *
         * @param {string} filename - Image filename to delete
         * @private
         */
        _deleteImageFile(filename) {
            if (!filename) return;
            this._deleteFile(this._imagesDir, filename);
        }

        /**
         * Delete a text/code file from disk
         *
         * @param {string} id - Item ID whose text file should be deleted
         * @private
         */
        _deleteTextFile(id) {
            if (!id) return;
            this._deleteFile(this._textsDir, `${id}.txt`);
        }

        /**
         * Delete a preview file from disk
         *
         * @param {string} filename - Preview filename to delete
         * @private
         */
        _deletePreviewFile(filename) {
            if (!filename) return;
            this._deleteFile(this._linkPreviewsDir, filename);
        }

        /**
         * Verify and heal image items
         * @param {Object} item - Clipboard item
         * @returns {Promise<boolean>} True if healed
         * @private
         */
        async _verifyAndHealImage(item) {
            if (item.type !== ClipboardType.IMAGE || !item.image_filename) return false;

            const missingFile = !this._checkFileExists(this._imagesDir, item.image_filename);
            if (!missingFile) return false;

            // Try healing from local file first
            if (item.file_uri) {
                const cacheUri = `file://${GLib.build_filenamev([this._imagesDir, item.image_filename])}`;
                if (item.file_uri !== cacheUri) {
                    return ImageProcessor.regenerateThumbnail(item, this._imagesDir);
                }
            }
            // If still missing and has source URL, try downloading
            if (item.source_url) {
                return ImageProcessor.regenerateFromUrl(item, this._imagesDir);
            }
            return false;
        }

        /**
         * Verify and heal URL items
         * @param {Object} item - Clipboard item
         * @returns {Promise<boolean>} True if healed
         * @private
         */
        async _verifyAndHealUrl(item) {
            if (item.type !== ClipboardType.URL || !item.icon_filename) return false;

            const missingFile = !this._checkFileExists(this._linkPreviewsDir, item.icon_filename);
            if (missingFile) {
                return this._healIconFile(item, this._linkPreviewsDir);
            }
            return false;
        }

        /**
         * Verify and heal Contact items
         * @param {Object} item - Clipboard item
         * @returns {Promise<boolean>} True if healed
         * @private
         */
        async _verifyAndHealContact(item) {
            if (item.type !== ClipboardType.CONTACT || item.subtype !== 'email' || !item.icon_filename) return false;

            const missingFile = !this._checkFileExists(this._linkPreviewsDir, item.icon_filename);
            if (missingFile) {
                return this._healIconFile(item, this._linkPreviewsDir);
            }
            return false;
        }

        /**
         * Verify verification for Text/Code items (check for data loss)
         * @param {Object} item - Clipboard item
         * @returns {boolean} True if missing file detected (corruption)
         * @private
         */
        _verifyTextIntegrity(item) {
            if ((item.type !== ClipboardType.TEXT && item.type !== ClipboardType.CODE) || !item.has_full_content) return false;
            return !this._checkFileExists(this._textsDir, `${item.id}.txt`);
        }

        /**
         * Verify integrity of clipboard items and attempt self-healing
         * @private
         */
        async _verifyAndHealData() {
            let changed = false;

            const processItem = async (item) => {
                let healed = false;
                let isCorrupted = false;

                switch (item.type) {
                    case ClipboardType.IMAGE:
                        healed = await this._verifyAndHealImage(item);
                        // If we tried to heal but failed, check if the file is still missing to set corruption state
                        if (!healed && item.image_filename) {
                            isCorrupted = !this._checkFileExists(this._imagesDir, item.image_filename);
                        }
                        break;
                    case ClipboardType.URL:
                        healed = await this._verifyAndHealUrl(item);
                        // URLs aren't "corrupted" if icon missing, just missing decoration
                        break;
                    case ClipboardType.CONTACT:
                        healed = await this._verifyAndHealContact(item);
                        break;
                    case ClipboardType.COLOR:
                        healed = this._verifyAndHealColor(item);
                        if (!healed && item.gradient_filename) {
                            isCorrupted = !this._checkFileExists(this._imagesDir, item.gradient_filename);
                        }
                        break;
                    case ClipboardType.CODE:
                    case ClipboardType.TEXT:
                        if (this._verifyTextIntegrity(item)) {
                            isCorrupted = true;
                        }
                        break;
                }

                if (healed) return true;

                // Update corrupted state
                const wasCorrupted = item.is_corrupted || false;
                if (isCorrupted !== wasCorrupted) {
                    item.is_corrupted = isCorrupted;
                    return true;
                }

                return false;
            };

            // Process both lists concurrently
            const allItems = [...this._history, ...this._pinned];

            // We process in chunks to avoid overwhelming the loop
            const CHUNK_SIZE = 5;
            for (let i = 0; i < allItems.length; i += CHUNK_SIZE) {
                const chunk = allItems.slice(i, i + CHUNK_SIZE);
                // eslint-disable-next-line no-await-in-loop
                const results = await Promise.all(chunk.map(processItem));
                if (results.some((r) => r)) changed = true;
            }

            if (changed) {
                this._saveAll();
                this.emit('history-changed');
                this.emit('pinned-list-changed');
            }
        }

        /**
         * Check if a file exists in the given directory
         * @private
         */
        _checkFileExists(dirPath, filename) {
            if (!filename) return true;
            return IOFile.existsSync(GLib.build_filenamev([dirPath, filename]));
        }

        /**
         * Attempt to heal a missing icon file for URL or Contact items
         * @param {Object} item - The item to heal
         * @param {string} directory - The directory to save the icon to
         * @returns {Promise<boolean>} True if healed by updating or clearing filename
         * @private
         */
        async _healIconFile(item, directory) {
            const newFilename = await this._linkProcessor.regenerateIcon(item, directory);
            if (newFilename) {
                item.icon_filename = newFilename;
                return true;
            }
            // Clear the stale reference if can't recover
            item.icon_filename = null;
            return true; // Not a corruption, just cleared stale reference
        }

        /**
         * Run garbage collection to remove orphaned files
         */
        async runGarbageCollection() {
            try {
                const validImages = new Set();
                const validTexts = new Set();
                const validLinks = new Set();

                const collect = (list) => {
                    list.forEach((item) => {
                        if (item.type === ClipboardType.IMAGE) validImages.add(item.image_filename);
                        if ((item.type === ClipboardType.TEXT || item.type === ClipboardType.CODE) && item.has_full_content) {
                            validTexts.add(`${item.id}.txt`);
                        }
                        if (item.type === ClipboardType.URL && item.icon_filename) validLinks.add(item.icon_filename);
                        if (item.type === ClipboardType.CONTACT && item.icon_filename) validLinks.add(item.icon_filename);
                        if (item.type === ClipboardType.COLOR && item.gradient_filename) validImages.add(item.gradient_filename);
                    });
                };
                collect(this._pinned);
                collect(this._history);

                const cleanDir = async (dirPath, validSet) => {
                    const files = await IOFile.list(dirPath);
                    if (!files) return;

                    const deletePromises = [];
                    for (const file of files) {
                        if (!validSet.has(file.name)) {
                            deletePromises.push(IOFile.delete(file.path));
                        }
                    }
                    await Promise.all(deletePromises);
                };

                await Promise.all([cleanDir(this._imagesDir, validImages), cleanDir(this._textsDir, validTexts), cleanDir(this._linkPreviewsDir, validLinks)]);
            } catch (e) {
                console.error(`[AIO-Clipboard] GC Error: ${e.message}`);
            }
        }

        /**
         * Pause or resume clipboard monitoring
         *
         * @param {boolean} isPaused - True to pause, false to resume
         */
        setPaused(isPaused) {
            this._isPaused = isPaused;
        }

        /**
         * Cleanup resources
         */
        destroy() {
            if (this._processClipboardTimeoutId) {
                GLib.source_remove(this._processClipboardTimeoutId);
                this._processClipboardTimeoutId = 0;
            }

            if (this._selectionOwnerChangedId) {
                this._selection.disconnect(this._selectionOwnerChangedId);
                this._selectionOwnerChangedId = 0;
            }

            if (this._settingsChangedId) {
                this._settings.disconnect(this._settingsChangedId);
                this._settingsChangedId = 0;
            }

            if (this._linkProcessor) {
                this._linkProcessor.destroy();
                this._linkProcessor = null;
            }
        }
    },
);
