import { FileItem } from '../../../shared/constants/storagePaths.js';
import { getRecentItemsManager } from '../../../shared/utilities/utilityRecents.js';

/**
 * Resolves a storage file path from a file item key.
 *
 * @param {string} fileItemKey File item key.
 * @returns {string|null} Absolute path when available.
 */
export function resolveRecentlyUsedRecentFilePath(fileItemKey) {
    return fileItemKey ? FileItem?.[fileItemKey] : null;
}

/**
 * Creates a recents manager for a storage file and size setting.
 *
 * @param {string} extensionUuid Extension UUID.
 * @param {Gio.Settings} settings Extension settings object.
 * @param {string} absolutePath Absolute path to recents storage.
 * @param {string} maxItemsSettingKey Max-items setting key.
 * @returns {object} Recents manager instance.
 */
export function createRecentlyUsedRecentsManager(extensionUuid, settings, absolutePath, maxItemsSettingKey) {
    return getRecentItemsManager(extensionUuid, settings, absolutePath, maxItemsSettingKey);
}
