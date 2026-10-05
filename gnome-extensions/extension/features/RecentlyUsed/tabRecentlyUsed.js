import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import { Logger } from '../../shared/utilities/utilityLogger.js';

import { RecentlyUsedBaseView } from './view/recentlyUsedBaseView.js';
import { RecentlyUsedRuntimeService } from './registry/recentlyUsedRuntimeService.js';

/**
 * Hosts and coordinates the Recently Used tab view.
 *
 * @fires set-main-tab-bar-visibility Emitted when tab bar visibility should change.
 */
export const RecentlyUsedTabContent = GObject.registerClass(
    {
        Signals: {
            'set-main-tab-bar-visibility': { param_types: [GObject.TYPE_BOOLEAN] },
        },
    },
    class RecentlyUsedTabContent extends St.Bin {
        /**
         * Creates the tab content widget.
         *
         * @param {object} extension Extension instance.
         * @param {Gio.Settings} settings Extension settings object.
         */
        constructor(extension, settings) {
            super({
                y_align: Clutter.ActorAlign.FILL,
                x_align: Clutter.ActorAlign.FILL,
                x_expand: true,
                y_expand: true,
            });

            this._extension = extension;
            this._settings = settings;

            this._runtimeService = null;
            this._view = null;
            this._tabVisCheckIdleId = 0;

            this.initializationPromise = this._initialize();
        }

        // ========================================================================
        // Initialization
        // ========================================================================

        /**
         * Initializes runtime services and builds the view.
         *
         * @returns {Promise<void>} Resolves when initialization completes.
         * @private
         * @async
         */
        async _initialize() {
            try {
                this._runtimeService = new RecentlyUsedRuntimeService({
                    extension: this._extension,
                    settings: this._settings,
                    onRender: () => {
                        if (this._view) {
                            this._view.requestRender();
                        }
                    },
                });
                await this._runtimeService.start();

                this._createView();
            } catch (e) {
                Logger.error('Failed to initialize RecentlyUsed tab', e);
            }
        }

        /**
         * Creates and wires the base view.
         *
         * @private
         */
        _createView() {
            this._view = new RecentlyUsedBaseView({
                settings: this._settings,
                extension: this._extension,
                sectionProvider: {
                    getSectionOrder: () => this._runtimeService.getSectionOrder(),
                    getSectionScaffold: (sectionId) => this._runtimeService.getSectionScaffold(sectionId),
                    getSectionRenderModel: (sectionId, runtimeContext) => this._runtimeService.getSectionRenderModel(sectionId, runtimeContext),
                },
                onItemClicked: (itemData, feature) => this._onItemClicked(itemData, feature),
                onOpenPreferences: () => {
                    const returnValue = this._extension.openPreferences();
                    if (returnValue && returnValue.catch) {
                        returnValue.catch(() => {});
                    }
                },
            });

            this.set_child(this._view);
        }

        // ========================================================================
        // User Interactions
        // ========================================================================

        /**
         * Handles item click events from the view.
         *
         * @param {object} itemData Clicked item payload.
         * @param {string} feature Section identifier.
         * @returns {Promise<void>} Resolves after click handling.
         * @private
         * @async
         */
        async _onItemClicked(itemData, feature) {
            await this._runtimeService.handleItemClick(itemData, feature);

            this._closeMenuSafely();
        }

        /**
         * Closes the extension menu when available.
         *
         * @private
         */
        _closeMenuSafely() {
            const menu = this._extension?._indicator?.menu;
            if (!menu || !menu.close) {
                return;
            }

            try {
                menu.close();
            } catch {
                // Ignore menu lifecycle races during shell teardown.
            }
        }

        // ========================================================================
        // Lifecycle
        // ========================================================================

        /**
         * Activates the tab and restores expected focus behavior.
         */
        onTabSelected() {
            if (this._tabVisCheckIdleId) {
                GLib.source_remove(this._tabVisCheckIdleId);
                this._tabVisCheckIdleId = 0;
            }
            this._tabVisCheckIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this.emit('set-main-tab-bar-visibility', true);
                this._tabVisCheckIdleId = 0;
                return GLib.SOURCE_REMOVE;
            });

            this._view?.onActivated();
        }

        /**
         * Focuses the top-most content element when navigating from the main tab bar.
         *
         * @returns {boolean} True if an element was focused.
         */
        focusTopContent() {
            return this._view ? this._view.focusTopContent() : false;
        }

        /**
         * Focuses the bottom-most content element when navigating backward from the main tab bar.
         *
         * @returns {boolean} True if an element was focused.
         */
        focusBottomContent() {
            return this._view ? this._view.focusBottomContent() : false;
        }

        /**
         * Cleans up view state when the menu is closed.
         */
        onMenuClosed() {
            if (this._view) {
                this._view.onMenuClosed();
            }
        }

        /**
         * Releases resources associated with this tab.
         */
        destroy() {
            if (this._tabVisCheckIdleId) {
                GLib.source_remove(this._tabVisCheckIdleId);
                this._tabVisCheckIdleId = 0;
            }

            if (this._runtimeService) {
                this._runtimeService.stop();
                this._runtimeService = null;
            }

            if (this._view) {
                this._view.destroy();
                this._view = null;
            }

            this._settings = null;
            this._extension = null;

            super.destroy();
        }
    },
);
