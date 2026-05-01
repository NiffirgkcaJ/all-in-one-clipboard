import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { createStaticIcon } from '../../shared/utilities/utilityIcon.js';
import { FilePath } from '../../shared/constants/storagePaths.js';
import { IOFile } from '../../shared/utilities/utilityIO.js';
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
import { GifUI, GifIcons } from './constants/gifConstants.js';

/**
 * GIFTabContent
 *
 * It strictly handles the top-level UI layout and instantiates the components.
 * It delegates feature-specific orchestration to dedicated services.
 *
 * @fires set-main-tab-bar-visibility Emitted to show/hide the main tab bar.
 * @fires navigate-to-main-tab Emitted to navigate back to a main tab.
 */
export const GIFTabContent = GObject.registerClass(
    {
        Signals: {
            'set-main-tab-bar-visibility': { param_types: [GObject.TYPE_BOOLEAN] },
            'navigate-to-main-tab': { param_types: [GObject.TYPE_STRING] },
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
                vertical: true,
                style_class: 'gif-tab-content',
                x_expand: true,
                y_expand: true,
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
                extensionUuid: extension?.uuid,
                extensionPath: extension?.path,
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

            this.connect('captured-event', (actor, event) => {
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

            this._headerView.connect('navigate-back', () => {
                this.emit('navigate-to-main-tab', _('Recently Used'));
            });

            this._headerView.connect('focus-next-down', () => {
                if (this._searchComponent.getWidget().visible) {
                    this._searchComponent.grabFocus();
                } else {
                    this._contentView.focusFirstItem();
                }
            });
            this.add_child(this._headerView);

            this._buildInfoBar();
            this.add_child(this._infoBar);

            this._buildSearchBar();

            this._itemFactory = new GifItemFactory(this._downloadService, this._cacheDir);
            this._contentView = new GifContentView(this._settings, this._itemFactory);

            this._itemFactory.setScrollView(this._contentView.getScrollView());

            this._contentView.connect('focus-next-up', () => {
                if (this._searchComponent.getWidget().visible) {
                    this._searchComponent.grabFocus();
                } else {
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
                style_class: 'gif-info-bar',
                visible: false,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
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
            this._searchComponent = new SearchComponent((searchText) => this._searchComponent.emit('search-changed', searchText), {
                onNavigateDown: () => {
                    this._contentView.focusFirstItem();
                    return true;
                },
                onNavigateUp: () => {
                    this._headerView.focusFirst();
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
            this._searchService?.destroy();
            this._runtimeService?.destroy();
            this._selectionService?.destroy();
            this._fetchService?.destroy();
            this._downloadService?.destroy();

            this._searchComponent?.destroy();
            this._itemFactory?.destroy();
            this._gifManager?.destroy();

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

            super.destroy();
        }
    },
);
