import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { applySearchHandoffToTab } from '../services/serviceSearchHub.js';
import { FilePath } from '../constants/storagePaths.js';
import { IOFile } from '../utilities/utilityIO.js';
import { Logger } from '../utilities/utilityLogger.js';

import { getMenuSectionByLocalizedName, getMenuOrderedSections } from './menuRegistry.js';

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
                y_align: Clutter.ActorAlign.FILL,
                x_align: Clutter.ActorAlign.FILL,
                x_expand: true,
                y_expand: true,
            });
            this._settings = settings;
            this._extension = extension;
            this._clipboardManager = clipboardManager;

            this._tabWrapper = new Clutter.Actor({
                layout_manager: new Clutter.BinLayout(),
                clip_to_allocation: true,
                x_align: Clutter.ActorAlign.FILL,
                y_align: Clutter.ActorAlign.FILL,
                x_expand: true,
                y_expand: true,
            });
            this.set_child(this._tabWrapper);

            this._activeTabName = null;
            this._currentTabActor = null;
            this._isDestroyed = false;

            this._tabActors = new Map();
            this._tabLoadPromises = new Map();

            this._currentTabVisibilitySignalId = 0;
            this._currentTabNavigateSignalId = 0;
            this._preloadIdleId = 0;

            this._preloadIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._preloadIdleId = 0;
                if (!this._isDestroyed) {
                    this._preloadAllTabs().catch((e) => {
                        Logger.error(`Background tab preload failed: ${e.message}`);
                    });
                }
                return GLib.SOURCE_REMOVE;
            });
        }

        // ========================================================================
        // Focus Delegation
        // ========================================================================

        /**
         * Focuses the active tab's primary content element.
         */
        focusActiveTabContent() {
            this._currentTabActor?.onTabSelected?.();
        }

        // ========================================================================
        // Tab Selection
        // ========================================================================

        /**
         * Selects a tab and swaps in its content actor.
         *
         * @param {string} tabName Localized tab name.
         * @returns {Promise<void>} Resolves once selection work completes.
         */
        async selectTab(tabName) {
            if (!IOFile.mkdir(FilePath.DATA)) {
                return;
            }

            const oldActor = this._currentTabActor;

            try {
                if (this._activeTabName === tabName && oldActor) {
                    oldActor.onTabSelected?.();
                    return;
                }

                this._activeTabName = tabName;

                const cachedActor = this._tabActors.get(tabName);
                if (cachedActor) {
                    this._swapToTab(cachedActor, oldActor);
                    this._deferSearchHandoff(tabName, cachedActor);
                    return;
                }

                const newContentActor = await this._resolveAndCacheTab(tabName);

                if (!newContentActor || this._activeTabName !== tabName) {
                    return;
                }

                this._swapToTab(newContentActor, oldActor);
                this._deferSearchHandoff(tabName, newContentActor);
            } catch (e) {
                Logger.error(`Failed to load tab '${tabName}': ${e.message}\n${e.stack}`);

                this.emit('set-main-tab-bar-visibility', true);

                if (oldActor) {
                    this._releaseInactiveActor(oldActor);
                }

                if (this._activeTabName === tabName) {
                    const errorLabel = new St.Label({
                        text: `Error loading tab: ${e.message}`,
                        style_class: 'aio-clipboard-error-label',
                        x_align: Clutter.ActorAlign.CENTER,
                        y_align: Clutter.ActorAlign.CENTER,
                        x_expand: true,
                        y_expand: true,
                    });

                    this._tabWrapper.add_child(errorLabel);
                    this._currentTabActor = errorLabel;
                }
            }
        }

        /**
         * Swaps the visible tab actor.
         *
         * @param {Clutter.Actor} newActor Target actor.
         * @param {Clutter.Actor|null} oldActor Actor being replaced.
         * @private
         */
        _swapToTab(newActor, oldActor) {
            if (oldActor && oldActor !== newActor) {
                this._releaseInactiveActor(oldActor);
            }

            newActor.show();
            this._currentTabActor = newActor;

            this._connectTabSignals(newActor);

            this._notifyTabSelected();
        }

        /**
         * Applies search handoff asynchronously so tab swapping stays instant.
         *
         * @param {string} tabName Target tab name.
         * @param {Clutter.Actor} tabActor Target tab actor.
         * @private
         */
        _deferSearchHandoff(tabName, tabActor) {
            applySearchHandoffToTab({
                targetTab: tabName,
                tabActor,
            }).catch((e) => {
                Logger.error(`Search handoff failed for '${tabName}': ${e?.message || e}`);
            });
        }

        // ========================================================================
        // Module Loading
        // ========================================================================

        /**
         * Eagerly preloads all enabled tabs.
         *
         * @private
         */
        async _preloadAllTabs() {
            const sections = getMenuOrderedSections();
            const sectionsByName = new Map(sections.map((section) => [section.name(), section]));
            const orderedTabNames = this._settings.get_strv('tab-order').map((name) => _(name));
            const loadPromises = [];

            for (const tabName of orderedTabNames) {
                const section = sectionsByName.get(tabName);
                if (!section) {
                    continue;
                }
                const isEnabled = section.settingKey ? this._settings.get_boolean(section.settingKey) : true;

                if (isEnabled && !this._tabActors.has(tabName)) {
                    loadPromises.push(this._resolveAndCacheTab(tabName));
                }
            }

            await Promise.allSettled(loadPromises);
        }

        /**
         * Resolves and caches a tab actor.
         *
         * @param {string} tabName Localized tab name.
         * @returns {Promise<Clutter.Actor|null>} Cached tab actor.
         * @private
         */
        async _resolveAndCacheTab(tabName) {
            if (this._tabActors.has(tabName)) {
                return this._tabActors.get(tabName);
            }

            if (this._tabLoadPromises.has(tabName)) {
                return await this._tabLoadPromises.get(tabName);
            }

            const loadPromise = this._loadTabModule(tabName)
                .then((actor) => {
                    this._tabLoadPromises.delete(tabName);

                    if (this._isDestroyed || !actor) {
                        actor?.destroy();
                        return null;
                    }
                    actor.x_align = Clutter.ActorAlign.FILL;
                    actor.y_align = Clutter.ActorAlign.FILL;
                    actor.x_expand = true;
                    actor.y_expand = true;
                    actor.hide();
                    this._tabWrapper.add_child(actor);
                    this._tabActors.set(tabName, actor);
                    return actor;
                })
                .catch((e) => {
                    this._tabLoadPromises.delete(tabName);
                    Logger.error(`Failed to cache tab '${tabName}'`, e);
                    throw e;
                });

            this._tabLoadPromises.set(tabName, loadPromise);
            return await loadPromise;
        }

        /**
         * Returns whether an actor is one of the cached tab actors.
         *
         * @param {Clutter.Actor} actor Actor to inspect.
         * @returns {boolean} True when actor is cached in the tab map.
         * @private
         */
        _isCachedTabActor(actor) {
            for (const cachedActor of this._tabActors.values()) {
                if (cachedActor === actor) {
                    return true;
                }
            }
            return false;
        }

        /**
         * Releases a non-active actor while preserving cached tab instances.
         *
         * @param {Clutter.Actor} actor Actor to release.
         * @private
         */
        _releaseInactiveActor(actor) {
            if (!actor) {
                return;
            }

            this._disconnectTabSignals(actor);

            if (this._isCachedTabActor(actor)) {
                actor.hide();
            } else {
                actor.destroy();
            }
        }

        /**
         * Loads and instantiates the actor for a tab definition.
         *
         * @param {string} tabName Localized tab name.
         * @returns {Promise<Clutter.Actor>} Instantiated tab actor.
         * @throws {Error} Thrown when tab definition resolution fails.
         * @private
         */
        async _loadTabModule(tabName) {
            const sectionDef = getMenuSectionByLocalizedName(tabName);
            if (!sectionDef) {
                throw new Error(`[AIO-Clipboard] No layout definition found for tab: ${tabName}`);
            }

            if (!sectionDef.createContentActor) {
                throw new Error(`[AIO-Clipboard] Tab definition ${sectionDef.id} missing 'createContentActor' factory.`);
            }

            return await sectionDef.createContentActor(this._extension, this._settings, this._clipboardManager);
        }

        // ========================================================================
        // Signal Management
        // ========================================================================

        /**
         * Connects tab signals that should bubble up to the menu layer.
         *
         * @param {Clutter.Actor} actor Active tab actor.
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
         * Disconnects tracked signals from the previously active tab.
         *
         * @param {Clutter.Actor} tabActor Tab actor to disconnect.
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
         * Invokes tab-selected lifecycle hooks synchronously.
         *
         * @param {function|null} afterTabSelected Optional post-selection hook.
         * @private
         */
        _notifyTabSelected(afterTabSelected = null) {
            const selectedActor = this._currentTabActor;
            selectedActor?.onTabSelected?.();

            if (afterTabSelected) {
                Promise.resolve(afterTabSelected(selectedActor)).catch((e) => {
                    Logger.error(`Failed to apply tab post-selection hook: ${e?.message || e}`);
                });
            }
        }

        // ========================================================================
        // Lifecycle
        // ========================================================================

        /**
         * Forwards menu-close lifecycle events to cached tab actors.
         */
        onMenuClosed() {
            for (const actor of this._tabActors.values()) {
                if (actor && actor.get_stage() && actor.onMenuClosed) {
                    actor.onMenuClosed();
                }
            }
        }

        /**
         * Clears the content area.
         */
        clearContent() {
            if (this._currentTabActor) {
                this._disconnectTabSignals(this._currentTabActor);
            }
            this._tabActors.clear();
            this._tabLoadPromises.clear();
            if (this._tabWrapper) {
                this._tabWrapper.destroy_all_children();
            }

            this._currentTabActor = null;
            this._activeTabName = null;
        }

        /**
         * Destroys the content area.
         *
         * @override
         */
        destroy() {
            this._isDestroyed = true;
            if (this._preloadIdleId) {
                GLib.source_remove(this._preloadIdleId);
                this._preloadIdleId = 0;
            }
            this.clearContent();

            this._tabWrapper?.destroy();
            this._tabWrapper = null;

            this._settings = null;
            this._extension = null;
            this._clipboardManager = null;

            super.destroy();
        }
    },
);
