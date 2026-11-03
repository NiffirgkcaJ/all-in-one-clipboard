import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import { applySearchHandoffToTab } from '../services/serviceSearchHub.js';
import { FilePath } from '../constants/storagePaths.js';
import { IOFile } from '../utilities/utilityIO.js';
import { Logger } from '../utilities/utilityLogger.js';
import { resolveMenuSection } from './menuRegistry.js';

/**
 * The content area of the menu, which displays the active tab.
 */
export const MenuContentArea = GObject.registerClass(
    {
        Signals: {
            'set-main-tab-bar-visibility': { param_types: [GObject.TYPE_BOOLEAN] },
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

            this._tabActors = new Map();
            this._tabLoadPromises = new Map();

            this._currentTabVisibilitySignalId = 0;
            this._preloadIdleId = 0;

            this._preloadIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._preloadIdleId = 0;
                this._preloadAllTabs().catch((e) => {
                    Logger.error(`Background tab preload failed: ${e.message}`);
                });
                return GLib.SOURCE_REMOVE;
            });
        }

        // ========================================================================
        // Focus Delegation
        // ========================================================================

        /**
         * Focuses the active tab's primary content element for keyboard navigation.
         */
        focusActiveTabContent() {
            if (!this._currentTabActor) {
                return;
            }

            if (this._currentTabActor.focusTopContent) {
                this._currentTabActor.focusTopContent();
                return;
            }

            this._currentTabActor.onTabSelected();
        }

        /**
         * Focuses the active tab's bottom-most content element when wrapping backward from the main tab bar.
         */
        focusActiveTabBottomContent() {
            if (!this._currentTabActor) {
                return;
            }

            if (this._currentTabActor.focusBottomContent) {
                this._currentTabActor.focusBottomContent();
                return;
            }

            this.focusActiveTabContent();
        }

        // ========================================================================
        // Tab Selection
        // ========================================================================

        /**
         * Selects a tab and swaps in its content actor.
         *
         * @param {string} tabIdentifier Canonical ID or localized tab name.
         * @returns {Promise<void>} Resolves once selection work completes.
         */
        async selectTab(tabIdentifier) {
            if (!IOFile.mkdir(FilePath.DATA)) {
                return;
            }

            const sectionDef = resolveMenuSection(tabIdentifier);
            const canonicalId = sectionDef ? sectionDef.id : tabIdentifier;
            const oldActor = this._currentTabActor;

            try {
                if (this._activeTabName === canonicalId && oldActor) {
                    oldActor.onTabSelected();
                    return;
                }

                this._activeTabName = canonicalId;

                const cachedActor = this._tabActors.get(canonicalId);
                if (cachedActor) {
                    this._swapToTab(cachedActor, oldActor);
                    this._deferSearchHandoff(canonicalId, cachedActor);
                    return;
                }

                const newContentActor = await this._resolveAndCacheTab(canonicalId);

                if (!newContentActor || this._activeTabName !== canonicalId) {
                    return;
                }

                this._swapToTab(newContentActor, oldActor);
                this._deferSearchHandoff(canonicalId, newContentActor);
            } catch (e) {
                Logger.error(`Failed to load tab '${canonicalId}': ${e.message}\n${e.stack}`);

                this.emit('set-main-tab-bar-visibility', true);

                if (oldActor) {
                    this._releaseInactiveActor(oldActor);
                }

                if (this._activeTabName === canonicalId) {
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
         * @param {string} canonicalId Target canonical tab ID.
         * @param {Clutter.Actor} tabActor Target tab actor.
         * @private
         */
        _deferSearchHandoff(canonicalId, tabActor) {
            applySearchHandoffToTab({
                targetTab: canonicalId,
                tabActor,
            }).catch((e) => {
                Logger.error(`Search handoff failed for '${canonicalId}': ${e?.message || e}`);
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
            const orderedTabIds = this._settings.get_strv('tab-order');
            const loadPromises = [];

            for (const tabIdentifier of orderedTabIds) {
                const section = resolveMenuSection(tabIdentifier);
                if (!section) {
                    continue;
                }
                const canonicalId = section.id;
                const isEnabled = section.settingKey ? this._settings.get_boolean(section.settingKey) : true;

                if (isEnabled && !this._tabActors.has(canonicalId)) {
                    loadPromises.push(this._resolveAndCacheTab(canonicalId));
                }
            }

            await Promise.allSettled(loadPromises);
        }

        /**
         * Resolves and caches a tab actor.
         *
         * @param {string} canonicalId Canonical tab ID.
         * @returns {Promise<Clutter.Actor|null>} Cached tab actor.
         * @private
         */
        async _resolveAndCacheTab(canonicalId) {
            if (this._tabActors.has(canonicalId)) {
                return this._tabActors.get(canonicalId);
            }

            if (this._tabLoadPromises.has(canonicalId)) {
                return await this._tabLoadPromises.get(canonicalId);
            }

            const loadPromise = this._loadTabModule(canonicalId)
                .then((actor) => {
                    this._tabLoadPromises.delete(canonicalId);

                    if (!this._tabWrapper || !actor) {
                        if (actor) {
                            actor.destroy();
                        }
                        return null;
                    }
                    actor.x_align = Clutter.ActorAlign.FILL;
                    actor.y_align = Clutter.ActorAlign.FILL;
                    actor.x_expand = true;
                    actor.y_expand = true;
                    actor.hide();
                    this._tabWrapper.add_child(actor);
                    this._tabActors.set(canonicalId, actor);
                    return actor;
                })
                .catch((e) => {
                    this._tabLoadPromises.delete(canonicalId);
                    Logger.error(`Failed to cache tab '${canonicalId}'`, e);
                    throw e;
                });

            this._tabLoadPromises.set(canonicalId, loadPromise);
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
         * @param {string} canonicalId Canonical tab ID or localized tab name.
         * @returns {Promise<Clutter.Actor>} Instantiated tab actor.
         * @throws {Error} Thrown when tab definition resolution fails.
         * @private
         */
        async _loadTabModule(canonicalId) {
            const sectionDef = resolveMenuSection(canonicalId);
            Logger.assert(sectionDef, `No layout definition found for tab: ${canonicalId}`, 'MenuContentArea');
            Logger.assert(sectionDef.createContentActor, `Tab definition ${sectionDef.id} missing 'createContentActor' factory.`, 'MenuContentArea');

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
            } catch {
                // Ignore disconnect errors.
            } finally {
                this._currentTabVisibilitySignalId = 0;
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
            if (selectedActor && typeof selectedActor.onTabSelected === 'function') {
                selectedActor.onTabSelected();
            }

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
            if (this._preloadIdleId) {
                GLib.source_remove(this._preloadIdleId);
                this._preloadIdleId = 0;
            }
            this.clearContent();

            if (this._tabWrapper) {
                this._tabWrapper.destroy();
                this._tabWrapper = null;
            }

            this._settings = null;
            this._extension = null;
            this._clipboardManager = null;

            super.destroy();
        }
    },
);
