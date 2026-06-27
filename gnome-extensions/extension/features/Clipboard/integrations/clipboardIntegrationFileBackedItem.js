// ============================================================================
// Public API
// ============================================================================

/**
 * Create a integration that delegates item persistence to a processor save method.
 *
 * @param {object} config Integration configuration.
 * @param {object} config.processor Processor class with save().
 * @param {string} config.storageDirKey Storage directory getter key.
 * @param {string|null} config.previewDirKey Optional preview directory getter key.
 * @param {boolean} config.forceFileSave Whether text content should always be file-backed.
 * @returns {Function} Async item creation integration.
 */
export function ClipboardIntegrationFileBackedItem({ processor, storageDirKey, previewDirKey = null, forceFileSave = false }) {
    return async (result, { storage } = {}) => {
        if (!storageDirKey || !storage) return null;

        const storageDir = storage[storageDirKey];
        if (!storageDir) return null;

        if (previewDirKey) {
            return await processor.save(result, storageDir, storage[previewDirKey]);
        }

        return await processor.save(result, storageDir, forceFileSave);
    };
}
