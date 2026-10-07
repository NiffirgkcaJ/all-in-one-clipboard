import { Logger } from '../../../shared/utilities/utilityLogger.js';

import { ensureClipboardDefinition } from './clipboardDefinition.js';
import { getClipboardOrder } from '../definitions/clipboardOrder.js';

/**
 * ClipboardRegistry
 *
 * Dynamically loads clipboard definitions and executes their declared hooks.
 */
export class ClipboardRegistry {
    // ========================================================================
    // Initialization
    // ========================================================================

    /**
     * Create a Clipboard registry.
     *
     * @param {Array<object>} definitionEntries Ordered definition entries.
     */
    constructor(definitionEntries = getClipboardOrder()) {
        this._definitionEntries = definitionEntries;
        this._definitions = new Map();
        this._initializePromise = null;
    }

    /**
     * Initialize and load all clipboard definitions.
     *
     * @returns {Promise<void>} Initialization promise.
     */
    async initialize() {
        if (this._initializePromise) {
            return this._initializePromise;
        }

        this._initializePromise = (async () => {
            this._definitions.clear();

            const loadedDefinitions = await Promise.all(this._definitionEntries.map((definitionEntry) => this._loadDefinition(definitionEntry)));

            loadedDefinitions.filter(Boolean).forEach((definition) => {
                this._definitions.set(definition.id, definition);
            });
        })();

        return this._initializePromise;
    }

    // ========================================================================
    // Queries
    // ========================================================================

    /**
     * Get a definition by item type.
     *
     * @param {string} id Definition ID.
     * @returns {ClipboardDefinition|null} Definition or null.
     */
    getDefinition(id) {
        return this._definitions.get(id) || null;
    }

    /**
     * Get style configuration for a clipboard item.
     *
     * @param {Object} item Clipboard item.
     * @returns {Object|null} The style configuration.
     */
    getItemStyle(item) {
        const type = item.type;
        if (!type) return null;
        const definition = this.getDefinition(type);
        return definition ? definition.styling : null;
    }

    /**
     * Get search terms for an item type.
     *
     * @param {Object} item Clipboard item.
     * @returns {Array<string>} List of searchable strings.
     */
    getSearchTerms(item) {
        const definition = this.getDefinition(item.type);
        if (definition && definition.getSearchTerms) {
            return definition.getSearchTerms(item);
        }
        return [item.text, item.preview];
    }

    /**
     * Get the paste shortcut for an item type.
     *
     * @param {Object} item Clipboard item.
     * @param {Object} options Copy options.
     * @returns {'ctrl-v'|'shift-insert'|null} The paste shortcut.
     */
    getCopyPasteShortcut(item, options) {
        const definition = this.getDefinition(item?.type);
        if (!definition || !definition.copyOptions || !definition.copyOptions.pasteShortcut) {
            Logger.error(`ClipboardRegistry: Definition for type '${item?.type}' is missing copyOptions.pasteShortcut.`);
            return null;
        }
        const shortcut = definition.copyOptions.pasteShortcut;
        if (typeof shortcut === 'function') {
            return shortcut(item, options);
        }
        return shortcut;
    }

    // ========================================================================
    // Copy Operations
    // ========================================================================

    /**
     * Copy an item to the clipboard.
     *
     * @param {Object} item Clipboard item.
     * @param {Object} options Options containing storage and manager.
     * @returns {Promise<boolean>} True if successful.
     */
    async copyItem(item, options) {
        const definition = this.getDefinition(item.type);
        if (definition && definition.copyOptions && definition.copyOptions.copyItem) {
            return await definition.copyOptions.copyItem(item, options);
        }
        return false;
    }

    /**
     * Get a multi-step copy/paste queue if supported by the item's definition.
     *
     * @param {Object} item Clipboard item.
     * @param {Object} options Options containing storage and manager.
     * @returns {Promise<Array<Object>|null>} Array of queue action items or null.
     */
    async getCopyQueue(item, options) {
        const definition = this.getDefinition(item?.type);
        if (definition && definition.copyOptions && definition.copyOptions.getCopyQueue) {
            return await definition.copyOptions.getCopyQueue(item, options);
        }
        return null;
    }

