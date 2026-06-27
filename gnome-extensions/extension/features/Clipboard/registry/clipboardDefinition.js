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
