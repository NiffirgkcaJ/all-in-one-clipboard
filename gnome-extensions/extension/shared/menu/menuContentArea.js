import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { applySearchHandoffToTab } from '../services/serviceSearchHub.js';
import { FilePath } from '../constants/storagePaths.js';
import { IOFile } from '../utilities/utilityIO.js';

import { getMenuSectionByLocalizedName } from './menuRegistry.js';

/**
 * The content area of the menu, which displays the active tab.
 */
export const MenuContentArea = GObject.registerClass(
    {
        Signals: {
            'set-main-tab-bar-visibility': { param_types: [GObject.TYPE_BOOLEAN] },
            'navigate-to-main-tab': { param_types: [GObject.TYPE_STRING] },
        },
    },
    class MenuContentArea extends St.Bin {
        /**
         * Initializes the content area layout and tracking states.
         *
         * @param {Gio.Settings} settings Extension settings object.
         * @param {object} extension Parent extension instance.
         * @param {object} clipboardManager The active clipboard persistence manager.
         */
        constructor(settings, extension, clipboardManager) {
            super({
                style_class: 'aio-clipboard-content-area',
                x_expand: true,
                y_expand: true,
                y_align: Clutter.ActorAlign.FILL,
                x_align: Clutter.ActorAlign.FILL,
            });
            this._settings = settings;
            this._extension = extension;
            this._clipboardManager = clipboardManager;

            this._activeTabName = null;
            this._currentTabActor = null;
            this._isSelectingTab = false;

            this._currentTabVisibilitySignalId = 0;
            this._currentTabNavigateSignalId = 0;
            this._selectTabTimeoutId = 0;
        }

        // ========================================================================
        // Tab Selection
        // ========================================================================

        /**
         * Selects a tab by rendering its definition payload dynamically.
         *
         * @param {string} tabName Localized target tab identifier to execute.
         * @returns {Promise<void>} Resolves when the target component instantiates completely.
         */
        async selectTab(tabName) {
            if (!IOFile.mkdir(FilePath.DATA)) {
                return;
            }
            this._isSelectingTab = true;

            const oldActor = this._currentTabActor;

            try {
                if (this._activeTabName === tabName && oldActor) {
                    oldActor.onTabSelected?.();
                    return;
                }

                this._activeTabName = tabName;

                const newContentActor = await this._loadTabModule(tabName);

                if (this._activeTabName !== tabName) {
                    newContentActor?.destroy();
                    return;
                }

                await applySearchHandoffToTab({
                    targetTab: tabName,
                    tabActor: newContentActor,
                });

                if (this._activeTabName !== tabName) {
                    newContentActor?.destroy();
                    return;
                }

                this.set_child(newContentActor);

                this._disconnectTabSignals(oldActor);
                oldActor?.destroy();

                this._currentTabActor = newContentActor;

                this._connectTabSignals(newContentActor);

                this._scheduleTabSelected();
            } catch (e) {
                console.error(`[AIO-Clipboard] Failed to load tab '${tabName}': ${e.message}\n${e.stack}`);

                this.emit('set-main-tab-bar-visibility', true);

                oldActor?.destroy();

                if (this._activeTabName === tabName) {
                    const errorLabel = new St.Label({
                        text: `Error loading tab: ${e.message}`,
                        style_class: 'aio-clipboard-error-label',
                        x_align: Clutter.ActorAlign.CENTER,
                        y_align: Clutter.ActorAlign.CENTER,
                        x_expand: true,
                        y_expand: true,
                    });
                    this.set_child(errorLabel);
                    this._currentTabActor = errorLabel;
                }
            } finally {
                this._isSelectingTab = false;
            }
        }

        // ========================================================================
        // Module Loading
        // ========================================================================

        /**
         * Loads and instantiates the appropriate module matching the definition target dynamically.
         *
         * @param {string} tabName Localized target tab name bound explicitly.
         * @returns {Promise<Clutter.Actor>} Renderable content actor representing requested configuration logic locally.
         * @throws {Error} Evaluates when the namespace resolution aborts gracefully natively.
         * @private
         */
        async _loadTabModule(tabName) {
            const sectionDef = getMenuSectionByLocalizedName(tabName);
            if (!sectionDef) {
                throw new Error(`[AIO-Clipboard] No layout definition found for tab: ${tabName}`);
            }

            if (typeof sectionDef.createContentActor !== 'function') {
                throw new Error(`[AIO-Clipboard] Tab definition ${sectionDef.id} missing 'createContentActor' factory.`);
            }

            return await sectionDef.createContentActor(this._extension, this._settings, this._clipboardManager);
        }

        // ========================================================================
        // Signal Management
        // ========================================================================

        /**
         * Connects local tab events directly to bubble through the Menu implementation logically.
         *
         * @param {Clutter.Actor} actor Valid initialized tab layout structure object.
         * @private
         */
        _connectTabSignals(actor) {
            if (!actor?.constructor?.$gtype) return;

            if (GObject.signal_lookup('set-main-tab-bar-visibility', actor.constructor.$gtype)) {
                this._currentTabVisibilitySignalId = actor.connect('set-main-tab-bar-visibility', (tabActor, isVisible) => {
                    this.emit('set-main-tab-bar-visibility', isVisible);
                });
            }

            if (GObject.signal_lookup('navigate-to-main-tab', actor.constructor.$gtype)) {
                this._currentTabNavigateSignalId = actor.connect('navigate-to-main-tab', (tabActor, targetTabName) => {
                    this.emit('navigate-to-main-tab', targetTabName);
                });
            }
        }

        /**
         * Gracefully disconnects all tracked layout signalling representations structurally inline.
         *
         * @param {Clutter.Actor} tabActor Instantiated event dispatcher element explicitly configured logically.
         * @private
         */
        _disconnectTabSignals(tabActor) {
            if (!tabActor?.constructor.$gtype) return;

            try {
                if (this._currentTabVisibilitySignalId > 0 && GObject.signal_lookup('set-main-tab-bar-visibility', tabActor.constructor.$gtype)) {
                    tabActor.disconnect(this._currentTabVisibilitySignalId);
                }
                if (this._currentTabNavigateSignalId > 0 && GObject.signal_lookup('navigate-to-main-tab', tabActor.constructor.$gtype)) {
                    tabActor.disconnect(this._currentTabNavigateSignalId);
                }
            } catch {
                // Ignore disconnect errors
            } finally {
                this._currentTabVisibilitySignalId = 0;
                this._currentTabNavigateSignalId = 0;
            }
        }

        /**
         * Schedules the tab to be selected after a short delay.
         *
         * @param {function} afterTabSelected Fallback operation evaluation natively injected.
         * @private
         */
        _scheduleTabSelected(afterTabSelected = null) {
            if (this._selectTabTimeoutId) {
                GLib.source_remove(this._selectTabTimeoutId);
            }
            this._selectTabTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 10, () => {
                const selectedActor = this._currentTabActor;
                selectedActor?.onTabSelected?.();
                if (typeof afterTabSelected === 'function') {
                    Promise.resolve(afterTabSelected(selectedActor)).catch((e) => {
                        console.error(`[AIO-Clipboard] Failed to apply tab post-selection hook: ${e?.message || e}`);
                    });
                }
                this._selectTabTimeoutId = 0;
                return GLib.SOURCE_REMOVE;
            });
        }

        // ========================================================================
        // Lifecycle
        // ========================================================================

        /**
         * Fires child menu termination hooks gracefully.
         */
        onMenuClosed() {
            if (this._currentTabActor && this._currentTabActor.get_stage()) {
                this._currentTabActor.onMenuClosed?.();
            }
        }

        /**
         * Clears the content area.
         */
        clearContent() {
            if (this._currentTabActor) {
                this._disconnectTabSignals(this._currentTabActor);
                this._currentTabActor.destroy();
                this._currentTabActor = null;
            }
            this._activeTabName = null;
        }

        /**
         * Destroys the content area.
         *
         * @override
         */
        destroy() {
            if (this._selectTabTimeoutId) {
                GLib.source_remove(this._selectTabTimeoutId);
                this._selectTabTimeoutId = 0;
            }
            if (this._currentTabActor) {
                this._disconnectTabSignals(this._currentTabActor);
            }
            this._currentTabActor?.destroy();
            this._currentTabActor = null;
            this._settings = null;
            this._extension = null;
            this._clipboardManager = null;
            super.destroy();
        }
    },
);