    /**
     * Get the merge behavior for an item type.
     *
     * @param {Object} item Clipboard item.
     * @returns {string} 'text' or 'file'
     */
    getCopyMergeBehavior(item) {
        const definition = this.getDefinition(item.type);
        return definition && definition.copyOptions ? definition.copyOptions.mergeBehavior || 'text' : 'text';
    }

    /**
     * Get the merge text for an item.
     *
     * @param {Object} item Clipboard item.
     * @param {Object} options Options containing textContents and manager.
     * @returns {Promise<string>} The resolved text content.
     */
    async getCopyMergeText(item, options) {
        const definition = this.getDefinition(item.type);
        if (definition && definition.copyOptions && definition.copyOptions.getMergeText) {
            return await definition.copyOptions.getMergeText(item, options);
        }
        return '';
    }

    /**
     * Get the merge URI for an item.
     *
     * @param {Object} item Clipboard item.
     * @param {Object} options Options containing manager.
     * @returns {string|null} The resolved URI.
     */
    getCopyMergeUri(item, options) {
        const definition = this.getDefinition(item.type);
        if (definition && definition.copyOptions && definition.copyOptions.getMergeUri) {
            return definition.copyOptions.getMergeUri(item, options);
        }
        return null;
    }

    // ========================================================================
    // View Configuration
    // ========================================================================

    /**
     * Configure the view representation of an item.
     *
     * @param {Object} config The view config to populate.
     * @param {Object} item Clipboard item.
     * @param {Object} options View context.
     */
    configureView(config, item, options) {
        const definition = this.getDefinition(item.type);
        if (definition && definition.configureView) {
            definition.configureView(config, item, options);
        } else {
            config.text = item.preview || item.text || '';
        }
    }

    /**
     * Create list content through an item's definition.
     *
     * @param {Object} config View config.
     * @param {Object} item Clipboard item.
     * @param {Object} options Render options.
     * @returns {St.Widget|null} Content widget or null.
     */
    createListContent(config, item, options) {
        const definition = this.getDefinition(item.type);
        if (definition && definition.createListContent) {
            return definition.createListContent(config, item, { ...options, definition });
        }
        return null;
    }

    /**
     * Create grid content through an item's definition.
     *
     * @param {Object} config View config.
     * @param {Object} item Clipboard item.
     * @param {Object} options Render options.
     * @returns {St.Widget|null} Content widget or null.
     */
    createGridContent(config, item, options) {
        const definition = this.getDefinition(item.type);
        if (definition && definition.createGridContent) {
            return definition.createGridContent(config, item, { ...options, definition });
        }
        return null;
    }

    /**
     * Build a view fingerprint through an item's definition.
     *
     * @param {Object} config View config.
     * @param {Object} item Clipboard item.
     * @param {Object} options Render options.
     * @returns {string} View fingerprint.
     */
    getViewFingerprint(config, item, options) {
        const configFingerprint = config._fingerprint || '';
        const definition = this.getDefinition(item.type);
        if (definition && definition.getViewFingerprint) {
            return [configFingerprint, definition.getViewFingerprint(config, item, { ...options, definition }) || ''].join('|');
        }
        return configFingerprint;
    }

    /**
     * Get optional grid badge metadata through an item's definition.
     *
     * @param {Object} config View config.
     * @param {Object} item Clipboard item.
     * @param {Object} options Render options.
     * @returns {Object|null} Badge metadata or null.
     */
    getGridBadge(config, item, options) {
        const definition = this.getDefinition(item.type);
        if (definition && definition.getGridBadge) {
            return definition.getGridBadge(config, item, { ...options, definition });
        }
        return null;
    }

