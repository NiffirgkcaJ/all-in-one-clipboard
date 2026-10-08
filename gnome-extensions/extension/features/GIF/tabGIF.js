import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { createStaticIcon } from '../../shared/utilities/utilityIcon.js';
import { FilePath } from '../../shared/constants/storagePaths.js';
import { FocusUtils } from '../../shared/utilities/utilityFocus.js';
import { IOFile } from '../../shared/utilities/utilityIO.js';
import { mapLayout } from '../../shared/utilities/utilityLayout.js';
import { MenuNavigationService } from '../../shared/services/serviceNavigation.js';
import { SearchComponent } from '../../shared/utilities/utilitySearch.js';

import { ensureGifSearchProviderRegistered } from './integrations/gifSearchProvider.js';
import { GifContentView } from './view/gifContentView.js';
import { GifDownloadService } from './services/gifDownloadService.js';
import { GifFetchService } from './services/gifFetchService.js';
import { GifHeaderView } from './view/gifHeaderView.js';
import { GifHttpService } from './services/gifHttpService.js';
import { GifItemFactory } from './view/gifItemFactory.js';
import { GifManager } from './managers/gifManager.js';
import { GifRuntimeService } from './services/gifRuntimeService.js';
import { GifSearchService } from './services/gifSearchService.js';
import { GifSelectionService } from './services/gifSelectionService.js';
import { GifIcons, GifUI } from './constants/gifConstants.js';

/**
 * GIFTabContent
 *
 * It strictly handles the top-level UI layout and instantiates the components.
 * It delegates feature-specific orchestration to dedicated services.
 *
 * @fires set-main-tab-bar-visibility Emitted to show/hide the main tab bar.
 */
