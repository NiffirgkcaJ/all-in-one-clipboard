import { ClipboardIntegrationViewRich } from '../integrations/clipboardIntegrationViewRich.js';
import { ClipboardIntegrationViewText } from '../integrations/clipboardIntegrationViewText.js';

// View Integrations
const defaultRichView = ClipboardIntegrationViewRich();
const defaultTextView = ClipboardIntegrationViewText();

// ========================================================================
// Fallback View Provider
// ========================================================================

/**
 * Resolve the fallback view integration based on configuration.
 *
 * @param {Object} config View configuration.
 * @returns {Object} Fallback view integration.
 */
export function getFallbackView(config) {
    if (config && config.icon) {
        return defaultRichView;
    }
    return defaultTextView;
}
