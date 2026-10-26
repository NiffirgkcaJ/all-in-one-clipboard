import { ClipboardIntegrationItemActions } from '../integrations/clipboardIntegrationItemActions.js';

// ========================================================================
// Defaults
// ========================================================================

/**
 * Default action integration for standard item actions.
 */
export const defaultItemActions = ClipboardIntegrationItemActions();

/**
 * Base contract for Clipboard definitions.
 */
export class ClipboardDefinition {
    // ========================================================================
    // Initialization
    // ========================================================================

    /**
     * Create a clipboard definition with default hook implementations.
     *
     * @param {object} config Definition configuration.
     */
    constructor(config = {}) {
        Object.assign(this, config);
        this.enrichItem = this._normalizeHooks(this.enrichItem);
        this.intentSources = Array.isArray(this.intentSources) ? this.intentSources : null;
        this.intentField = typeof this.intentField === 'string' ? this.intentField : null;
    }

    /**
     * Initialize definition runtime resources.
     *
     * @returns {Promise<void>|void}
     */
    initialize() {}

    /**
     * Decide whether an item should be included in preview warmup.
     *
     * @returns {boolean} True when warmup should run.
     */
    shouldWarmupItem() {
        return false;
    }

    /**
     * Warm up item resources.
     *
     * @returns {boolean} True when the item changed.
     */
    warmupItem() {
        return false;
    }

    /**
     * Create action buttons for an item.
     *
     * @param {Object} item Clipboard item.
     * @param {Object} context Action context.
     * @returns {Array<St.Button>} List of action buttons.
     */
    createActions(item, context) {
        return defaultItemActions.createActions(item, context);
    }

    /**
     * Extract actionable intent items embedded within content.
     *
     * @param {object} _result Processor result to scan for intents.
     * @param {object} _context Intent resolution context.
     * @returns {Promise<Array<object>>|Array<object>} List of extracted intent results.
     */
    extractIntents(_result, _context) {
        return [];
    }

    /**
     * Clean up definition runtime resources.
     */
    destroy() {}

    // ========================================================================
    // Internal Helpers
    // ========================================================================

    /**
     * Normalize a hook or hook array.
     *
     * @param {Function|Array<Function>|null|undefined} hooks Hook value.
     * @returns {Array<Function>} Hook array.
     * @private
     */
    _normalizeHooks(hooks) {
        if (!hooks) return [];
        return Array.isArray(hooks) ? hooks.filter(Boolean) : [hooks];
    }
}

// ============================================================================
// Normalization
// ============================================================================

/**
 * Ensure a clipboard definition has the base definition contract.
 *
 * @param {object} definition Clipboard definition object.
 * @returns {ClipboardDefinition|null} Normalized definition or null.
 */
export function ensureClipboardDefinition(definition) {
    if (!definition) return null;
    return definition instanceof ClipboardDefinition ? definition : new ClipboardDefinition(definition);
}
