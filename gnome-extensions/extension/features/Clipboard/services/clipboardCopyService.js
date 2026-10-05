import GLib from 'gi://GLib';

import { clipboardSetContent, clipboardSetText } from '../../../shared/utilities/utilityClipboard.js';
import { GlobalActionService } from '../../../shared/services/serviceAction.js';
import { IOText } from '../../../shared/utilities/utilityIO.js';
import { Logger } from '../../../shared/utilities/utilityLogger.js';

import { ImageProcessor } from '../processors/clipboardImageProcessor.js';

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
     * @param {Object} [options] Copy options.
     * @returns {Promise<boolean>} True if successful.
     */
    static async copy(itemData, storage, manager, options = {}) {
        try {
            return await manager._clipboardRegistry.copyItem(itemData, { storage, manager, ...options });
        } catch (e) {
            Logger.error(`Copy failed: ${e.message}`);
            return false;
        }
    }

    /**
     * Paste all embedded images from a rich text item in HTML document order.
     *
     * @param {Object} itemData Rich text item data.
     * @param {ClipboardStorage} storage Storage instance.
     * @param {ClipboardManager} manager Manager instance.
     * @param {Object} options Options containing settings and menu.
     * @returns {Promise<boolean>} True if images were successfully pasted or copied.
     */
    async pasteImagesFromItem(itemData, storage, manager, options = {}) {
        try {
            if (!itemData?.has_rich_content) return false;

            const htmlPath = GLib.build_filenamev([storage.textsDir, `${itemData.id}.html`]);
            const rawBytes = await storage.readRaw(htmlPath);
            if (!rawBytes) return false;

            const htmlString = IOText.parseBytes(rawBytes);
            if (!htmlString) return false;

            const imgMatches = [...htmlString.matchAll(/<img\b[^>]*?\bsrc=(?:["']([^"']+)["']|([^"'\s>]+))/gi)];
            if (imgMatches.length === 0) return false;

            const sources = imgMatches.map((m) => m[1] || m[2]).filter(Boolean);
            if (sources.length === 0) return false;

            const imageResults = await Promise.all(sources.map((src) => ImageProcessor.fetchImageFromSource(src)));
            const images = imageResults.filter(Boolean);

            if (images.length === 0) return false;

            const autoPasteEnabled = options.settings.get_boolean('enable-auto-paste') && options.settings.get_boolean('auto-paste-clipboard');

            if (autoPasteEnabled && images.length > 1) {
                const queue = images.map((img) => async () => {
                    manager.captureGuard.registerHash(img.hash);
                    clipboardSetContent(img.mimetype || 'image/png', new GLib.Bytes(img.data));
                    return true;
                });

                const completed = await this._runPasteQueue(queue, options);
                if (completed) {
                    manager.promoteItemToTop(itemData.id);
                }
                return completed;
            }

            return await GlobalActionService.executeCopyAction({
                onCopy: async () => {
                    const firstImage = images[0];
                    manager.captureGuard.registerHash(firstImage.hash);
                    clipboardSetContent(firstImage.mimetype || 'image/png', new GLib.Bytes(firstImage.data));
                    return true;
                },
                onPostCopy: () => manager.promoteItemToTop(itemData.id),
                settings: options.settings,
                autoPasteKey: 'auto-paste-clipboard',
                menu: options.menu,
            });
        } catch (e) {
            Logger.error(`pasteImagesFromItem failed: ${e.message}`);
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

            const registry = manager._clipboardRegistry;
            if (!registry) return false;

            const textItems = selectedItems.filter((i) => registry.getCopyMergeBehavior(i) === 'text');

            const autoPasteEnabled = options.settings.get_boolean('enable-auto-paste') && options.settings.get_boolean('auto-paste-clipboard');
            const delimiter = ClipboardCopyService._resolveDelimiter(options);

            const textContents = new Map();
            await Promise.all(
                textItems.map(async (item) => {
                    if (!item.text && !item.preview) {
                        const content = await manager.getContent(item.id);
                        if (content) textContents.set(item.id, content);
                    }
                }),
            );

            if (autoPasteEnabled) {
                const queue = [];
                let currentTextGroup = [];
                let pendingGroupNeedsTrailingDelimiter = false;

                const flushTextGroup = () => {
                    if (currentTextGroup.length === 0) return;

                    const groupToFlush = [...currentTextGroup];
                    currentTextGroup = [];
                    const needsTrailingDelimiter = pendingGroupNeedsTrailingDelimiter;
                    pendingGroupNeedsTrailingDelimiter = false;

                    queue.push(async () => {
                        let textBlock = await ClipboardCopyService._compileTexts(groupToFlush, textContents, delimiter, manager);
                        if (!textBlock) return true;
                        if (needsTrailingDelimiter) {
                            textBlock += delimiter;
                        }
                        manager.captureGuard.registerText(textBlock);
                        clipboardSetText(textBlock);
                        return true;
                    });
                };

                for (const item of selectedItems) {
                    if (registry.getCopyMergeBehavior(item) === 'file') {
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
                        await ClipboardCopyService._copyMultipleCopyOnly(selectedItems, textContents, delimiter, manager);
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
            Logger.error(`mergeMultiple failed: ${e.message}\nStack: ${e.stack}`);
            return false;
        }
    }
    // ========================================================================
    // Internal Helpers
    // ========================================================================

    /**
     * Copy mixed or single types to clipboard once (when Auto-Paste is disabled).
     *
     * @private
     */
    static async _copyMultipleCopyOnly(selectedItems, textContents, delimiter, manager) {
        const registry = manager._clipboardRegistry;
        if (!registry) return;

        const resolvedTexts = await Promise.all(
            selectedItems.map(async (item) => {
                if (registry.getCopyMergeBehavior(item) === 'file') {
                    return registry.getCopyMergeUri(item, { manager });
                }
                return await registry.getCopyMergeText(item, { manager, textContents });
            }),
        );

        const combinedList = resolvedTexts.filter(Boolean);
        const combined = combinedList.join(delimiter);
        manager.captureGuard.registerText(combined);
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
    static async _compileTexts(textItems, textContents, delimiter, manager) {
        if (textItems.length === 0) return '';
        const registry = manager._clipboardRegistry;
        const resolvedTexts = await Promise.all(textItems.map((item) => registry.getCopyMergeText(item, { manager, textContents })));
        return resolvedTexts.filter(Boolean).join(delimiter);
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
