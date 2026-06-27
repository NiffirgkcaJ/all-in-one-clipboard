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
     * Get styling for an item type.
     *
     * @param {string} type Item type.
     * @returns {Object|null} Styling object or null.
     */
    getItemStyle(type) {
        const definition = this.getDefinition(type);
        if (definition?.styling) return definition.styling;

        const fallbackDefinition = this.getDefinition('text');
        return fallbackDefinition?.styling || null;
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

        const definition = this.getDefinition(result?.type);
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

        const definition = this.getDefinition(item?.type);
        if (!definition) return;

        const enrichHooks = definition.enrichItem;
        if (enrichHooks.length === 0) return;

        await Promise.all(enrichHooks.map((hook) => hook(item, { ...context, definition })));
    }

    // ========================================================================
    // Maintenance
    // ========================================================================

    /**
     * Verify and heal an item through its definition.
     *
     * @param {Object} item Clipboard item.
     * @param {object} context Healing context.
     * @returns {Promise<Object>} Healing result.
     */
    async verifyAndHealItem(item, context = {}) {
        await this.initialize();

        const definition = this.getDefinition(item?.type);
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
            const definition = this.getDefinition(item?.type);
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
        const definition = this.getDefinition(item?.type);
        if (!definition) return false;
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
