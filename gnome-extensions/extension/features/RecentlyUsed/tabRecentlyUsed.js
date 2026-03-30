import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Soup from 'gi://Soup';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { FilePath } from '../../shared/constants/storagePaths.js';

import { GifDownloadService } from '../GIF/logic/gifDownloadService.js';
import { handleRecentlyUsedItemClick } from './utilities/recentlyUsedInteractions.js';
import { PinnedNestedScrollView } from './utilities/recentlyUsedPinnedNestedScrollView.js';
import { RecentlyUsedViewRenderer } from './view/recentlyUsedViewRenderer.js';
import { focusRecentlyUsedBestCandidate, handleRecentlyUsedKeyPress } from './utilities/recentlyUsedFocusNavigation.js';
import { createFullWidthClipboardButton, createGridButton } from './utilities/recentlyUsedItemWidgets.js';
import { RecentlyUsedScrollLockController } from './utilities/recentlyUsedScrollLockController.js';
import { createRecentManagers, connectRecentlyUsedSignals, disconnectTrackedSignalsSafely } from './utilities/recentlyUsedDataBinding.js';
import { renderPinnedSection as renderPinnedClipboardSection } from './utilities/recentlyUsedPinnedSectionRenderer.js';
import { buildRecentlyUsedSection } from './utilities/recentlyUsedSectionBuilder.js';
import { renderGridSection, renderListSection } from './utilities/recentlyUsedSectionRenderer.js';
import { RecentlyUsedUI, RecentlyUsedSections, RecentlyUsedSettings, RecentlyUsedFeatures, RecentlyUsedStyles } from './constants/recentlyUsedConstants.js';

// ============================================================================
// RecentlyUsedTabContent Class
// ============================================================================

/**
 * A tabbed interface displaying recently used items across multiple categories:
 * pinned clipboard items, emojis, GIFs, kaomojis, symbols, and clipboard history.
 *
 * Supports keyboard navigation with arrow keys and includes a floating settings button.
 *
 * @fires set-main-tab-bar-visibility - Emitted to control main tab bar visibility
 * @fires navigate-to-main-tab - Emitted when requesting navigation to another tab
 */
