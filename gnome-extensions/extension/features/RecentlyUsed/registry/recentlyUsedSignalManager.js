import { RecentlyUsedPolicySettingKeys } from '../constants/recentlyUsedPolicyConstants.js';

/**
 * Owns signal lifecycle for Recently Used runtime, including section signals and settings watchers.
 */
export class RecentlyUsedSignalManager {
    // ========================================================================
    // Lifecycle
    // ========================================================================

    /**
     * @param {object} options
     * @param {Function} options.getOrderedSections Returns ordered section definitions.
     * @param {object} options.extension Extension instance.
     * @param {Gio.Settings} options.settings Extension settings object.
     * @param {Function|null} options.onRender Callback to request re-render.
     */
    constructor({ getOrderedSections, extension, settings, onRender }) {
        this._getOrderedSections = typeof getOrderedSections === 'function' ? getOrderedSections : () => [];
        this._extension = extension;
        this._settings = settings;
        this._onRender = typeof onRender === 'function' ? onRender : null;
        this._signalIds = [];
    }

    /**
     * Connect all runtime signals.
     */
    connect() {
        this.disconnect();

        const sectionDefinitions = this._getOrderedSections();
        for (const section of sectionDefinitions) {
            if (typeof section.getSignals !== 'function') {
                continue;
            }

            const signals =
                section.getSignals({
                    extension: this._extension,
                    settings: this._settings,
                    onRender: this._onRender,
                }) || [];
            this._signalIds.push(...signals);
        }

        if (this._settings && typeof this._settings.connect === 'function') {
            RecentlyUsedPolicySettingKeys.forEach((settingKey) => {
                try {
                    const signalId = this._settings.connect(`changed::${settingKey}`, () => {
                        this._onRender?.();
                    });
                    this._signalIds.push({
                        obj: this._settings,
                        id: signalId,
                    });
                } catch {
                    // Ignore missing schema keys to keep runtime resilient.
                }
            });
        }
    }

    /**
     * Disconnect all previously connected signals.
     */
    disconnect() {
        if (!Array.isArray(this._signalIds)) {
            this._signalIds = [];
            return;
        }

        this._signalIds.forEach(({ obj, id }) => {
            if (!obj || !id || typeof obj.disconnect !== 'function') {
                return;
            }

            try {
                if (typeof obj.signal_handler_is_connected === 'function' && !obj.signal_handler_is_connected(id)) {
                    return;
                }
                obj.disconnect(id);
            } catch {
                // Ignore disconnect errors during teardown.
            }
        });

        this._signalIds = [];
    }
}
