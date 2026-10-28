import { Logger } from '../../../shared/utilities/utilityLogger.js';

import { getClipboardOrder } from '../definitions/clipboardOrder.js';

import { defaultItemActions, ensureClipboardDefinition } from './clipboardDefinition.js';

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
     * @param {Gio.Settings|null} settings Extension settings instance.
     */
    constructor(definitionEntries = getClipboardOrder(), settings = null) {
        this._definitionEntries = definitionEntries;
        this._settings = settings;
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
     * @param {Object} [options] Copy options.
     * @returns {'ctrl-v'|'shift-insert'|null} The paste shortcut.
     */
    getPasteShortcut(item, options = {}) {
        const definition = this.getDefinition(item?.type);
        if (!definition || !definition.copyOptions || !definition.copyOptions.getPasteShortcut) {
            Logger.error(`ClipboardRegistry: Definition for type '${item?.type}' is missing copyOptions.getPasteShortcut.`);
            return null;
        }
        const shortcut = definition.copyOptions.getPasteShortcut;
        if (typeof shortcut === 'function') {
            const context = {
                ...options,
                settings: options.settings || this._settings,
            };
            return shortcut(item, context);
        }
        return shortcut;
    }

    // ========================================================================
    // Copy Operations
    // ========================================================================

    /**
     * Copy an item using its declared definition copy options.
     *
     * @param {Object} item Clipboard item.
     * @param {Object} [options] Options containing storage, manager, and settings.
     * @returns {Promise<boolean>} True if successful.
     */
    async copyItemToClipboard(item, options = {}) {
        const definition = this.getDefinition(item.type);
        if (definition && definition.copyOptions && definition.copyOptions.copyItemToClipboard) {
            const context = {
                ...options,
                settings: options.settings || this._settings,
            };
            return await definition.copyOptions.copyItemToClipboard(item, context);
        }
        return false;
    }

    /**
     * Get a multi-step copy queue if supported by the item definition.
     *
     * @param {Object} item Clipboard item.
     * @param {Object} [options] Options containing storage, manager, and settings.
     * @returns {Promise<Array<Object>|null>} Array of queue action items or null.
     */
    async getCopyQueue(item, options = {}) {
        const definition = this.getDefinition(item.type);
        if (definition && definition.copyOptions && definition.copyOptions.getCopyQueue) {
            const context = {
                ...options,
                settings: options.settings || this._settings,
            };
            return await definition.copyOptions.getCopyQueue(item, context);
        }
        return null;
    }

    /**
     * Get the copy mode for an item type.
     *
     * @param {Object} item Clipboard item.
     * @returns {'string'|'blob'} Copy mode.
     */
    getCopyMode(item) {
        const definition = this.getDefinition(item.type);
        return definition && definition.copyOptions ? definition.copyOptions.copyMode || 'string' : 'string';
    }

    /**
     * Serialize an item to its string representation.
     *
     * @param {Object} item Clipboard item.
     * @param {Object} [options] Options containing textContents, manager, and settings.
     * @returns {Promise<string>} The serialized content string.
     */
    async serializeItem(item, options = {}) {
        const definition = this.getDefinition(item.type);
        if (definition && definition.copyOptions && definition.copyOptions.serializeItem) {
            const context = {
                ...options,
                settings: options.settings || this._settings,
            };
            return await definition.copyOptions.serializeItem(item, context);
        }
        return '';
    }

    /**
     * Copy a batch of items using their declared definition copy options.
     *
     * @param {Array<Object>} items Clipboard items.
     * @param {Object} [options] Options containing storage, manager, and settings.
     * @returns {Promise<boolean>} True if handled as a batch.
     */
    async copyBatchToClipboard(items, options = {}) {
        if (!items || items.length === 0) return false;
        const firstType = items[0]?.type;
        const definition = this.getDefinition(firstType);
        if (definition && definition.copyOptions && definition.copyOptions.copyBatchToClipboard) {
            const context = {
                ...options,
                settings: options.settings || this._settings,
            };
            return await definition.copyOptions.copyBatchToClipboard(items, context);
        }
        return false;
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
     * Create action buttons for an item through its definition or default actions.
     *
     * @param {Object} item Clipboard item.
     * @param {Object} options Action options.
     * @returns {Array<St.Button>} Action buttons.
     */
    createItemActions(item, options) {
        const definition = this.getDefinition(item?.type);
        if (definition && definition.createActions) {
            return definition.createActions(item, options);
        }
        return defaultItemActions.createActions(item, options);
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
        const viewFingerprint = definition && definition.getViewFingerprint ? definition.getViewFingerprint(config, item, { ...options, definition }) : config.text || '';
        return [configFingerprint, viewFingerprint].join('|');
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
     * Resolve actionable intent items from content across all registered definitions.
     *
     * @param {object} result Processor result to scan for intents.
     * @param {object} context Intent resolution context containing settings.
     * @returns {Promise<Array<object>>} List of resolved intent results.
     */
    async resolveIntents(result, context = {}) {
        if (!result) return [];

        const settings = context.settings ?? this._settings;
        if (!settings) {
            Logger.warn('Intent resolution skipped because settings are required.');
            return [];
        }

        await this.initialize();

        // Applicability
        const definitions = this._getHookDefinitions('extractIntents').filter((definition) => {
            if (definition.id === result.type) return false;
            if (definition.intentSources && !definition.intentSources.includes(result.type)) return false;
            if (definition.intentField && !result[definition.intentField]) return false;
            return true;
        });

        // Intent Execution
        const intentPromises = definitions.map(async (definition) => {
            try {
                const results = await definition.extractIntents(result, { ...context, definition, settings });
                const items = Array.isArray(results) ? results : [];
                return { providerId: definition.id, items };
            } catch (e) {
                Logger.warn(`Failed to resolve intents for definition ${definition.id}: ${e.message}`);
                return { providerId: definition.id, items: [] };
            }
        });

        const providerBatches = await Promise.all(intentPromises);

        // Validation and Deduplication
        const seenHashes = new Set();
        if (result.hash) {
            seenHashes.add(result.hash);
        }

        const validIntents = [];
        for (const { providerId, items } of providerBatches) {
            for (const intent of items) {
                if (!intent || typeof intent.type !== 'string' || typeof intent.hash !== 'string') {
                    Logger.warn(`Discarded intent from provider ${providerId}: missing required type or hash.`);
                    continue;
                }

                if (seenHashes.has(intent.hash)) continue;

                const targetDefinition = this.getDefinition(intent.type);
                if (!targetDefinition || typeof targetDefinition.createItem !== 'function') {
                    Logger.warn(`Discarded intent from provider ${providerId}: unhandled target definition ${intent.type}.`);
                    continue;
                }

                seenHashes.add(intent.hash);
                validIntents.push(intent);
            }
        }

        return validIntents;
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
        if (!definition) {
            return { healed: false, isCorrupted: true };
        }

        if (!definition.healItem) {
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