    /**
     * Get shell-level view metadata through an item's definition.
     *
     * @param {Object} config View config.
     * @param {Object} item Clipboard item.
     * @param {Object} options Render options.
     * @returns {Object} View metadata.
     */
    getViewMetadata(config, item, options) {
        const definition = this.getDefinition(item.type);
        if (definition && definition.getViewMetadata) {
            return definition.getViewMetadata(config, item, { ...options, definition }) || {};
        }
        return {};
    }

    // ========================================================================
    // Content Processing
    // ========================================================================

    /**
     * Extract clipboard content through registered definitions.
     *
     * @param {object} context Extraction context.
     * @returns {Promise<Object|null>} Extracted result or null.
     */
    async extractClipboardContent(context = {}) {
        await this.initialize();

        const extracted = await this._runExtractionAtIndex(this._getHookDefinitions('extract'), 0, context);
        if (!extracted?.text) return extracted || null;

        const processedTextResult = await this._runTextHookAtIndex(this._getHookDefinitions('processText'), 0, extracted.text, context);
        return processedTextResult || extracted;
    }

    /**
     * Create a clipboard item from a processor result.
     *
     * @param {Object} result Processor result.
     * @param {ClipboardStorage} storage Clipboard storage.
     * @returns {Promise<Object|null>} Clipboard item or null.
     */
    async createItemFromResult(result, storage) {
        await this.initialize();

        const definition = this.getDefinition(result.type);
        if (!definition || !definition.createItem) return null;

        return await definition.createItem(result, {
            definition,
            storage,
        });
    }

    /**
     * Run enrichment hooks for an item.
     *
     * @param {Object} item Clipboard item.
     * @param {object} context Enrichment context.
     * @returns {Promise<void>}
     */
    async enrichItem(item, context = {}) {
        await this.initialize();

        const definition = this.getDefinition(item.type);
        if (!definition) return;

        const enrichHooks = definition.enrichItem;
        if (enrichHooks.length === 0) return;

        await Promise.all(enrichHooks.map((hook) => hook(item, { ...context, definition })));
    }

    // ========================================================================
    // Maintenance
    // ========================================================================

    /**
     * Delete files associated with an item.
     *
     * @param {Object} item Clipboard item.
     * @param {ClipboardStorage} storage Clipboard storage.
     */
    deleteItemFiles(item, storage) {
        const definition = this.getDefinition(item.type);
        if (definition && definition.storageOptions && definition.storageOptions.deleteItemFiles) {
            definition.storageOptions.deleteItemFiles(item, storage);
        }
    }

    /**
     * Collect valid files for garbage collection.
     *
     * @param {Object} item Clipboard item.
     * @param {Map} validFilesMap Map to collect filenames by dirKey.
     */
    collectGarbageFiles(item, validFilesMap) {
        const definition = this.getDefinition(item.type);
        if (definition && definition.storageOptions && definition.storageOptions.collectGarbageFiles) {
            definition.storageOptions.collectGarbageFiles(item, validFilesMap);
        }
    }

    /**
     * Check if an item has full content backed by storage.
     *
     * @param {string} type Item type.
     * @returns {boolean} True if it has full content.
     */
    hasFullContent(type) {
        const definition = this.getDefinition(type);
        return definition?.hasFullContent || false;
    }

    /**
     * Verify and heal an item through its definition.
     *
     * @param {Object} item Clipboard item.
     * @param {object} context Healing context.
     * @returns {Promise<Object>} Healing result.
     */
    async verifyAndHealItem(item, context = {}) {
        await this.initialize();

        const definition = this.getDefinition(item.type);
        if (!definition || !definition.healItem) {
            return { healed: false, isCorrupted: false };
        }

        return await definition.healItem(item, {
            ...context,
            definition,
        });
    }

    /**
     * Get items that should run preview warmup.
     *
     * @param {Array<Object>} items Candidate items.
     * @returns {Array<Object>} Items requiring warmup.
     */
    getPreviewWarmupItems(items = []) {
        return items.filter((item) => {
            const definition = this.getDefinition(item.type);
            return definition ? definition.shouldWarmupItem(item, { definition }) : false;
        });
    }

