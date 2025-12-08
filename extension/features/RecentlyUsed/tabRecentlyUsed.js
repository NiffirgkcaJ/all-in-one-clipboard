import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Soup from 'gi://Soup';
import St from 'gi://St';
import { ensureActorVisibleInScrollView } from 'resource:///org/gnome/shell/misc/animationUtils.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { ClipboardType } from '../Clipboard/constants/clipboardConstants.js';
import { FocusUtils } from '../../shared/utilities/utilityFocus.js';
import { getGifCacheManager } from '../GIF/logic/gifCacheManager.js';
import { RecentItemsManager } from '../../shared/utilities/utilityRecents.js';
import { RecentlyUsedViewRenderer } from './view/recentlyUsedViewRenderer.js';
import { Storage } from '../../shared/constants/storagePaths.js';
import { AutoPaster, getAutoPaster } from '../../shared/utilities/utilityAutoPaste.js';
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

            this._gifCacheDir = Storage.getGifPreviewsDir(extension.uuid);

            this._isDestroyed = false;
            this._extension = extension;
            this._settings = settings;
            this._clipboardManager = clipboardManager;
            this._settingsBtnFocusTimeoutId = 0;

            this._imagePreviewSize = this._settings.get_int(RecentlyUsedSettings.CLIPBOARD_IMAGE_PREVIEW_SIZE);
            this._recentManagers = {};
            this._signalIds = [];
            this._sections = {};

            // 2D grid for keyboard navigation
            this._focusGrid = [];
            this._renderSession = null;

            // Scroll lock mechanism prevents auto-scroll when nested scroll views have focus
            this._outerScrollLocked = false;
            this._lockedScrollValue = 0;
            this._scrollLockHandler = null;
            this._previousFocus = null;
            this._lockTimeoutId = null;

            this._buildUI();

            this.initializationPromise = this._loadRecentManagers()
                .then(() => this._connectSignalsAndRender())
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
            const separator = RecentlyUsedViewRenderer.createSectionSeparator();
            this._mainContainer.add_child(separator);

            const section = new St.BoxLayout({
                vertical: true,
                style_class: RecentlyUsedStyles.SECTION,
                x_expand: true,
            });

            const { header, showAllBtn } = RecentlyUsedViewRenderer.createSectionHeader(sectionConfig.getTitle());
            showAllBtn.connect('clicked', () => {
                this.emit('navigate-to-main-tab', sectionConfig.targetTab);
            });

            showAllBtn.connect('key-focus-in', () => {
                this._previousFocus = showAllBtn;

                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    ensureActorVisibleInScrollView(this._scrollView, section);
                    return GLib.SOURCE_REMOVE;
                });
            });

            section.add_child(header);

            const bodyContainer = new St.Bin({
                x_expand: true,
                x_align: Clutter.ActorAlign.FILL,
            });

            section.add_child(bodyContainer);
            this._mainContainer.add_child(section);

            this._sections[sectionConfig.id] = { section, showAllBtn, bodyContainer, separator };
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

            for (const feature of features) {
                const absolutePath = feature.getPath(this._extension.uuid);
                this._recentManagers[feature.id] = new RecentItemsManager(this._extension.uuid, this._settings, absolutePath, feature.maxItemsKey);
            }
        }

        /**
         * Connect to data change signals and perform initial render
         * @private
         */
        _connectSignalsAndRender() {
            this._signalIds.push({
                obj: this._clipboardManager,
                id: this._clipboardManager.connect('history-changed', () => this._renderAll()),
            });
            this._signalIds.push({
                obj: this._clipboardManager,
                id: this._clipboardManager.connect('pinned-list-changed', () => this._renderAll()),
            });

            Object.entries(this._recentManagers).forEach(([_feature, manager]) => {
                this._signalIds.push({
                    obj: manager,
                    id: manager.connect('recents-changed', () => this._renderAll()),
                });
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
            const sectionData = this._sections['pinned'];
            const items = this._clipboardManager.getPinnedItems();

            if (items.length === 0) {
                sectionData.section.hide();
                return;
            }

            sectionData.section.show();
            this._focusGrid.push([sectionData.showAllBtn]);

            const container = new St.BoxLayout({ vertical: true, x_expand: true });
            const useNestedScroll = items.length > RecentlyUsedUI.MAX_PINNED_DISPLAY_COUNT;
            let pinnedScrollView = null;

            const pinnedWidgets = new Set();

            if (useNestedScroll) {
                pinnedScrollView = new St.ScrollView({
                    hscrollbar_policy: St.PolicyType.NEVER,
                    vscrollbar_policy: St.PolicyType.AUTOMATIC,
                    overlay_scrollbars: true,
                    x_expand: true,
                });
                pinnedScrollView.style = `height: ${RecentlyUsedUI.MAX_PINNED_DISPLAY_COUNT * RecentlyUsedUI.PINNED_ITEM_HEIGHT}px;`;

                pinnedScrollView.set_child(container);
                sectionData.bodyContainer.set_child(pinnedScrollView);

                sectionData.showAllBtn.connect('key-focus-in', () => {
                    this._unlockOuterScroll();

                    pinnedWidgets.add(sectionData.showAllBtn);
                    this._previousFocus = sectionData.showAllBtn;

                    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        if (sectionData.section.get_stage()) {
                            ensureActorVisibleInScrollView(this._scrollView, sectionData.section);
                        }
                        return GLib.SOURCE_REMOVE;
                    });
                });
            }

            items.forEach((item) => {
                const widget = this._createFullWidthClipboardItem(item, true);
                container.add_child(widget);

                pinnedWidgets.add(widget);

                if (useNestedScroll) {
                    widget.connect('key-focus-in', () => {
                        const isEnteringFromOutside = !pinnedWidgets.has(this._previousFocus);

                        if (isEnteringFromOutside) {
                            this._unlockOuterScroll();

                            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                                if (widget.get_stage()) {
                                    ensureActorVisibleInScrollView(this._scrollView, sectionData.section);
                                    ensureActorVisibleInScrollView(pinnedScrollView, widget);

                                    this._lockTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                                        this._lockTimeoutId = null;
                                        this._lockOuterScroll();
                                        return GLib.SOURCE_REMOVE;
                                    });
                                }
                                return GLib.SOURCE_REMOVE;
                            });
                        } else {
                            this._lockOuterScroll();

                            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                                if (widget.get_stage()) {
                                    ensureActorVisibleInScrollView(pinnedScrollView, widget);
                                }
                                return GLib.SOURCE_REMOVE;
                            });
                        }

                        this._previousFocus = widget;
                    });
                } else {
                    widget.connect('key-focus-in', () => {
                        this._unlockOuterScroll();

                        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                            if (widget.get_stage()) {
                                ensureActorVisibleInScrollView(this._scrollView, widget);
                            }
                            return GLib.SOURCE_REMOVE;
                        });

                        this._previousFocus = widget;
                    });
                }

                this._focusGrid.push([widget]);
            });

            if (!useNestedScroll) {
                sectionData.bodyContainer.set_child(container);
            }
        }

        /**
         * Render a list-style section (kaomoji or clipboard)
         *
         * @param {string} id - Section identifier ('kaomoji' or 'clipboard')
         * @private
         */
        _renderListSection(id) {
            const sectionData = this._sections[id];
            const settingKeyMap = {
                kaomoji: RecentlyUsedSettings.ENABLE_KAOMOJI_TAB,
                clipboard: RecentlyUsedSettings.ENABLE_CLIPBOARD_TAB,
            };

            const settingKey = settingKeyMap[id];
            if (settingKey && !this._settings.get_boolean(settingKey)) {
                sectionData.section.hide();
                return;
            }

            const items = id === 'kaomoji' ? this._recentManagers.kaomoji.getRecents().slice(0, 5) : this._clipboardManager.getHistoryItems().slice(0, 5);

            if (items.length === 0) {
                sectionData.section.hide();
                return;
            }

            sectionData.section.show();
            this._focusGrid.push([sectionData.showAllBtn]);

            const container = new St.BoxLayout({ vertical: true, x_expand: true });

            items.forEach((item) => {
                const itemData = id === 'kaomoji' ? { type: 'kaomoji', preview: item.value, rawItem: item } : item;
                const widget = this._createFullWidthClipboardItem(itemData, false, id);
                container.add_child(widget);
                this._focusGrid.push([widget]);
            });

            sectionData.bodyContainer.set_child(container);
        }

        /**
         * Render a grid-style section (emoji, GIF, or symbols)
         *
         * @param {string} id - Section identifier
         * @private
         */
        _renderGridSection(id) {
            const sectionData = this._sections[id];
            const manager = this._recentManagers[id];
            const settingKeyMap = {
                emoji: RecentlyUsedSettings.ENABLE_EMOJI_TAB,
                gif: RecentlyUsedSettings.ENABLE_GIF_TAB,
                symbols: RecentlyUsedSettings.ENABLE_SYMBOLS_TAB,
            };

            const settingKey = settingKeyMap[id];
            if (settingKey && !this._settings.get_boolean(settingKey)) {
                sectionData.section.hide();
                return;
            }

            if (!manager) return;

            const items = manager.getRecents().slice(0, 5);

            if (items.length === 0) {
                sectionData.section.hide();
                return;
            }

            sectionData.section.show();
            this._focusGrid.push([sectionData.showAllBtn]);

            const grid = new St.Widget({
                layout_manager: new Clutter.GridLayout({
                    column_homogeneous: true,
                    column_spacing: RecentlyUsedUI.GRID_COLUMN_SPACING,
                }),
                x_expand: true,
            });

            const layout = grid.get_layout_manager();
            const sectionFocusables = [];

            items.forEach((item, index) => {
                const widget = this._createGridItem(item, id);
                layout.attach(widget, index, 0, 1, 1);
                sectionFocusables.push(widget);

                if (id === 'gif' && item.preview_url) {
                    const context = {
                        httpSession: this._httpSession,
                        gifCacheDir: this._gifCacheDir,
                        isDestroyed: () => this._isDestroyed,
                        currentRenderSession: () => this._renderSession,
                        getGifCacheManager,
                    };
                    RecentlyUsedViewRenderer.updateGifButtonWithPreview(widget, item.preview_url, this._renderSession, context).catch((e) => {
                        if (!e.message.startsWith('Recently Used Tab')) {
                            console.warn(`[AIO-Clipboard] Failed to load GIF preview: ${e.message}`);
                        }
                    });
                }
            });

            this._focusGrid.push(sectionFocusables);
            sectionData.bodyContainer.set_child(grid);
        }

        // ========================================================================
        // Widget Creation
        // ========================================================================

        /**
         * Create a full-width list item button for clipboard/kaomoji content
         *
         * @param {object} itemData - Item data containing type, preview, etc.
         * @param {boolean} isPinned - Whether item is pinned (changes click behavior)
         * @param {string} feature - Feature type ('clipboard', 'kaomoji', etc.)
         * @returns {St.Button} The created button widget
         * @private
         */
        _createFullWidthClipboardItem(itemData, isPinned, feature = 'clipboard') {
            const context = {
                clipboardManager: this._clipboardManager,
                imagePreviewSize: this._imagePreviewSize,
            };

            const button = RecentlyUsedViewRenderer.createFullWidthListItem(itemData, isPinned, feature, context);

            button.connect('clicked', () => {
                this._onItemClicked(itemData.type === 'kaomoji' ? itemData.rawItem : itemData, feature);
            });

            button.connect('key-focus-in', () => {
                this._unlockOuterScroll();

                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    if (button.get_stage()) {
                        ensureActorVisibleInScrollView(this._scrollView, button);
                    }
                    return GLib.SOURCE_REMOVE;
                });
            });

            return button;
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
            const button = RecentlyUsedViewRenderer.createGridItem(itemData, feature);

            button.connect('clicked', () => this._onItemClicked(itemData, feature));

            button.connect('key-focus-in', () => {
                this._unlockOuterScroll();

                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    ensureActorVisibleInScrollView(this._scrollView, button);
                    return GLib.SOURCE_REMOVE;
                });
            });

            return button;
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
            const featureConfigs = {
                emoji: RecentlyUsedFeatures.EMOJI,
                gif: RecentlyUsedFeatures.GIF,
                kaomoji: RecentlyUsedFeatures.KAOMOJI,
                symbols: RecentlyUsedFeatures.SYMBOLS,
            };
            const featureConfig = featureConfigs[feature];
            const autoPasteKey = featureConfig ? featureConfig.autoPasteKey : RecentlyUsedSettings.AUTO_PASTE_CLIPBOARD;

            let copySuccess = false;

            if (feature === 'clipboard') {
                copySuccess = await this._copyClipboardItemToSystem(itemData);
            } else {
                const contentToCopy = itemData.full_url || itemData.char || itemData.value || '';
                if (contentToCopy) {
                    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, contentToCopy);
                    copySuccess = true;
                }
            }

            if (copySuccess) {
                if (feature === 'clipboard') {
                    this._clipboardManager.promoteItemToTop(itemData.id);
                }

                if (AutoPaster.shouldAutoPaste(this._settings, autoPasteKey)) {
                    await getAutoPaster().trigger();
                }
            }

            this._extension._indicator.menu.close();
        }

        /**
         * Copy a clipboard item to the system clipboard
         *
         * @param {Object} itemData - The clipboard item data
         * @returns {Promise<boolean>} True if successful
         * @private
         */
        async _copyClipboardItemToSystem(itemData) {
            let copySuccess = false;

            if (itemData.type === ClipboardType.TEXT || itemData.type === ClipboardType.CODE) {
                let fullContent = itemData.text;
                if (!fullContent) {
                    fullContent = await this._clipboardManager.getContent(itemData.id);
                }
                if (fullContent) {
                    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, fullContent);
                    copySuccess = true;
                }
            } else if (itemData.type === ClipboardType.FILE) {
                try {
                    const clipboard = St.Clipboard.get_default();
                    const uriList = itemData.file_uri + '\r\n';
                    const bytes = new GLib.Bytes(new TextEncoder().encode(uriList));
                    clipboard.set_content(St.ClipboardType.CLIPBOARD, 'text/uri-list', bytes);
                    copySuccess = true;
                } catch (e) {
                    console.error(`[AIO-Clipboard] Failed to copy file URI: ${e.message}`);
                }
            } else if (itemData.type === ClipboardType.URL || itemData.type === ClipboardType.COLOR) {
                const text = itemData.type === ClipboardType.URL ? itemData.url : itemData.color_value;
                St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
                copySuccess = true;
            } else if (itemData.type === ClipboardType.IMAGE) {
                try {
                    if (itemData.file_uri) {
                        const clipboard = St.Clipboard.get_default();
                        const uriList = itemData.file_uri + '\r\n';
                        const bytes = new GLib.Bytes(new TextEncoder().encode(uriList));
                        clipboard.set_content(St.ClipboardType.CLIPBOARD, 'text/uri-list', bytes);
                        copySuccess = true;
                    } else {
                        const imagePath = GLib.build_filenamev([this._clipboardManager._imagesDir, itemData.image_filename]);
                        const file = Gio.File.new_for_path(imagePath);

                        let mimetype = 'image/png';
                        const lowerCaseFilename = itemData.image_filename.toLowerCase();

                        if (lowerCaseFilename.endsWith('.jpg') || lowerCaseFilename.endsWith('.jpeg')) {
                            mimetype = 'image/jpeg';
                        } else if (lowerCaseFilename.endsWith('.gif')) {
                            mimetype = 'image/gif';
                        } else if (lowerCaseFilename.endsWith('.webp')) {
                            mimetype = 'image/webp';
                        }

                        const bytes = await new Promise((resolve, reject) => {
                            file.load_contents_async(null, (source, res) => {
                                try {
                                    const [ok, contents] = source.load_contents_finish(res);
                                    resolve(ok ? contents : null);
                                } catch (e) {
                                    reject(e);
                                }
                            });
                        });

                        if (bytes) {
                            St.Clipboard.get_default().set_content(St.ClipboardType.CLIPBOARD, mimetype, bytes);
                            copySuccess = true;
                        }
                    }
                } catch (e) {
                    console.error(`[AIO-Clipboard] Failed to copy recent image to clipboard: ${e.message}`);
                    copySuccess = false;
                }
            }

            return copySuccess;
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

            if (this._outerScrollLocked) {
                return;
            }

            this._lockedScrollValue = this._scrollView.vadjustment.value;
            this._outerScrollLocked = true;

            this._scrollLockHandler = this._scrollView.vadjustment.connect('notify::value', () => {
                if (this._outerScrollLocked) {
                    if (this._scrollView.vadjustment.value !== this._lockedScrollValue) {
                        this._scrollView.vadjustment.set_value(this._lockedScrollValue);
                    }
                }
            });
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

            if (!this._outerScrollLocked) {
                return;
            }

            this._outerScrollLocked = false;

            if (this._scrollLockHandler) {
                this._scrollView.vadjustment.disconnect(this._scrollLockHandler);
                this._scrollLockHandler = null;
            }
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
            const symbol = event.get_key_symbol();
            const currentFocus = global.stage.get_key_focus();
            const allFocusable = this._focusGrid.flat();

            if (!allFocusable.includes(currentFocus)) {
                if (symbol === Clutter.KEY_Down && this._focusGrid.length > 0) {
                    this._focusGrid[0][0].grab_key_focus();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            }

            // Find current focus position in grid
            let rowIndex = -1,
                colIndex = -1;
            for (let r = 0; r < this._focusGrid.length; r++) {
                let c = this._focusGrid[r].indexOf(currentFocus);
                if (c !== -1) {
                    rowIndex = r;
                    colIndex = c;
                    break;
                }
            }

            if (rowIndex === -1) return Clutter.EVENT_PROPAGATE;

            let nextRow = rowIndex,
                nextCol = colIndex;

            if (symbol === Clutter.KEY_Left || symbol === Clutter.KEY_Right) {
                const currentRow = this._focusGrid[rowIndex];
                const currentRowIndex = currentRow.indexOf(currentFocus);

                if (currentRowIndex !== -1) {
                    const result = FocusUtils.handleRowNavigation(event, currentRow, currentRowIndex, currentRow.length);
                    if (result === Clutter.EVENT_STOP) {
                        return Clutter.EVENT_STOP;
                    }
                }
                return Clutter.EVENT_PROPAGATE;
            }

            if (symbol === Clutter.KEY_Up) {
                if (rowIndex > 0) {
                    nextRow--;
                } else {
                    this._unlockOuterScroll();
                    return Clutter.EVENT_PROPAGATE;
                }
            } else if (symbol === Clutter.KEY_Down) {
                if (rowIndex < this._focusGrid.length - 1) {
                    nextRow++;
                } else {
                    return Clutter.EVENT_STOP;
                }
            } else {
                return Clutter.EVENT_PROPAGATE;
            }

            if (this._focusGrid[nextRow].length === 1) {
                nextCol = 0;
            } else {
                nextCol = Math.min(nextCol, this._focusGrid[nextRow].length - 1);
            }

            const targetWidget = this._focusGrid[nextRow][nextCol];

            if (targetWidget === this._settingsBtn) {
                this._settingsBtn.can_focus = true;
                this._settingsBtn.grab_key_focus();

                if (this._settingsBtnFocusTimeoutId) {
                    GLib.source_remove(this._settingsBtnFocusTimeoutId);
                }
                this._settingsBtnFocusTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
                    this._settingsBtn.can_focus = false;
                    this._settingsBtnFocusTimeoutId = 0;
                    return GLib.SOURCE_REMOVE;
                });
            } else {
                targetWidget.grab_key_focus();
            }

            return Clutter.EVENT_STOP;
        }

        // ========================================================================
        // Lifecycle
        // ========================================================================

        /**
         * Called when tab becomes active - show tab bar and render content
         */
        onTabSelected() {
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (!this._isDestroyed) {
                    this.emit('set-main-tab-bar-visibility', true);
                }
                return GLib.SOURCE_REMOVE;
            });

            this._renderAll();

            this._unlockOuterScroll();

            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                this._restoreFocus();
                return GLib.SOURCE_REMOVE;
            });
        }

        /**
         * Helper method to intelligently restore focus to the first content item
         * @private
         */
        _restoreFocus() {
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                if (this._focusGrid.length === 0) {
                    return GLib.SOURCE_REMOVE;
                }

                const showAllButtons = new Set();
                for (const section of Object.values(this._sections)) {
                    if (section.showAllBtn) {
                        showAllButtons.add(section.showAllBtn);
                    }
                }

                if (this._tryFocusContentItem(showAllButtons)) {
                    return GLib.SOURCE_REMOVE;
                }

                if (this._tryFocusShowAllButton(showAllButtons)) {
                    return GLib.SOURCE_REMOVE;
                }

                this._tryFocusAnyWidget();
                return GLib.SOURCE_REMOVE;
            });
        }

        /**
         * Try to focus the first content item (not Show All button, not settings)
         * @param {Set} showAllButtons - Set of Show All buttons to skip
         * @returns {boolean} True if successfully focused an item
         * @private
         */
        _tryFocusContentItem(showAllButtons) {
            for (let i = 0; i < this._focusGrid.length; i++) {
                const row = this._focusGrid[i];
                if (!row || row.length === 0) continue;

                const firstItemInRow = row[0];
                if (!firstItemInRow || !firstItemInRow.visible || !firstItemInRow.get_stage()) continue;
                if (firstItemInRow === this._settingsBtn) continue;
                if (showAllButtons.has(firstItemInRow)) continue;

                try {
                    firstItemInRow.grab_key_focus();
                    return true;
                } catch {
                    continue;
                }
            }
            return false;
        }

        /**
         * Try to focus any Show All button that's visible
         * @param {Set} showAllButtons - Set of Show All buttons
         * @returns {boolean} True if successfully focused a button
         * @private
         */
        _tryFocusShowAllButton(showAllButtons) {
            for (const button of showAllButtons) {
                if (button && button.visible && button.get_stage()) {
                    try {
                        button.grab_key_focus();
                        return true;
                    } catch {
                        continue;
                    }
                }
            }
            return false;
        }

        /**
         * Last resort: try to focus any visible widget in the grid
         * @private
         */
        _tryFocusAnyWidget() {
            for (let i = 0; i < this._focusGrid.length; i++) {
                if (this._focusGrid[i] && this._focusGrid[i][0]) {
                    const widget = this._focusGrid[i][0];
                    if (widget && widget.visible && widget.get_stage()) {
                        try {
                            widget.grab_key_focus();
                            return;
                        } catch {
                            continue;
                        }
                    }
                }
            }
        }

        /**
         * Cleanup: disconnect all signals and destroy managers
         */
        destroy() {
            if (this._settingsBtnFocusTimeoutId) {
                GLib.source_remove(this._settingsBtnFocusTimeoutId);
                this._settingsBtnFocusTimeoutId = 0;
            }

            this._isDestroyed = true;

            if (this._httpSession) {
                this._httpSession.abort();
                this._httpSession = null;
            }

            this._signalIds.forEach(({ obj, id }) => {
                obj.disconnect(id);
            });

            Object.values(this._recentManagers).forEach((m) => m?.destroy());

            super.destroy();
        }
    },
);