export const RecentlyUsedTabContent = GObject.registerClass(
    {
        Signals: {
            'set-main-tab-bar-visibility': { param_types: [GObject.TYPE_BOOLEAN] },
            'navigate-to-main-tab': { param_types: [GObject.TYPE_STRING] },
        },
    },
    class RecentlyUsedTabContent extends St.BoxLayout {
        /**
         * Initialize the Recently Used tab content
         *
         * @param {object} extension - The GNOME Shell extension instance
         * @param {Gio.Settings} settings - Extension settings
         * @param {object} clipboardManager - Manager for clipboard operations
         */
        constructor(extension, settings, clipboardManager) {
            super({
                vertical: true,
                style_class: RecentlyUsedStyles.TAB_CONTENT,
                x_expand: true,
                y_expand: true,
            });

            this._httpSession = new Soup.Session();
            this._gifDownloadService = new GifDownloadService(this._httpSession);

            this._gifCacheDir = FilePath.GIF_PREVIEWS;

            this._extension = extension;
            this._settings = settings;
            this._clipboardManager = clipboardManager;
            this._settingsBtnFocusTimeoutId = 0;
            this._focusIdleId = 0;
            this._scrollIntoViewIdleId = 0;

            this._imagePreviewSize = this._settings.get_int(RecentlyUsedSettings.CLIPBOARD_IMAGE_PREVIEW_SIZE);
            this._recentManagers = {};
            this._signalIds = [];
            this._sections = {};
            this._focusGrid = [];
            this._renderSession = null;
            this._scrollLockController = null;
            this._pinnedWidgets = new Set();
            this._previousFocus = null;
            this._lockTimeoutId = null;

            this._buildUI();

            this.initializationPromise = this._loadRecentManagers()
                .then(() => {
                    if (this._mainContainer) {
                        this._connectSignalsAndRender();
                    }
                })
                .catch((e) => console.error('[AIO-Clipboard] Failed to load recent managers:', e));
        }

        // ========================================================================
        // UI Construction
        // ========================================================================

        /**
         * Build the main UI structure with scrollable content and floating settings button
         * @private
         */
        _buildUI() {
            const wrapper = new St.Widget({
                layout_manager: new Clutter.BinLayout(),
                x_expand: true,
                y_expand: true,
            });
            this.add_child(wrapper);

            this._scrollView = new St.ScrollView({
                hscrollbar_policy: St.PolicyType.NEVER,
                vscrollbar_policy: St.PolicyType.AUTOMATIC,
                x_expand: true,
                y_expand: true,
                overlay_scrollbars: true,
                visible: false,
            });
            this._scrollLockController = new RecentlyUsedScrollLockController(this._scrollView);

            this._scrollView.connect('scroll-event', () => {
                this._unlockOuterScroll();
                return Clutter.EVENT_PROPAGATE;
            });

            wrapper.add_child(this._scrollView);

            this._mainContainer = new St.BoxLayout({
                vertical: true,
                style_class: RecentlyUsedStyles.CONTAINER,
            });
            this._scrollView.set_child(this._mainContainer);

            this._emptyView = RecentlyUsedViewRenderer.createEmptyView();
            wrapper.add_child(this._emptyView);

            this._settingsBtn = RecentlyUsedViewRenderer.createSettingsButton();
            this._settingsBtn.connect('clicked', () => {
                const returnValue = this._extension.openPreferences();

                if (returnValue && typeof returnValue.catch === 'function') {
                    returnValue.catch(() => {});
                }
            });
            wrapper.add_child(this._settingsBtn);

            this._addSection(RecentlyUsedSections.PINNED);
            this._addSection(RecentlyUsedSections.EMOJI);
            this._addSection(RecentlyUsedSections.GIF);
            this._addSection(RecentlyUsedSections.KAOMOJI);
            this._addSection(RecentlyUsedSections.SYMBOLS);
            this._addSection(RecentlyUsedSections.CLIPBOARD);

            this.reactive = true;
            this.connect('key-press-event', this._onKeyPress.bind(this));
        }

        /**
         * Add a collapsible section with header and "Show All" button
         *
         * @param {object} sectionConfig - Section configuration from RecentlyUsedSections
         * @private
         */
        _addSection(sectionConfig) {
            this._sections[sectionConfig.id] = buildRecentlyUsedSection({
                mainContainer: this._mainContainer,
                sectionConfig,
                scrollView: this._scrollView,
                onNavigateToMainTab: (tabName) => {
                    this.emit('navigate-to-main-tab', tabName);
                },
                onUnlockOuterScroll: () => {
                    this._unlockOuterScroll();
                },
                getScrollIntoViewIdleId: () => this._scrollIntoViewIdleId,
                setScrollIntoViewIdleId: (id) => {
                    this._scrollIntoViewIdleId = id;
                },
                setPreviousFocus: (actor) => {
                    this._previousFocus = actor;
                },
            });
        }

        // ========================================================================
        // Data Management
        // ========================================================================

        /**
         * Initialize recent item managers for emoji, kaomoji, symbols, and GIF features
         * @private
         * @async
         */
        async _loadRecentManagers() {
            const features = [RecentlyUsedFeatures.EMOJI, RecentlyUsedFeatures.KAOMOJI, RecentlyUsedFeatures.SYMBOLS, RecentlyUsedFeatures.GIF];

            this._recentManagers = createRecentManagers({
                extensionUuid: this._extension.uuid,
                settings: this._settings,
                features,
            });
        }

        /**
         * Connect to data change signals and perform initial render
         * @private
         */
        _connectSignalsAndRender() {
            this._signalIds = connectRecentlyUsedSignals({
                clipboardManager: this._clipboardManager,
                recentManagers: this._recentManagers,
                onRender: () => {
                    this._renderAll();
                },
            });

            this.onTabSelected();
        }

        // ========================================================================
        // Rendering
        // ========================================================================

        /**
         * Re-render all sections and rebuild the focus grid
         * @private
         */
        _renderAll() {
            this._renderSession = {};
            this._focusGrid = [];

            for (const id in this._sections) {
                this._sections[id].separator.visible = false;
            }

            this._renderPinnedSection();
            this._renderGridSection('emoji');
            this._renderGridSection('gif');
            this._renderListSection('kaomoji');
            this._renderGridSection('symbols');
            this._renderListSection('clipboard');

            const visibleSections = RecentlyUsedUI.SECTION_ORDER.map((id) => this._sections[id]).filter((s) => s && s.section.visible);

            if (visibleSections.length === 0) {
                this._scrollView.visible = false;
                this._emptyView.visible = true;
            } else {
                this._scrollView.visible = true;
                this._emptyView.visible = false;

                for (let i = 1; i < visibleSections.length; i++) {
                    visibleSections[i].separator.visible = true;
                }
            }

            this._focusGrid.push([this._settingsBtn]);
        }

        /**
         * Render the pinned clipboard items section
         * @private
         */
        _renderPinnedSection() {
            this._pinnedWidgets = renderPinnedClipboardSection({
                sections: this._sections,
                clipboardManager: this._clipboardManager,
                focusGrid: this._focusGrid,
                createFullWidthClipboardItem: this._createFullWidthClipboardItem.bind(this),
                recentlyUsedUI: RecentlyUsedUI,
                createPinnedNestedScrollView: () =>
                    new PinnedNestedScrollView({
                        hscrollbar_policy: St.PolicyType.NEVER,
                        vscrollbar_policy: St.PolicyType.AUTOMATIC,
                        overlay_scrollbars: true,
                        x_expand: true,
                    }),
                configurePinnedScrollHandoff: (scrollView) => {
                    this._configurePinnedScrollHandoff(scrollView);
                },
                unlockOuterScroll: () => {
                    this._unlockOuterScroll();
                },
                lockOuterScroll: () => {
                    this._lockOuterScroll();
                },
                scrollView: this._scrollView,
                getPreviousFocus: () => this._previousFocus,
                setPreviousFocus: (actor) => {
                    this._previousFocus = actor;
                },
                getScrollIntoViewIdleId: () => this._scrollIntoViewIdleId,
                setScrollIntoViewIdleId: (id) => {
                    this._scrollIntoViewIdleId = id;
                },
                setLockTimeoutId: (id) => {
                    this._lockTimeoutId = id;
                },
            });
        }

        /**
         * Wire nested pinned scroll handoff callbacks for parent lock behavior.
         *
         * @param {PinnedNestedScrollView} pinnedScrollView Nested pinned list scroll view
         * @private
         */
        _configurePinnedScrollHandoff(pinnedScrollView) {
            this._scrollLockController?.configurePinnedScrollHandoff(pinnedScrollView);
        }

        /**
         * Render a list-style section (kaomoji or clipboard)
         *
         * @param {string} id - Section identifier ('kaomoji' or 'clipboard')
         * @private
         */
        _renderListSection(id) {
            renderListSection({
                id,
                sections: this._sections,
                settings: this._settings,
                recentManagers: this._recentManagers,
                clipboardManager: this._clipboardManager,
                focusGrid: this._focusGrid,
                createFullWidthClipboardItem: this._createFullWidthClipboardItem.bind(this),
            });
        }

        /**
         * Render a grid-style section (emoji, GIF, or symbols)
         *
         * @param {string} id - Section identifier
         * @private
         */
        _renderGridSection(id) {
            renderGridSection({
                id,
                sections: this._sections,
                settings: this._settings,
                recentManagers: this._recentManagers,
                focusGrid: this._focusGrid,
                createGridItem: this._createGridItem.bind(this),
                renderSession: this._renderSession,
                gifDownloadService: this._gifDownloadService,
                gifCacheDir: this._gifCacheDir,
                currentRenderSession: () => this._renderSession,
            });
        }

        // ========================================================================
        // Widget Creation
        // ========================================================================

        /**
         * Create a full-width list item button for clipboard/kaomoji content
         *
         * @param {object} itemData - Item data containing type, preview, etc.
         * @param {boolean} isPinned - Whether item is pinned, which affects click behavior
         * @param {string} feature - Feature type ('clipboard', 'kaomoji', etc.)
         * @returns {St.Button} The created button widget
         * @private
         */
        _createFullWidthClipboardItem(itemData, isPinned, feature = 'clipboard') {
            return createFullWidthClipboardButton({
                itemData,
                isPinned,
                feature,
                clipboardManager: this._clipboardManager,
                imagePreviewSize: this._imagePreviewSize,
                onItemClicked: (payload, clickedFeature) => {
                    this._onItemClicked(payload, clickedFeature);
                },
                unlockOuterScroll: () => {
                    this._unlockOuterScroll();
                },
                scrollView: this._scrollView,
                getScrollIntoViewIdleId: () => this._scrollIntoViewIdleId,
                setScrollIntoViewIdleId: (id) => {
                    this._scrollIntoViewIdleId = id;
                },
            });
        }

        /**
         * Create a grid item button for emoji/GIF/symbol content
         *
         * @param {object} itemData - Item data
         * @param {string} feature - Feature type ('emoji', 'gif', 'symbols')
         * @returns {St.Button} The created button widget
         * @private
         */
        _createGridItem(itemData, feature) {
            return createGridButton({
                itemData,
                feature,
                onItemClicked: (payload, clickedFeature) => {
                    this._onItemClicked(payload, clickedFeature);
                },
                unlockOuterScroll: () => {
                    this._unlockOuterScroll();
                },
                scrollView: this._scrollView,
                getScrollIntoViewIdleId: () => this._scrollIntoViewIdleId,
                setScrollIntoViewIdleId: (id) => {
                    this._scrollIntoViewIdleId = id;
                },
            });
        }

        // ========================================================================
        // User Interactions
        // ========================================================================

        /**
         * Handle item click: copy to clipboard and optionally trigger auto-paste
         *
         * @param {object} itemData - Item data
         * @param {string} feature - Feature type for auto-paste settings lookup
         * @private
         * @async
         */
        async _onItemClicked(itemData, feature) {
            await handleRecentlyUsedItemClick({
                itemData,
                feature,
                clipboardManager: this._clipboardManager,
                gifDownloadService: this._gifDownloadService,
                settings: this._settings,
                recentManagers: this._recentManagers,
                extension: this._extension,
            });
        }

        /**
         * Lock the outer scroll view to prevent automatic focus tracking
         * @private
         */
        _lockOuterScroll() {
            if (this._lockTimeoutId) {
                GLib.source_remove(this._lockTimeoutId);
                this._lockTimeoutId = null;
            }

            this._scrollLockController?.lock();
        }

        /**
         * Unlock the outer scroll view to allow normal scrolling
         * @private
         */
        _unlockOuterScroll() {
            if (this._lockTimeoutId) {
                GLib.source_remove(this._lockTimeoutId);
                this._lockTimeoutId = null;
            }

            this._scrollLockController?.unlock();
        }

        /**
         * Safely disconnect tracked signals, skipping invalid or stale handlers.
         * @private
         */
        _disconnectTrackedSignalsSafely() {
            this._signalIds = disconnectTrackedSignalsSafely(this._signalIds);
        }

        /**
         * Handle keyboard navigation with arrow keys
         *
         * @param {Clutter.Actor} actor - The actor that received the key press
         * @param {Clutter.Event} event - The key press event
         * @returns {Clutter.EventPropagation} EVENT_STOP or EVENT_PROPAGATE
         * @private
         */
        _onKeyPress(actor, event) {
            return handleRecentlyUsedKeyPress({
                event,
                focusGrid: this._focusGrid,
                settingsBtn: this._settingsBtn,
                onUnlockOuterScroll: () => this._unlockOuterScroll(),
                settingsBtnFocusTimeoutId: this._settingsBtnFocusTimeoutId,
                setSettingsBtnFocusTimeoutId: (id) => {
                    this._settingsBtnFocusTimeoutId = id;
                },
            });
        }

        // ========================================================================
        // Lifecycle
        // ========================================================================

        /**
         * Called when tab becomes active - show tab bar and render content
         */
        onTabSelected() {
            this._tabVisCheckIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this.emit('set-main-tab-bar-visibility', true);
                this._tabVisCheckIdleId = 0;
                return GLib.SOURCE_REMOVE;
            });

            this._renderAll();

            this._unlockOuterScroll();

            if (this._restoreFocusTimeoutId) {
                GLib.source_remove(this._restoreFocusTimeoutId);
                this._restoreFocusTimeoutId = 0;
            }
            this._restoreFocusTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                this._restoreFocus();
                this._restoreFocusTimeoutId = 0;
                return GLib.SOURCE_REMOVE;
            });
        }

        /**
         * Helper method to intelligently restore focus to the first content item
         * @private
         */
        _restoreFocus() {
            if (this._focusIdleId) {
                GLib.source_remove(this._focusIdleId);
                this._focusIdleId = 0;
            }

            this._focusIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._focusIdleId = 0;
                if (this._focusGrid.length === 0) {
                    return GLib.SOURCE_REMOVE;
                }

                focusRecentlyUsedBestCandidate({
                    focusGrid: this._focusGrid,
                    sections: this._sections,
                    settingsBtn: this._settingsBtn,
                });

                return GLib.SOURCE_REMOVE;
            });
        }

        /**
         * Cleanup: disconnect all signals and destroy managers
         */
        destroy() {
            if (this._settingsBtnFocusTimeoutId) {
                GLib.source_remove(this._settingsBtnFocusTimeoutId);
                this._settingsBtnFocusTimeoutId = 0;
            }
            if (this._lockTimeoutId) {
                GLib.source_remove(this._lockTimeoutId);
                this._lockTimeoutId = 0;
            }
            if (this._focusIdleId) {
                GLib.source_remove(this._focusIdleId);
                this._focusIdleId = 0;
            }
            if (this._scrollIntoViewIdleId) {
                GLib.source_remove(this._scrollIntoViewIdleId);
                this._scrollIntoViewIdleId = 0;
            }
            if (this._httpSession) {
                this._httpSession.abort();
                this._httpSession = null;
            }

            if (this._gifDownloadService) {
                this._gifDownloadService = null;
            }

            if (this._scrollLockController) {
                this._scrollLockController.destroy();
                this._scrollLockController = null;
            }

            this._disconnectTrackedSignalsSafely();

            if (this._tabVisCheckIdleId) {
                GLib.source_remove(this._tabVisCheckIdleId);
                this._tabVisCheckIdleId = 0;
            }
            if (this._restoreFocusTimeoutId) {
                GLib.source_remove(this._restoreFocusTimeoutId);
                this._restoreFocusTimeoutId = 0;
            }

            Object.values(this._recentManagers).forEach((m) => m?.destroy());

            this._renderSession = null;
            this._mainContainer = null;
            this._pinnedWidgets = null;

            super.destroy();
        }
    },
);
