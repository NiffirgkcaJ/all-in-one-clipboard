import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

import { Logger } from '../../../shared/utilities/utilityLogger.js';

import { ClipboardType } from '../constants/clipboardConstants.js';
import { ImageProcessor } from '../processors/clipboardImageProcessor.js';
import { LinkProcessor } from '../processors/clipboardLinkProcessor.js';
import { TextProcessor } from '../processors/clipboardTextProcessor.js';

/**
 * ClipboardContentRouterService
 *
 * Routes captured clipboard content to the appropriate processor and saves
 * the resulting item to the manager's history.
 */
export class ClipboardContentRouterService {
    // ========================================================================
    // Initialization
    // ========================================================================

    /**
     * Initialize the content router.
     *
     * @param {ClipboardManager} manager The clipboard manager.
     * @param {ClipboardStorage} storage The clipboard storage.
     * @param {ExclusionUtils} exclusionUtils Exclusion utilities.
     */
    constructor(manager, storage, exclusionUtils) {
        this._manager = manager;
        this._storage = storage;
        this._exclusionUtils = exclusionUtils;

        this._linkProcessor = new LinkProcessor();
        this._httpSession = new Soup.Session();
    }

    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Get the link processor instance.
     *
     * @returns {LinkProcessor} The link processor.
     */
    get linkProcessor() {
        return this._linkProcessor;
    }

    /**
     * Get the HTTP session instance.
     *
     * @returns {Soup.Session} The HTTP session.
     */
    get httpSession() {
        return this._httpSession;
    }

    /**
     * Process captured clipboard content and route it to the appropriate handler.
     *
     * @param {Object} result Extracted clipboard content.
     */
    processResult(result) {
        if (!result || result.hash === this._manager.lastContent) return;
        this._manager.lastContent = result.hash;

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
                Logger.warn(`Unknown type: ${result.type}`);
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

        this._manager.addItemToHistory(newItem);
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

        this._manager.addItemToHistory(newItem);

        if (this._exclusionUtils.isAddressExcluded(newItem.url)) return;

        this._linkProcessor.fetchMetadata(newItem.url).then(async (metadata) => {
            let updated = false;
            const history = this._manager.getHistoryItems();
            const item = history.find((i) => i.id === newItem.id);
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
                this._storage.saveHistory(history);
                this._manager.emit('history-changed');
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

        this._manager.addItemToHistory(newItem);

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
                                this._storage.saveHistory(this._manager.getHistoryItems());
                                this._manager.emit('history-changed');
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

        this._manager.addItemToHistory(newItem);
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

        if (this._manager.handleDuplicateCheck(hash)) return;

        const newItem =
            ProcessorClass === ImageProcessor ? await ProcessorClass.save(extraction, storageDir, this._storage.imagePreviewsDir) : await ProcessorClass.save(extraction, storageDir, forceFileSave);

        if (newItem) {
            const history = this._manager.getHistoryItems();
            history.unshift(newItem);
            this._storage.pruneHistory(history);
            this._storage.saveHistory(history);
            this._manager.emit('history-changed');
        }
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    /**
     * Clean up resources.
     */
    destroy() {
        this._linkProcessor?.destroy();
        this._httpSession?.abort();
        this._httpSession = null;
    }
}
