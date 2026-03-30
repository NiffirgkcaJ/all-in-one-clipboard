import { getRecentItemsManager } from '../../../shared/utilities/utilityRecents.js';

/**
 * Build recents managers map for the requested features.
 *
 * @param {object} params
 * @param {string} params.extensionUuid Extension UUID
 * @param {object} params.settings Extension settings
 * @param {Array<object>} params.features RecentlyUsedFeatures entries
 * @returns {object} Feature-id keyed recents managers
 */
export function createRecentManagers({ extensionUuid, settings, features }) {
    const recentManagers = {};

    for (const feature of features) {
        try {
            const absolutePath = feature.getPath(extensionUuid);
            recentManagers[feature.id] = getRecentItemsManager(extensionUuid, settings, absolutePath, feature.maxItemsKey);
        } catch (e) {
            console.warn(`[AIO-Clipboard] Failed to initialize ${feature.id} recents manager: ${e}`);
        }
    }

    return recentManagers;
}

/**
 * Connect data-change signals that should trigger full re-rendering.
 *
 * @param {object} params
 * @param {object} params.clipboardManager Clipboard manager instance
 * @param {object} params.recentManagers Feature-id keyed recents managers
 * @param {Function} params.onRender Callback to trigger rendering
 * @returns {Array<object>} Tracked signal descriptors
 */
export function connectRecentlyUsedSignals({ clipboardManager, recentManagers, onRender }) {
    const signalIds = [];

    signalIds.push({
        obj: clipboardManager,
        id: clipboardManager.connect('history-changed', onRender),
    });

    signalIds.push({
        obj: clipboardManager,
        id: clipboardManager.connect('pinned-list-changed', onRender),
    });

    Object.values(recentManagers).forEach((manager) => {
        if (!manager) {
            return;
        }

        signalIds.push({
            obj: manager,
            id: manager.connect('recents-changed', onRender),
        });
    });

    return signalIds;
}

/**
 * Safely disconnect tracked signals, skipping invalid or stale handlers.
 *
 * @param {Array<object>} signalIds Tracked signal descriptors
 * @returns {Array<object>} Always returns an empty array
 */
export function disconnectTrackedSignalsSafely(signalIds) {
    if (!Array.isArray(signalIds) || signalIds.length === 0) {
        return [];
    }

    signalIds.forEach(({ obj, id }) => {
        if (!obj || !id || typeof obj.disconnect !== 'function') {
            return;
        }

        try {
            if (typeof obj.signal_handler_is_connected === 'function' && !obj.signal_handler_is_connected(id)) {
                return;
            }

            obj.disconnect(id);
        } catch {
            // Ignore invalid or already-disconnected handlers during teardown.
        }
    });

    return [];
}
