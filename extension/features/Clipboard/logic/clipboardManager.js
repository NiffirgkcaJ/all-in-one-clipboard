import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { ClipboardType } from '../constants/clipboardConstants.js';
import { CodeProcessor } from '../processors/clipboardCodeProcessor.js';
import { ColorProcessor } from '../processors/clipboardColorProcessor.js';
import { ContactProcessor } from '../processors/clipboardContactProcessor.js';
import { FileProcessor } from '../processors/clipboardFileProcessor.js';
import { ImageProcessor } from '../processors/clipboardImageProcessor.js';
import { LinkProcessor } from '../processors/clipboardLinkProcessor.js';
import { TextProcessor } from '../processors/clipboardTextProcessor.js';
import { Storage } from '../../../shared/constants/storagePaths.js';

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

            this._linkPreviewsDir = Storage.getLinkPreviewsDir(this._uuid);
            this._imagesDir = Storage.getImagesDir(this._uuid);
            this._textsDir = Storage.getTextsDir(this._uuid);

            this.imagesDir = this._imagesDir;

            this._historyFile = Gio.File.new_for_path(Storage.getClipboardHistoryPath(this._uuid));
            this._pinnedFile = Gio.File.new_for_path(Storage.getPinnedClipboardPath(this._uuid));

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
            return this._initialLoadSuccess;
        }

        /**
         * Ensure all required directories exist
         * @private
         */
        _ensureDirectories() {
            [this._imagesDir, this._textsDir, this._linkPreviewsDir].forEach((path) => {
                const dir = Gio.File.new_for_path(path);
                if (!dir.query_exists(null)) {
                    dir.make_directory_with_parents(null);
                }
            });
        }

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
            // Reuse TextProcessor storage logic.
            this._handleExtractedContent(codeResult, TextProcessor, this._textsDir);
        }

        /**
         * Handle extracted content (text, code, images) using processor class
         *
         * @param {Object} extraction - Extracted content
         * @param {Object} ProcessorClass - Processor class with save method
         * @param {string} storageDir - Directory to store content
         * @private
         */
        _handleExtractedContent(extraction, ProcessorClass, storageDir) {
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

            const newItem = ProcessorClass.save(extraction, storageDir);
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
         * Promote a pinned item (optionally unpinning it based on settings)
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

        /**
         * Load clipboard history and pinned items from disk
         *
         * @returns {Promise<boolean>} True if load was successful
         */
        async loadData() {
            const loadFile = async (file) => {
                try {
                    const bytes = await new Promise((resolve, reject) => {
                        file.load_contents_async(null, (source, res) => {
                            try {
                                const [ok, contents] = source.load_contents_finish(res);
                                resolve(ok ? contents : null);
                            } catch (e) {
                                if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) {
                                    resolve(null);
                                } else {
                                    reject(e);
                                }
                            }
                        });
                    });
                    return bytes;
                } catch (e) {
                    console.warn(`[AIO-Clipboard] Could not load file ${file.get_path()}: ${e.message}`);
                    return null;
                }
            };

            try {
                const historyBytes = await loadFile(this._historyFile);
                this._history = historyBytes ? JSON.parse(new TextDecoder().decode(historyBytes)) : [];
            } catch (e) {
                console.error(`[AIO-Clipboard] Failed to parse history_clipboard.json: ${e.message}`);
                this._history = [];
            }

            try {
                const pinnedBytes = await loadFile(this._pinnedFile);
                this._pinned = pinnedBytes ? JSON.parse(new TextDecoder().decode(pinnedBytes)) : [];
            } catch (e) {
                console.error(`[AIO-Clipboard] Failed to parse pinned_clipboard.json: ${e.message}`);
                this._pinned = [];
            }

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
            const json = JSON.stringify(this._history, null, 2);
            const bytes = new GLib.Bytes(new TextEncoder().encode(json));
            this._saveFile(this._historyFile, bytes);
        }

        /**
         * Save pinned items to disk
         * @private
         */
        _savePinned() {
            if (!this._initialLoadSuccess) return;
            const json = JSON.stringify(this._pinned, null, 2);
            const bytes = new GLib.Bytes(new TextEncoder().encode(json));
            this._saveFile(this._pinnedFile, bytes);
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
         * Save a file asynchronously
         *
         * @param {Gio.File} file - File to save
         * @param {GLib.Bytes} bytes - Content to write
         * @private
         */
        _saveFile(file, bytes) {
            file.replace_async(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, GLib.PRIORITY_DEFAULT, null, (source, res) => {
                try {
                    const stream = source.replace_finish(res);
                    stream.write_bytes_async(bytes, GLib.PRIORITY_DEFAULT, null, (w_source, w_res) => {
                        try {
                            w_source.write_bytes_finish(w_res);
                            stream.close(null);
                        } catch (e) {
                            console.error(`[AIO-Clipboard] Error writing bytes: ${e.message}`);
                        }
                    });
                } catch (e) {
                    console.error(`[AIO-Clipboard] Error replacing file content: ${e.message}`);
                }
            });
        }

        /**
         * Remove oldest items from history when exceeding max limit
         * @private
         */
        _pruneHistory() {
            if (!this._initialLoadSuccess) return;
            while (this._history.length > this._maxHistory) {
                const item = this._history.pop();
                if (item.icon_filename) this._deletePreviewFile(item.icon_filename);
                if (item.gradient_filename) this._deleteImageFile(item.gradient_filename);
                if (item.type === ClipboardType.IMAGE) this._deleteImageFile(item.image_filename);
                if ((item.type === ClipboardType.TEXT || item.type === ClipboardType.CODE) && item.has_full_content) this._deleteTextFile(item.id);
            }
        }

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

            // Support both TEXT and CODE types (CODE items are stored like TEXT items)
            if (!item || (item.type !== ClipboardType.TEXT && item.type !== ClipboardType.CODE)) {
                return null;
            }

            // For long content saved to file
            if (item.has_full_content) {
                try {
                    const file = Gio.File.new_for_path(GLib.build_filenamev([this._textsDir, `${item.id}.txt`]));
                    const bytes = await new Promise((resolve, reject) => {
                        file.load_contents_async(null, (s, r) => {
                            try {
                                const [ok, c] = s.load_contents_finish(r);
                                resolve(ok ? c : null);
                            } catch (e) {
                                if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) resolve(null);
                                else reject(e);
                            }
                        });
                    });
                    return bytes ? new TextDecoder().decode(bytes) : null;
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
         * Promote an item to the top of its list (history or pinned)
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
         * Delete an image file from disk
         *
         * @param {string} filename - Image filename to delete
         * @private
         */
        _deleteImageFile(filename) {
            if (!filename) return;
            try {
                Gio.File.new_for_path(GLib.build_filenamev([this._imagesDir, filename])).delete_async(GLib.PRIORITY_DEFAULT, null);
            } catch {
                /* ignore */
            }
        }

        /**
         * Delete a text/code file from disk
         *
         * @param {string} id - Item ID whose text file should be deleted
         * @private
         */
        _deleteTextFile(id) {
            if (!id) return;
            try {
                Gio.File.new_for_path(GLib.build_filenamev([this._textsDir, `${id}.txt`])).delete_async(GLib.PRIORITY_DEFAULT, null);
            } catch {
                /* ignore */
            }
        }

        /**
         * Delete a preview file from disk
         *
         * @param {string} filename - Preview filename to delete
         * @private
         */
        _deletePreviewFile(filename) {
            if (!filename) return;
            try {
                Gio.File.new_for_path(GLib.build_filenamev([this._linkPreviewsDir, filename])).delete_async(GLib.PRIORITY_DEFAULT, null);
            } catch {
                /* ignore */
            }
        }

        /**
         * Run garbage collection to remove orphaned files
         */
        runGarbageCollection() {
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

                const cleanDir = (dirPath, validSet) => {
                    const dir = Gio.File.new_for_path(dirPath);
                    if (!dir.query_exists(null)) return;
                    const enumerator = dir.enumerate_children('standard::name', Gio.FileCreateFlags.NONE, null);
                    while (true) {
                        const info = enumerator.next_file(null);
                        if (!info) break;
                        const name = info.get_name();
                        if (!validSet.has(name)) dir.get_child(name).delete(null);
                    }
                };

                cleanDir(this._imagesDir, validImages);
                cleanDir(this._textsDir, validTexts);
                cleanDir(this._linkPreviewsDir, validLinks);
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
