import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { GlobalActionService } from '../../../shared/services/serviceAction.js';
import { Logger } from '../../../shared/utilities/utilityLogger.js';
import { clipboardSetText, clipboardSetContent } from '../../../shared/utilities/utilityClipboard.js';
import { IOImage, IOText } from '../../../shared/utilities/utilityIO.js';

import { ClipboardType } from '../constants/clipboardConstants.js';

// Configuration
const SEQUENTIAL_PASTE_DELAY_MS = 100;

/**
 * ClipboardCopyService
 *
 * Handles copying clipboard items back to the system clipboard.
 * Supports all content types.
 */
export class ClipboardCopyService {
    // ========================================================================
    // Initialization
    // ========================================================================

    /**
     * Initialize the clipboard copy service.
     */
    constructor() {
        this._delayResolvers = new Map();
    }

    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Copy an item's content to the system clipboard.
     *
     * @param {Object} itemData Data of the item to copy.
     * @param {ClipboardStorage} storage Storage instance for reading raw files.
     * @param {ClipboardManager} manager Manager instance for content retrieval.
     * @returns {Promise<boolean>} True if successful.
     */
    static async copy(itemData, storage, manager) {
        try {
            switch (itemData.type) {
                case ClipboardType.IMAGE:
                    return await ClipboardCopyService._copyImage(itemData, storage, manager);
                case ClipboardType.FILE:
                    return ClipboardCopyService._copyFile(itemData, manager);
                case ClipboardType.URL:
                case ClipboardType.COLOR:
                    ClipboardCopyService._registerGuardText(manager, itemData.url || itemData.color_value);
                    clipboardSetText(itemData.url || itemData.color_value);
                    return true;
                case ClipboardType.CONTACT:
                case ClipboardType.CODE:
                case ClipboardType.TEXT:
                    return await ClipboardCopyService._copyText(itemData, manager);
                default:
                    return false;
            }
        } catch (e) {
            Logger.error(`Copy failed: ${e.message}`);
            return false;
        }
    }

    /**
     * Merge multiple selected items based on user settings.
     *
     * @param {Array<string>} selectedIds List of selected item IDs.
     * @param {ClipboardManager} manager Clipboard manager.
     * @param {Object} options Options containing settings and menu.
     * @returns {Promise<boolean>} True if successful.
     */
    async mergeMultiple(selectedIds, manager, options) {
        try {
            const selectedItems = ClipboardCopyService._resolveSelectedItems(selectedIds, manager, options);
            if (selectedItems.length === 0) {
                return false;
            }

            const filesAndImages = selectedItems.filter((i) => i.type === ClipboardType.IMAGE || i.type === ClipboardType.FILE);
            const textItems = selectedItems.filter((i) => i.type !== ClipboardType.IMAGE && i.type !== ClipboardType.FILE);

            const autoPasteEnabled = options.settings.get_boolean('enable-auto-paste') && options.settings.get_boolean('auto-paste-clipboard');
            const delimiter = ClipboardCopyService._resolveDelimiter(options);

            const textContents = new Map();
            await Promise.all(
                textItems.map(async (item) => {
                    let content = item.text || (await manager.getContent(item.id));
                    if (!content && item.preview && item.type !== ClipboardType.CODE) {
                        content = item.preview;
                    }
                    if (content) {
                        textContents.set(item.id, content);
                    }
                }),
            );

            if (autoPasteEnabled) {
                const queue = [];
                let currentTextGroup = [];
                let pendingGroupNeedsTrailingDelimiter = false;

                const flushTextGroup = () => {
                    if (currentTextGroup.length === 0) return;

                    let textBlock = ClipboardCopyService._compileTexts(currentTextGroup, textContents, delimiter);
                    currentTextGroup = [];

                    if (!textBlock) return;
                    if (pendingGroupNeedsTrailingDelimiter) {
                        textBlock += delimiter;
                    }
                    pendingGroupNeedsTrailingDelimiter = false;

                    queue.push(async () => {
                        ClipboardCopyService._registerGuardText(manager, textBlock);
                        clipboardSetText(textBlock);
                        return true;
                    });
                };

                for (const item of selectedItems) {
                    if (item.type === ClipboardType.IMAGE || item.type === ClipboardType.FILE) {
                        if (currentTextGroup.length > 0) {
                            pendingGroupNeedsTrailingDelimiter = true;
                            flushTextGroup();
                        }

                        queue.push(async () => {
                            return await ClipboardCopyService.copy(item, manager.storage, manager);
                        });
                    } else {
                        currentTextGroup.push(item);
                    }
                }

                flushTextGroup();

                const queueCompleted = await this._runPasteQueue(queue, options);
                if (!queueCompleted) {
                    return false;
                }
            } else {
                const copySuccess = await GlobalActionService.executeCopyAction({
                    onCopy: async () => {
                        ClipboardCopyService._copyMultipleCopyOnly(selectedItems, textItems, filesAndImages, textContents, delimiter, manager);
                        return true;
                    },
                    settings: options.settings,
                    autoPasteKey: 'auto-paste-clipboard',
                    menu: options.menu,
                });

                if (!copySuccess) {
                    return false;
                }
            }

            return true;
        } catch (e) {
            Logger.error(`[AIO-Clipboard] mergeMultiple failed: ${e.message}\nStack: ${e.stack}`);
            return false;
        }
    }
    // ========================================================================
    // Internal Helpers
    // ========================================================================