    /**
     * Warm up a single item through its definition.
     *
     * @param {Object} item Clipboard item.
     * @param {object} context Warmup context.
     * @returns {boolean} True when item changed.
     */
    warmupItem(item, context = {}) {
        const definition = this.getDefinition(item.type);
        if (!definition) return false;
        return definition.warmupItem(item, { ...context, definition });
    }

    /**
     * Warm up a single item asynchronously through its definition.
     *
     * @param {Object} item Clipboard item.
     * @param {object} context Warmup context.
     * @returns {Promise<boolean>} True when item changed.
     */
    async warmupItemAsync(item, context = {}) {
        await this.initialize();
        const definition = this.getDefinition(item.type);
        if (!definition) return false;
        if (definition.warmupItemAsync) {
            return await definition.warmupItemAsync(item, { ...context, definition });
        }
        return definition.warmupItem(item, { ...context, definition });
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    /**
     * Destroy loaded definitions and clear registry state.
     */
    destroy() {
        for (const definition of this._definitions.values()) {
            definition.destroy();
        }

        this._definitions.clear();
        this._initializePromise = null;
    }

    // ========================================================================
    // Internal Loaders
    // ========================================================================

    /**
     * Load and normalize one clipboard definition module.
     *
     * @param {object} definitionEntry Definition order entry.
     * @returns {Promise<ClipboardDefinition|null>} Loaded definition or null.
     * @private
     */
    async _loadDefinition(definitionEntry) {
        const definitionId = definitionEntry?.id;
        const modulePath = definitionEntry?.modulePath;
        const exportName = definitionEntry?.exportName;

        if (!definitionId || !modulePath || !exportName) {
            Logger.warn(`Ignoring invalid clipboard definition '${definitionId || '<unknown>'}'.`);
            return null;
        }

        try {
            const module = await import(modulePath);
            const loadedDefinition = module[exportName](definitionEntry);

            if (!loadedDefinition) {
                Logger.warn(`Clipboard definition '${definitionId}' did not export a usable definition.`);
                return null;
            }

            const definition = ensureClipboardDefinition({
                ...definitionEntry,
                ...loadedDefinition,
                id: loadedDefinition.id || definitionEntry.id,
            });

            await definition.initialize();

            return definition;
        } catch (e) {
            const message = e?.message ?? String(e);
            Logger.warn(`Failed to load clipboard definition '${definitionId}': ${message}`);
            return null;
        }
    }

    /**
     * Run extract hooks in priority order.
     *
     * @param {Array<ClipboardDefinition>} definitions Definitions with extract hooks.
     * @param {number} index Current index.
     * @param {object} context Extraction context.
     * @returns {Promise<Object|null>} Extracted result or null.
     * @private
     */
    async _runExtractionAtIndex(definitions, index, context) {
        if (index >= definitions.length) return null;

        const definition = definitions[index];
        const result = await definition.extract({ ...context, definition });
        if (result) return result;

        return await this._runExtractionAtIndex(definitions, index + 1, context);
    }

    /**
     * Run text processing hooks in priority order.
     *
     * @param {Array<ClipboardDefinition>} definitions Definitions with processText hooks.
     * @param {number} index Current index.
     * @param {string} text Clipboard text.
     * @param {object} context Processing context.
     * @returns {Promise<Object|null>} Processed result or null.
     * @private
     */
    async _runTextHookAtIndex(definitions, index, text, context) {
        if (index >= definitions.length) return null;

        const definition = definitions[index];
        const result = await definition.processText(text, { ...context, definition });
        if (result) return result;

        return await this._runTextHookAtIndex(definitions, index + 1, text, context);
    }

    /**
     * Get definitions that implement a hook.
     *
     * @param {string} hookName Hook name.
     * @returns {Array<ClipboardDefinition>} Ordered definitions.
     * @private
     */
    _getHookDefinitions(hookName) {
        return [...this._definitions.values()].filter((definition) => definition[hookName]).sort((a, b) => (a.priority || 0) - (b.priority || 0));
    }
}