export const GIFTabContent = GObject.registerClass(
    {
        Signals: {
            'set-main-tab-bar-visibility': { param_types: [GObject.TYPE_BOOLEAN] },
        },
    },
    class GIFTabContent extends St.BoxLayout {
        // ========================================================================
        // Initialization
        // ========================================================================

        /**
         * Initialize the GIF tab container.
         *
         * @param {object} extension The extension instance.
         * @param {Gio.Settings} settings Extension settings.
         * @param {ClipboardManager} clipboardManager The clipboard manager instance.
         */
        constructor(extension, settings, clipboardManager) {
            super({
                ...mapLayout({
                    vertical: true,
                    expand: true,
                }),
                style_class: 'gif-tab-content',
                reactive: true,
            });

            this._extension = extension;
            this._settings = settings;

            this._cacheDir = FilePath.GIF_PREVIEWS;
            IOFile.mkdir(this._cacheDir);

            // Single HTTP layer for the entire module.
            this._httpService = new GifHttpService();
            this._gifManager = new GifManager(settings, extension.uuid, extension.path, this._httpService);
            this._downloadService = new GifDownloadService(this._httpService);

            ensureGifSearchProviderRegistered({
                settings,
                extensionUuid: extension.uuid,
                extensionPath: extension.path,
                gifManager: this._gifManager,
            });

            this._buildUI();

            this._fetchService = new GifFetchService(this._gifManager);

            this._searchService = new GifSearchService({
                searchComponent: this._searchComponent,
                fetchService: this._fetchService,
                contentView: this._contentView,
            });

            this._selectionService = new GifSelectionService(extension, settings, clipboardManager, this._downloadService);

            this._runtimeService = new GifRuntimeService(settings, {
                headerView: this._headerView,
                contentView: this._contentView,
                searchComponent: this._searchComponent,
                infoBar: this._infoBar,
                gifManager: this._gifManager,
                fetchService: this._fetchService,
                searchService: this._searchService,
                selectionService: this._selectionService,
            });

            this._capturedEventId = this.connect('captured-event', (actor, event) => {
                return this._runtimeService.handleGlobalEvent(event);
            });

            this._runtimeService.loadInitialData();
        }

        // ========================================================================
        // UI Construction
        // ========================================================================

        /**
         * Build the orchestrated UI components.
         * @private
         */
        _buildUI() {
            this._headerView = new GifHeaderView(this._settings);

            this._headerView.connect('navigate-previous', () => {
                if (!MenuNavigationService.focusTabBar('last')) {
                    this._contentView.focusLastItem();
                }
            });

            this._headerView.connect('navigate-down', () => {
                FocusUtils.tryFocusChain([() => this._searchComponent.grabFocus(), () => this._contentView.focusFirstItem()]);
            });

            this._headerView.connect('navigate-next', () => {
                const focused = FocusUtils.tryFocusChain([() => this._searchComponent.grabFocus(), () => this._contentView.focusFirstItem()]);
                if (!focused) {
                    MenuNavigationService.focusTabBar('first');
                }
            });
            this.add_child(this._headerView);

            this._buildInfoBar();
            this.add_child(this._infoBar);

            this._buildSearchBar();

            this._itemFactory = new GifItemFactory(this._downloadService, this._cacheDir);
            this._contentView = new GifContentView(this._settings, this._itemFactory);

            this._itemFactory.setScrollView(this._contentView.getScrollView());

            this._contentView.connect('navigate-up', () => {
                const focused = FocusUtils.tryFocusChain([() => this._searchComponent.grabFocus(), () => this._headerView.focusActive()]);
                if (!focused) {
                    MenuNavigationService.focusTabBar('active');
                }
            });

            this._contentView.connect('navigate-next', () => {
                if (!MenuNavigationService.focusTabBar('first')) {
                    this._headerView.focusFirst();
                }
            });

            this.add_child(this._contentView);
        }

        /**
         * Build the info bar.
         * @private
         */
        _buildInfoBar() {
            this._infoBar = new St.BoxLayout({
                ...mapLayout({
                    horizontal: true,
                    x_expand: true,
                    y_align: 'center',
                }),
                style_class: 'gif-info-bar',
                visible: false,
            });

            const infoIcon = createStaticIcon(GifIcons.INFO);
            const spacer = new St.Widget({ width: GifUI.INFO_BAR_SPACER_WIDTH });
            const infoLabel = new St.Label({
                text: _('Online search is disabled.'),
                y_align: Clutter.ActorAlign.CENTER,
            });

            this._infoBar.add_child(infoIcon);
            this._infoBar.add_child(spacer);
            this._infoBar.add_child(infoLabel);
        }

        /**
         * Build the search bar.
         * @private
         */
        _buildSearchBar() {
            this._searchComponent = new SearchComponent(null, {
                onNavigateDown: () => this._contentView.focusFirstItem(),
                onNavigateUp: () => {
                    if (this._headerView.focusActive()) {
                        return true;
                    }
                    return MenuNavigationService.focusTabBar('active');
                },
                onNavigateTab: (isBackward) => {
                    if (isBackward) {
                        if (this._headerView.focusLast()) {
                            return true;
                        }
                        return MenuNavigationService.focusTabBar('last');
                    }
                    if (this._contentView.focusFirstItem()) {
                        return true;
                    }
                    MenuNavigationService.focusTabBar('first');
                    return true;
                },
            });

            const searchWidget = this._searchComponent.getWidget();
            searchWidget.x_expand = true;
            this.add_child(searchWidget);
        }

        // ========================================================================
        // Feature Delegation
        // ========================================================================

        /**
         * Focuses the top-most content element when navigating from the main tab bar.
         *
         * @returns {boolean} True if focus was successfully moved.
         */
        focusTopContent() {
            return FocusUtils.tryFocusChain([() => this._headerView.focusActive(), () => this._searchComponent.grabFocus(), () => this._contentView.focusFirstItem()]);
        }

        /**
         * Focuses the bottom-most content element when navigating backward from the main tab bar.
         *
         * @returns {boolean} True if focus was successfully moved.
         */
        focusBottomContent() {
            return FocusUtils.tryFocusChain([() => this._contentView.focusLastItem(), () => this._searchComponent.grabFocus(), () => this._headerView.focusLast()]);
        }

        /**
         * Called when the tab is selected/activated.
         */
        onTabSelected() {
            this.emit('set-main-tab-bar-visibility', false);
            this._runtimeService.onTabSelected();
        }

        /**
         * Applies an externally provided search query.
         *
         * @param {string} query The search query.
         */
        async applyExternalSearch(query) {
            return this._searchService.applyExternalSearch(query);
        }

        /**
         * Clears externally provided search state.
         */
        async clearExternalSearch() {
            return this._searchService.clearExternalSearch();
        }

        /**
         * Called when the main extension menu is closed.
         */
        onMenuClosed() {
            this._searchService.onMenuClosed();
        }

        // ========================================================================
        // Lifecycle
        // ========================================================================

        /**
         * Cleanup.
         */
        destroy() {
            if (this._capturedEventId) {
                this.disconnect(this._capturedEventId);
                this._capturedEventId = 0;
            }

            if (this._searchService) {
                this._searchService.destroy();
                this._searchService = null;
            }
            if (this._runtimeService) {
                this._runtimeService.destroy();
                this._runtimeService = null;
            }
            if (this._selectionService) {
                this._selectionService.destroy();
                this._selectionService = null;
            }
            if (this._fetchService) {
                this._fetchService.destroy();
                this._fetchService = null;
            }
            if (this._downloadService) {
                this._downloadService.destroy();
                this._downloadService = null;
            }

            if (this._searchComponent) {
                this._searchComponent.destroy();
                this._searchComponent = null;
            }
            if (this._itemFactory) {
                this._itemFactory.destroy();
                this._itemFactory = null;
            }
            if (this._gifManager) {
                this._gifManager.destroy();
                this._gifManager = null;
            }

            if (this._headerView) {
                this._headerView.destroy();
                this._headerView = null;
            }
            if (this._contentView) {
                this._contentView.destroy();
                this._contentView = null;
            }
            if (this._httpService) {
                this._httpService.destroy();
                this._httpService = null;
            }

            this._infoBar = null;
            this._settings = null;
            this._extension = null;

            super.destroy();
        }
    },
);