    /**
     * Copy an image item to the clipboard.
     *
     * @param {Object} itemData Image item data.
     * @param {ClipboardStorage} storage Storage instance.
     * @returns {Promise<boolean>} True if successful.
     * @private
     */
    static async _copyImage(itemData, storage, manager) {
        if (itemData.file_uri) {
            const uriText = itemData.file_uri + '\r\n';
            const uriBytes = IOText.stringifyBytes(uriText);
            if (!uriBytes) return false;
            ClipboardCopyService._registerGuardText(manager, uriText);
            clipboardSetContent('text/uri-list', new GLib.Bytes(uriBytes));
            return true;
        }

        const imagePath = GLib.build_filenamev([storage.imagesDir, itemData.image_filename]);
        const bytes = IOImage.parseBytes(await storage.readRaw(imagePath));

        if (!bytes) return false;
        ClipboardCopyService._registerGuardHash(manager, itemData.hash);
        clipboardSetContent(IOImage.getMimeType(itemData.image_filename), bytes);
        return true;
    }

    /**
     * Copy a file URI to the clipboard.
     *
     * @param {Object} itemData File item data.
     * @returns {boolean} True if successful.
     * @private
     */
    static _copyFile(itemData, manager) {
        const uriText = itemData.file_uri + '\r\n';
        const uriBytes = IOText.stringifyBytes(uriText);
        if (!uriBytes) return false;
        ClipboardCopyService._registerGuardText(manager, uriText);
        clipboardSetContent('text/uri-list', new GLib.Bytes(uriBytes));
        return true;
    }

    /**
     * Copy text content to the clipboard.
     *
     * @param {Object} itemData Text, code, or contact item data.
     * @param {ClipboardManager} manager Manager for content retrieval.
     * @returns {Promise<boolean>} True if successful.
     * @private
     */
    static async _copyText(itemData, manager) {
        let content = itemData.text || (await manager.getContent(itemData.id));

        if (!content && itemData.preview && itemData.type !== ClipboardType.CODE) {
            content = itemData.preview;
        }

        if (!content) return false;
        ClipboardCopyService._registerGuardText(manager, content);
        clipboardSetText(content);
        return true;
    }

    /**
     * Register a hash with the capture guard if available.
     *
     * @param {ClipboardManager} manager Manager instance.
     * @param {string} hash Hash to register.
     * @private
     */
    static _registerGuardHash(manager, hash) {
        manager?.captureGuard?.registerHash(hash);
    }

    /**
     * Register text with the capture guard if available.
     *
     * @param {ClipboardManager} manager Manager instance.
     * @param {string} text Text to hash and register.
     * @private
     */
    static _registerGuardText(manager, text) {
        manager?.captureGuard?.registerText(text);
    }

    /**
     * Copy mixed or single types to clipboard once (when Auto-Paste is disabled).
     *
     * @private
     */
    static _copyMultipleCopyOnly(selectedItems, textItems, filesAndImages, textContents, delimiter, manager) {
        const combinedList = [];
        for (const item of selectedItems) {
            const text = ClipboardCopyService._resolveItemAsText(item, textContents, manager);
            if (text) combinedList.push(text);
        }
        const combined = combinedList.join(delimiter);
        ClipboardCopyService._registerGuardText(manager, combined);
        clipboardSetText(combined);
    }

    /**
     * Run a queue of copy/paste actions sequentially with a delay.
     *
     * @param {Array<Function>} queue List of async/sync copy functions.
     * @param {Object} options Options containing settings and menu.
     * @private
     */
    async _runPasteQueue(queue, options) {
        if (queue.length === 0) return true;

        const runStep = async (index) => {
            if (index >= queue.length) {
                return true;
            }

            try {
                const copySuccess = await GlobalActionService.executeCopyAction({
                    onCopy: async () => {
                        const stepSuccess = await queue[index]();
                        return stepSuccess !== false;
                    },
                    settings: options.settings,
                    autoPasteKey: 'auto-paste-clipboard',
                    menu: options.menu,
                });

                if (!copySuccess) {
                    return false;
                }
            } catch (err) {
                Logger.error(`Sequential paste error at index ${index}: ${err.message}`);
                return false;
            }

            if (index + 1 < queue.length) {
                const delayCompleted = await this._delayMs(SEQUENTIAL_PASTE_DELAY_MS);
                if (!delayCompleted) {
                    return false;
                }
            }
            return runStep(index + 1);
        };

        return runStep(0);
    }

