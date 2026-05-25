import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import { clipboardGetText } from '../../../shared/utilities/utilityClipboard.js';
import { Logger } from '../../../shared/utilities/utilityLogger.js';

import { CodeProcessor } from '../processors/clipboardCodeProcessor.js';
import { ColorProcessor } from '../processors/clipboardColorProcessor.js';
import { ContactProcessor } from '../processors/clipboardContactProcessor.js';
import { FileProcessor } from '../processors/clipboardFileProcessor.js';
import { ImageProcessor } from '../processors/clipboardImageProcessor.js';
import { LinkProcessor } from '../processors/clipboardLinkProcessor.js';
import { TextProcessor } from '../processors/clipboardTextProcessor.js';

// Configuration
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 200;

/**
 * ClipboardMonitor
 *
 * Listens to system clipboard changes and performs content extraction/detection.
 */
export class ClipboardMonitor {
    // ========================================================================
    // Initialization
    // ========================================================================

    /**
     * Initialize the clipboard monitor.
     *
     * @param {ExclusionUtils} exclusionUtils Utility for handling exclusion rules.
     * @param {string} imagesDir Path for generating color processor gradients.
     * @param {Function} onContentCaptured Callback for when content is captured.
     * @param {ClipboardCaptureGuardService} captureGuard Guard for suppression decisions.
     */
    constructor(exclusionUtils, imagesDir, onContentCaptured, captureGuard) {
        this._exclusionUtils = exclusionUtils;
        this._imagesDir = imagesDir;
        this._onContentCaptured = onContentCaptured;
        this._captureGuard = captureGuard;

        this._selection = null;
        this._isPaused = false;
        this._processClipboardTimeoutId = 0;
        this._retryTimeoutId = 0;
    }

    /**
     * Start monitoring the system clipboard for changes.
     */
    start() {
        this._selection = global.display.get_selection();
        this._selectionOwnerChangedId = this._selection.connect('owner-changed', (selection, selectionType) => {
            if (selectionType === Meta.SelectionType.SELECTION_CLIPBOARD) {
                this._onClipboardChanged();
            }
        });
    }

    // ========================================================================
    // Monitoring Logic
    // ========================================================================

    /**
     * Handle clipboard change events with exclusion checks and debouncing.
     *
     * @private
     */
    _onClipboardChanged() {
        if (this._isPaused) return;

        const focusWindow = global.display.focus_window;

        if (this._exclusionUtils.shouldBlockClipboardNow(focusWindow)) {
            this._hashAndBlockClipboardContent();
            return;
        }

        if (this._processClipboardTimeoutId) {
            GLib.source_remove(this._processClipboardTimeoutId);
        }

        const processDelayMs = this._exclusionUtils.getClipboardCheckDelayMs();

        this._processClipboardTimeoutId = GLib.timeout_add(GLib.PRIORITY_LOW, processDelayMs, () => {
            const currentFocusWindow = global.display.focus_window;

            if (this._exclusionUtils.shouldBlockClipboardNow(currentFocusWindow)) {
                this._hashAndBlockClipboardContent();
                this._processClipboardTimeoutId = 0;
                return GLib.SOURCE_REMOVE;
            }

            this._processClipboardContent(1).catch((e) => Logger.error(`Monitor error: ${e.message}`));
            this._processClipboardTimeoutId = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Extract and identify clipboard content using various specialized processors.
     *
     * @param {number} attempt Current retry attempt number.
     * @private
     */
    async _processClipboardContent(attempt = 1) {
        try {
            // Image
            const imageResult = await ImageProcessor.extract();
            if (imageResult) {
                if (!this._shouldSuppress(imageResult)) {
                    this._onContentCaptured(imageResult);
                }
                return;
            }

            // Text
            const textResult = await TextProcessor.extract();
            if (textResult) {
                const text = textResult.text;

                const fileResult = await FileProcessor.process(text);
                if (fileResult) {
                    if (!this._shouldSuppress(fileResult)) {
                        this._onContentCaptured(fileResult);
                    }
                    return;
                }

                const linkResult = LinkProcessor.process(text);
                if (linkResult) {
                    if (!this._shouldSuppress(linkResult)) {
                        this._onContentCaptured(linkResult);
                    }
                    return;
                }

                const contactResult = await ContactProcessor.process(text);
                if (contactResult) {
                    if (!this._shouldSuppress(contactResult)) {
                        this._onContentCaptured(contactResult);
                    }
                    return;
                }

                const colorResult = ColorProcessor.process(text, this._imagesDir);
                if (colorResult) {
                    if (!this._shouldSuppress(colorResult)) {
                        this._onContentCaptured(colorResult);
                    }
                    return;
                }

                const codeResult = CodeProcessor.process(text);
                if (codeResult) {
                    if (!this._shouldSuppress(codeResult)) {
                        this._onContentCaptured(codeResult);
                    }
                    return;
                }

                // Fallback
                if (!this._shouldSuppress(textResult)) {
                    this._onContentCaptured(textResult);
                }
                return;
            }

            if (attempt <= MAX_RETRIES) {
                if (this._retryTimeoutId) GLib.source_remove(this._retryTimeoutId);

                this._retryTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RETRY_DELAY_MS, () => {
                    this._processClipboardContent(attempt + 1);
                    this._retryTimeoutId = 0;
                    return GLib.SOURCE_REMOVE;
                });
            }
        } catch (e) {
            Logger.warn(`Process error: ${e.message}`);
        }
    }

    /**
     * Capture the hash of the current clipboard content to prevent leakage from excluded applications.
     *
     * @private
     */
    _hashAndBlockClipboardContent() {
        clipboardGetText()
            .then((text) => {
                if (text) this._captureGuard?.registerText(text);
            })
            .catch(() => {});
    }

    // ========================================================================
    // Utilities
    // ========================================================================

    /**
     * Decide whether a capture should be suppressed and register allowed hashes.
     *
     * @param {Object} result Extracted result with hash.
     * @returns {boolean} True if suppressed.
     * @private
     */
    _shouldSuppress(result) {
        if (!this._captureGuard || !result?.hash) return false;

        if (this._captureGuard.shouldBlockHash(result.hash)) return true;

        this._captureGuard.registerHash(result.hash);
        return false;
    }

    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Set the paused state of the clipboard monitor.
     *
     * @param {boolean} isPaused Whether monitoring should be paused.
     */
    setPaused(isPaused) {
        this._isPaused = isPaused;
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    /**
     * Clean up resources and disconnect listeners before destruction.
     */
    destroy() {
        if (this._processClipboardTimeoutId) GLib.source_remove(this._processClipboardTimeoutId);
        if (this._retryTimeoutId) GLib.source_remove(this._retryTimeoutId);
        if (this._selectionOwnerChangedId) this._selection.disconnect(this._selectionOwnerChangedId);
    }
}
