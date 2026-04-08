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
     * Returns a sanitized signal descriptor or null when invalid.
     *
     * @param {object} descriptor Signal descriptor.
     * @param {object} [options] Normalization options.
     * @param {boolean} [options.warn=false] Whether to emit warnings for invalid descriptors.
     * @param {string} [options.context=''] Context label for warning logs.
     * @returns {object|null} Normalized descriptor.
     * @private
     */
    _normalizeSignalDescriptor(descriptor, { warn = false, context = '' } = {}) {
        const obj = descriptor?.obj;
        const id = descriptor?.id;
        const contextSuffix = context ? ` (${context})` : '';

        if (!obj || typeof obj.disconnect !== 'function') {
            if (warn) {
                console.warn(`[AIO-Clipboard] Ignoring invalid Recently Used signal descriptor${contextSuffix}: missing disconnect-capable object.`);
            }
            return null;
        }

        if (!Number.isInteger(id) || id <= 0) {
            if (warn) {
                console.warn(`[AIO-Clipboard] Ignoring invalid Recently Used signal descriptor${contextSuffix}: invalid signal id '${id}'.`);
            }
            return null;
        }

        return { obj, id };
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

            const sectionId = typeof section?.id === 'string' && section.id.length > 0 ? section.id : '<unknown>';
            let signals = [];

            try {
                signals =
                    section.getSignals({
                        extension: this._extension,
                        settings: this._settings,
                        onRender: this._onRender,
                    }) || [];
            } catch (e) {
                const message = e?.message ?? String(e);
                console.warn(`[AIO-Clipboard] Recently Used section '${sectionId}' failed to provide signals: ${message}`);
                continue;
            }

            if (!Array.isArray(signals)) {
                console.warn(`[AIO-Clipboard] Recently Used section '${sectionId}' returned a non-array getSignals() result. Expected Array<{obj,id}>.`);
                continue;
            }

            signals.forEach((descriptor, index) => {
                const normalized = this._normalizeSignalDescriptor(descriptor, {
                    warn: true,
                    context: `section '${sectionId}' signal[${index}]`,
                });
                if (normalized) {
                    this._signalIds.push(normalized);
                }
            });
        }

        if (this._settings && typeof this._settings.connect === 'function') {
            RecentlyUsedPolicySettingKeys.forEach((settingKey) => {
                try {
                    const signalId = this._settings.connect(`changed::${settingKey}`, () => {
                        this._onRender?.();
                    });
                    const normalized = this._normalizeSignalDescriptor(
                        {
                            obj: this._settings,
                            id: signalId,
                        },
                        {
                            warn: true,
                            context: `settings changed::${settingKey}`,
                        },
                    );
                    if (normalized) {
                        this._signalIds.push(normalized);
                    }
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

        this._signalIds.forEach((descriptor) => {
            const normalized = this._normalizeSignalDescriptor(descriptor);
            if (!normalized) {
                return;
            }

            const { obj, id } = normalized;

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
