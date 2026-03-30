import { clipboardSetText } from '../../../shared/utilities/utilityClipboard.js';
import { AutoPaster, getAutoPaster } from '../../../shared/utilities/utilityAutoPaste.js';

import { RecentlyUsedFeatures, RecentlyUsedSettings } from '../constants/recentlyUsedConstants.js';

/**
 * Close extension menu when available; safely no-op during teardown paths.
 *
 * @param {object} extension GNOME extension instance
 */
export function closeMenuSafely(extension) {
    const menu = extension?._indicator?.menu;
    if (!menu || typeof menu.close !== 'function') {
        return;
    }

    try {
        menu.close();
    } catch {
        // Menu actor can already be destroyed during extension reload/disable.
    }
}

/**
 * Handle item click: copy to clipboard and optionally trigger auto-paste.
 *
 * @param {object} params
 * @param {object} params.itemData Item payload
 * @param {string} params.feature Feature id
 * @param {object} params.clipboardManager Clipboard manager
 * @param {object} params.gifDownloadService GIF download service
 * @param {object} params.settings Extension settings
 * @param {object} params.recentManagers Feature-id keyed recents managers
 * @param {object} params.extension GNOME extension instance
 */
export async function handleRecentlyUsedItemClick({ itemData, feature, clipboardManager, gifDownloadService, settings, recentManagers, extension }) {
    const featureConfigs = {
        emoji: RecentlyUsedFeatures.EMOJI,
        gif: RecentlyUsedFeatures.GIF,
        kaomoji: RecentlyUsedFeatures.KAOMOJI,
        symbols: RecentlyUsedFeatures.SYMBOLS,
    };

    const featureConfig = featureConfigs[feature];
    const autoPasteKey = featureConfig ? featureConfig.autoPasteKey : RecentlyUsedSettings.AUTO_PASTE_CLIPBOARD;

    let copySuccess = false;

    if (feature === 'clipboard') {
        copySuccess = await clipboardManager.copyToSystemClipboard(itemData);
    } else if (feature === 'gif') {
        copySuccess = await gifDownloadService.copyToClipboard(itemData, settings, clipboardManager);
    } else {
        const contentToCopy = itemData.char || itemData.value || '';
        if (contentToCopy) {
            clipboardSetText(contentToCopy);
            copySuccess = true;
        }
    }

    if (copySuccess) {
        if (feature === 'clipboard') {
            clipboardManager.promoteItemToTop(itemData.id);
        } else if (featureConfig) {
            // Bump the item to the top of its home tab's recents list.
            recentManagers[feature]?.addItem(itemData);
        }

        if (AutoPaster.shouldAutoPaste(settings, autoPasteKey)) {
            await getAutoPaster().trigger();
        }
    }

    closeMenuSafely(extension);
}
