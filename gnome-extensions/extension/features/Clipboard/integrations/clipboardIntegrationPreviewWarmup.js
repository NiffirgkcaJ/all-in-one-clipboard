// ============================================================================
// Public API
// ============================================================================

/**
 * Create preview warmup hooks for a definition.
 *
 * @param {object} config Integration configuration.
 * @param {Function} config.shouldWarmupItem Decides whether an item needs warmup.
 * @param {Function} config.warmupItem Performs warmup for an item.
 * @param {Function} config.warmupItemAsync Performs asynchronous warmup for an item.
 * @returns {object} Preview warmup hooks.
 */
export function ClipboardIntegrationPreviewWarmup({ shouldWarmupItem, warmupItem, warmupItemAsync }) {
    return {
        shouldWarmupItem,
        warmupItem,
        warmupItemAsync,
    };
}
