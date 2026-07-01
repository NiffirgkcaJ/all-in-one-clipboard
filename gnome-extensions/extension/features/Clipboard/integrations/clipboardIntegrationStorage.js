// ============================================================================
// Public API
// ============================================================================

/**
 * Generic storage integration for clipboard definitions.
 *
 * @param {object} config Configuration object.
 * @param {Array<object>} config.files Array of file configurations to manage.
 * @returns {object} Object with `deleteItemFiles` and `collectGarbageFiles` functions.
 */
export function ClipboardIntegrationStorage({ files = [] } = {}) {
    return {
        /**
         * Delete all associated files for this item.
         *
         * @param {object} item The clipboard item.
         * @param {object} storage Storage service.
         */
        deleteItemFiles(item, storage) {
            files.forEach((fileConfig) => {
                if (fileConfig.shouldDelete && !fileConfig.shouldDelete(item)) return;

                const filename = fileConfig.resolveFilename(item);
                if (!filename) return;

                const dir = storage[fileConfig.dirKey];
                if (dir) {
                    storage.deleteFile(dir, filename);
                }
            });
        },

        /**
         * Collect valid files to keep during garbage collection.
         *
         * @param {object} item The clipboard item.
         * @param {Map} validFilesMap Map of dirKey to Set of filenames.
         */
        collectGarbageFiles(item, validFilesMap) {
            files.forEach((fileConfig) => {
                if (fileConfig.shouldCollect && !fileConfig.shouldCollect(item)) return;

                const filename = fileConfig.resolveFilename(item);
                if (filename) {
                    if (!validFilesMap.has(fileConfig.dirKey)) {
                        validFilesMap.set(fileConfig.dirKey, new Set());
                    }
                    validFilesMap.get(fileConfig.dirKey).add(filename);
                }
            });
        },
    };
}
