import GLib from 'gi://GLib';

import { GlobalActionService } from '../../../shared/services/serviceAction.js';
import { IOText } from '../../../shared/utilities/utilityIO.js';
import { Logger } from '../../../shared/utilities/utilityLogger.js';
import { clipboardSetContent, clipboardSetText } from '../../../shared/utilities/utilityClipboard.js';

// Configuration
const SEQUENTIAL_PASTE_DELAY_MS = 100;

// Mapping
const DELIMITER_MAP = new Map([
    ['double-newline', '\n\n'],
    ['space', ' '],
    ['comma', ', '],
    ['tab', '\t'],
    ['newline', '\n'],
]);

/**
 * ClipboardCopyService
 *
 * Handles copying clipboard items back to the system clipboard.
 * Supports all content types without coupling to specific content processors.
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

    /**
     * Check whether auto-paste is enabled in settings.
     *
     * @param {Gio.Settings} settings Extension settings.
     * @returns {boolean} True when auto-paste is active.
     * @private
     */
    static _isAutoPasteEnabled(settings) {
        return Boolean(settings && settings.get_boolean('enable-auto-paste') && settings.get_boolean('auto-paste-clipboard'));
    }

    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Copy a single item and trigger the auto-paste lifecycle.
     *
     * @param {Object} item Clipboard item.
     * @param {ClipboardManager} manager Clipboard manager instance.
     * @param {Object} [options] Execution options.
     * @param {Gio.Settings} options.settings Extension settings.
     * @param {Object} [options.menu] Extension menu.
     * @returns {Promise<boolean>} True if successful.
     */
    async copySingleItem(item, manager, options = {}) {
        const autoPasteEnabled = ClipboardCopyService._isAutoPasteEnabled(options.settings);

        if (autoPasteEnabled) {
            const queue = await manager.getCopyQueue(item, options);
            if (queue && queue.length > 1) {
                const completed = await this._runPasteQueue(queue, options);
                if (completed) {
                    manager.promoteItemToTop(item.id);
                }
                return completed;
            }
        }

        const pasteShortcut = manager.getCopyPasteShortcut(item, options);

        return await GlobalActionService.executeCopyAction({
            onCopy: async () => await manager.copyToSystemClipboard(item, options),
            onPostCopy: () => manager.promoteItemToTop(item.id),
            settings: options.settings,
            autoPasteKey: 'auto-paste-clipboard',
            menu: options.menu,
            pasteShortcut,
        });
    }

    /**
     * Copy multiple selected items based on user settings.
     *
     * @param {Array<string>} selectedIds List of selected item IDs.
     * @param {ClipboardManager} manager Clipboard manager.
     * @param {Object} [options] Options containing settings and menu.
     * @returns {Promise<boolean>} True if successful.
     */
    async copyMultipleItems(selectedIds, manager, options = {}) {
        try {
            const selectedItems = ClipboardCopyService._resolveSelectedItems(selectedIds, manager, options);
            if (selectedItems.length === 0) {
                return false;
            }

            const textItems = selectedItems.filter((item) => manager.getCopyMergeBehavior(item) === 'text');
            const autoPasteEnabled = ClipboardCopyService._isAutoPasteEnabled(options.settings);
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

                    queue.push({
                        pasteShortcut: 'shift-insert',
                        execute: async () => {
                            let textBlock = await ClipboardCopyService._compileTexts(groupToFlush, textContents, delimiter, manager);
                            if (!textBlock) return true;
                            if (needsTrailingDelimiter) {
                                textBlock += delimiter;
                            }
                            manager.captureGuard.registerText(textBlock);
                            clipboardSetText(textBlock);
                            return true;
                        },
                    });
                };

                for (const item of selectedItems) {
                    if (manager.getCopyMergeBehavior(item) === 'file') {
                        if (currentTextGroup.length > 0) {
                            pendingGroupNeedsTrailingDelimiter = true;
                            flushTextGroup();
                        }

                        queue.push({
                            pasteShortcut: manager.getCopyPasteShortcut(item, options),
                            execute: async () => {
                                return await manager.copyToSystemClipboard(item, options);
                            },
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
                let mergedShortcut = 'shift-insert';
                if (selectedItems.every((item) => manager.getCopyPasteShortcut(item, options) === 'ctrl-v')) {
                    mergedShortcut = 'ctrl-v';
                }

                const copySuccess = await GlobalActionService.executeCopyAction({
                    onCopy: async () => {
                        await ClipboardCopyService._copyMultipleCopyOnly(selectedItems, textContents, delimiter, manager, options);
                        return true;
                    },
                    settings: options.settings,
                    autoPasteKey: 'auto-paste-clipboard',
                    menu: options.menu,
                    pasteShortcut: mergedShortcut,
                });

                if (!copySuccess) {
                    return false;
                }
            }

            return true;
        } catch (e) {
            Logger.error(`copyMultipleItems failed: ${e.message}\nStack: ${e.stack}`);
            return false;
        }
    }

    // ========================================================================
    // Internal Helpers
    // ========================================================================

    /**
     * Copy mixed or single types to clipboard once when auto-paste is disabled.
     *
     * @param {Array<Object>} selectedItems Selected clipboard items.
     * @param {Map<string, string>} textContents Map of text contents.
     * @param {string} delimiter Delimiter string.
     * @param {ClipboardManager} manager Clipboard manager.
     * @param {Object} [options] Execution options.
     * @param {Gio.Settings} [options.settings] Extension settings.
     * @private
     */
    static async _copyMultipleCopyOnly(selectedItems, textContents, delimiter, manager, options = {}) {
        const allFiles = selectedItems.length > 0 && selectedItems.every((item) => manager.getCopyMergeBehavior(item) === 'file');
        const targetFormat = options.settings ? options.settings.get_string('clipboard-resource-default-format') || 'resource' : 'resource';

        // Native Resource Payload
        if (allFiles && targetFormat !== 'uri') {
            const allUriLines = [];
            for (const item of selectedItems) {
                if (item.is_corrupted) continue;
                const rawUri = manager.getCopyMergeUri(item);
                if (!rawUri) continue;
                const lines = rawUri
                    .split(/[\r\n]+/)
                    .map((line) => line.trim())
                    .filter((line) => line.length > 0);
                allUriLines.push(...lines);
            }

            if (allUriLines.length > 0) {
                const uriListPayload = `${allUriLines.join('\r\n')}\r\n`;
                const payloadBytes = IOText.stringifyBytes(uriListPayload);
                if (payloadBytes) {
                    for (const item of selectedItems) {
                        if (item.file_uri) manager.captureGuard.registerText(item.file_uri);
                        if (item.hash) manager.captureGuard.registerHash(item.hash);
                    }
                    manager.captureGuard.registerText(allUriLines.join('\n'));
                    manager.captureGuard.registerText(uriListPayload);

                    clipboardSetContent('text/uri-list', new GLib.Bytes(payloadBytes));
                    return;
                }
            }
        }

        // Text Content Fallback
        const resolvedTexts = await Promise.all(
            selectedItems.map(async (item) => {
                if (manager.getCopyMergeBehavior(item) === 'file') {
                    return manager.getCopyMergeUri(item);
                }
                return await manager.getCopyMergeText(item, { textContents });
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
     * @param {Array<{execute: Function, pasteShortcut: string}>} queue List of copy step operations.
     * @param {Object} [options] Options containing settings and menu.
     * @returns {Promise<boolean>} True if all steps completed.
     * @private
     */
    async _runPasteQueue(queue, options = {}) {
        if (queue.length === 0) return true;

        const runStep = async (index) => {
            if (index >= queue.length) {
                return true;
            }

            try {
                const step = queue[index];

                const copySuccess = await GlobalActionService.executeCopyAction({
                    onCopy: async () => {
                        const stepSuccess = await step.execute();
                        return stepSuccess !== false;
                    },
                    settings: options.settings,
                    autoPasteKey: 'auto-paste-clipboard',
                    menu: options.menu,
                    pasteShortcut: step.pasteShortcut || options.pasteShortcut,
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
     * @param {Array<string>} selectedIds Selected item IDs.
     * @param {ClipboardManager} manager Clipboard manager.
     * @param {Object} [options] Options containing settings.
     * @returns {Array<Object>} Sorted selected items.
     * @private
     */
    static _resolveSelectedItems(selectedIds, manager, options = {}) {
        const allItems = [...manager.getHistoryItems(), ...manager.getPinnedItems()];
        const selectedItems = selectedIds.map((id) => allItems.find((item) => item.id === id)).filter(Boolean);

        const settings = options.settings;
        const orderMode = settings ? settings.get_string('clipboard-merge-selection-order') || 'selection' : 'selection';
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
     * @param {Object} [options] Options containing settings.
     * @returns {string} Resolved delimiter string.
     * @private
     */
    static _resolveDelimiter(options = {}) {
        const settings = options.settings;
        if (!settings) return '\n';

        const delimiterType = settings.get_string('clipboard-merge-selection-delimiter-type') || 'newline';
        if (delimiterType === 'custom') {
            return settings.get_string('clipboard-merge-selection-delimiter-custom') || '';
        }
        return DELIMITER_MAP.get(delimiterType) || '\n';
    }

    /**
     * Resolve and concatenate text content for selected text items.
     *
     * @param {Array<Object>} textItems Text items.
     * @param {Map<string, string>} textContents Map of text contents.
     * @param {string} delimiter Delimiter string.
     * @param {ClipboardManager} manager Clipboard manager.
     * @returns {Promise<string>} Concatenated string.
     * @private
     */
    static async _compileTexts(textItems, textContents, delimiter, manager) {
        if (textItems.length === 0) return '';
        const resolvedTexts = await Promise.all(textItems.map((item) => manager.getCopyMergeText(item, { textContents })));
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