    /**
     * Wait for a short delay in the GLib main loop.
     *
     * @param {number} ms Delay in milliseconds.
     * @returns {Promise<boolean>} True if the delay completed, false if cancelled.
     * @private
     */
    _delayMs(ms) {
        return new Promise((resolve) => {
            const sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
                this._delayResolvers.delete(sourceId);
                resolve(true);
                return GLib.SOURCE_REMOVE;
            });

            this._delayResolvers.set(sourceId, resolve);
        });
    }

    /**
     * Resolve and sort selected items.
     *
     * @private
     */
    static _resolveSelectedItems(selectedIds, manager, options) {
        const allItems = [...manager.getHistoryItems(), ...manager.getPinnedItems()];
        const selectedItems = selectedIds.map((id) => allItems.find((item) => item.id === id)).filter(Boolean);

        const orderMode = options.settings.get_string('clipboard-merge-selection-order') || 'selection';
        if (orderMode === 'selection') {
            selectedItems.sort((a, b) => selectedIds.indexOf(a.id) - selectedIds.indexOf(b.id));
        } else {
            selectedItems.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        }
        return selectedItems;
    }

    /**
     * Resolve the text representation of any item (e.g. URI for images/files, text for other types).
     *
     * @param {Object} item Clipboard item data.
     * @param {Map} textContents Pre-resolved text contents map.
     * @param {ClipboardManager} manager Manager instance.
     * @returns {string|null} The resolved text content or null.
     * @private
     */
    static _resolveItemAsText(item, textContents, manager) {
        if (item.type === ClipboardType.IMAGE || item.type === ClipboardType.FILE) {
            return ClipboardCopyService._getItemUri(item, manager);
        }
        return ClipboardCopyService._getItemText(item, textContents);
    }

    /**
     * Resolve text content for non-file items.
     *
     * @private
     */
    static _getItemText(item, textContents) {
        switch (item.type) {
            case ClipboardType.URL:
                return item.url;
            case ClipboardType.COLOR:
                return item.color_value;
            case ClipboardType.CONTACT:
                return item.text;
            case ClipboardType.TEXT:
            case ClipboardType.CODE:
                return textContents.get(item.id) || item.preview || item.text || '';
            default:
                return textContents.get(item.id) || item.text || '';
        }
    }

    /**
     * Resolve a file URI for an image or file item.
     *
     * @private
     */
    static _getItemUri(item, manager) {
        if (item?.file_uri) {
            return item.file_uri;
        }
        if (item?.type === ClipboardType.IMAGE && item?.image_filename) {
            try {
                const imagesDir = manager ? manager.imagesDir || manager.storage?.imagesDir : null;
                if (!imagesDir) {
                    throw new Error('Images directory path is not available on manager.');
                }
                const imagePath = GLib.build_filenamev([imagesDir, item.image_filename]);
                const fileUri = Gio.File.new_for_path(imagePath).get_uri();
                return fileUri;
            } catch (err) {
                Logger.error(`[AIO-Clipboard] _getItemUri: error resolving image URI: ${err.message}\nStack: ${err.stack}`);
                return null;
            }
        }
        return null;
    }

    /**
     * Resolve the string delimiter to use.
     *
     * @private
     */
    static _resolveDelimiter(options) {
        const delimiterType = options.settings.get_string('clipboard-merge-selection-delimiter-type') || 'newline';
        switch (delimiterType) {
            case 'double-newline':
                return '\n\n';
            case 'space':
                return ' ';
            case 'comma':
                return ', ';
            case 'tab':
                return '\t';
            case 'custom':
                return options.settings.get_string('clipboard-merge-selection-delimiter-custom') || '';
            case 'newline':
            default:
                return '\n';
        }
    }

    /**
     * Resolve and concatenate text content for selected text items.
     *
     * @private
     */
    static _compileTexts(textItems, textContents, delimiter) {
        if (textItems.length === 0) return '';
        const resolvedTexts = textItems.map((item) => ClipboardCopyService._getItemText(item, textContents)).filter(Boolean);
        return resolvedTexts.join(delimiter);
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    /**
     * Cancel pending sequential paste delays.
     */
    cancelPendingDelays() {
        this._delayResolvers.forEach((resolve, sourceId) => {
            GLib.source_remove(sourceId);
            resolve(false);
        });
        this._delayResolvers.clear();
    }

    /**
     * Cancel pending service work before shutdown.
     */
    destroy() {
        this.cancelPendingDelays();
    }
}
