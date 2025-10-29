import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import Soup from 'gi://Soup';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import { ensureActorVisibleInScrollView } from 'resource:///org/gnome/shell/misc/animationUtils.js';

import { getGifCacheManager } from '../GIF/logic/gifCacheManager.js';
import { RecentItemsManager } from '../../utilities/utilityRecents.js';
import { AutoPaster, getAutoPaster } from '../../utilities/utilityAutoPaste.js';

// ============================================================================
// Constants
// ============================================================================

const PINNED_ITEM_HEIGHT = 48;
const MAX_PINNED_DISPLAY_COUNT = 5;
/** Pixel size for clipboard image previews in recently used view. */
const DEFAULT_RECENT_CLIPBOARD_IMAGE_PREVIEW_SIZE = 160;

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
export const RecentlyUsedTabContent = GObject.registerClass({
    Signals: {
        'set-main-tab-bar-visibility': { param_types: [GObject.TYPE_BOOLEAN] },
        'navigate-to-main-tab': { param_types: [GObject.TYPE_STRING] }
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
            style_class: 'recently-used-tab-content',
            x_expand: true,
            y_expand: true
        });

        this._httpSession = new Soup.Session();

        this._gifCacheDir = GLib.build_filenamev([
            GLib.get_user_cache_dir(),
            extension.uuid,
            'gif-previews'
        ]);

        this._isDestroyed = false;
        this._extension = extension;
        this._settings = settings;
        this._clipboardManager = clipboardManager;
        this._settingsBtnFocusTimeoutId = 0;
        this._gifSectionEnabled = this._settings.get_string('gif-provider') !== 'none';
        this._imagePreviewSize = this._settings.get_int('clipboard-image-preview-size') || DEFAULT_RECENT_CLIPBOARD_IMAGE_PREVIEW_SIZE;

        // Store recent managers for different feature types
        this._recentManagers = {};

        // Track connected signals for cleanup
        this._signalIds = [];

        // Store section UI elements
        this._sections = {};

        // 2D grid representing focusable elements for keyboard navigation
        this._focusGrid = [];
        this._renderSession = null;

        this._buildUI();
        this._loadRecentManagers()
            .then(() => this._connectSignalsAndRender())
            .catch(e => console.error('[AIO-Clipboard] Failed to load recent managers:', e));

        this._signalIds.push({
            obj: this._settings,
            id: this._settings.connect('changed::clipboard-image-preview-size', () => {
                this._imagePreviewSize = this._settings.get_int('clipboard-image-preview-size') || DEFAULT_RECENT_CLIPBOARD_IMAGE_PREVIEW_SIZE;
                this._renderAll();
            })
        });
    }

    // ========================================================================
    // UI Construction
    // ========================================================================

    /**
     * Build the main UI structure with scrollable content and floating settings button
     * @private
     */
    _buildUI() {
        // Create a main wrapper that will hold everything
        const wrapper = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true
        });
        this.add_child(wrapper);

        // Layer 1: Scrollable content container (bottom layer)
        this._scrollView = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true,
            y_expand: true,
            overlay_scrollbars: true,
            visible: false // Start hidden, show only if there's content
        });
        wrapper.add_child(this._scrollView);

        this._mainContainer = new St.BoxLayout({
            vertical: true,
            style_class: 'recently-used-container'
        });
        this._scrollView.set_child(this._mainContainer);

        // Layer 2: Empty view (bottom layer, alternative to scroll view)
        this._emptyView = new St.Bin({
            x_expand: true,
            y_expand: true,
            visible: false,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._emptyView.set_child(new St.Label({ text: _("No recent items yet.") }));
        wrapper.add_child(this._emptyView);

        // Layer 3: Floating settings button (top layer, positioned at bottom-right)
        this._settingsBtn = new St.Button({
            style_class: 'recently-used-settings-button button',
            child: new St.Icon({
                icon_name: 'emblem-system-symbolic',
                style_class: 'popup-menu-icon'
            }),
            can_focus: false,
            reactive: true,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.END
        });
        this._settingsBtn.connect('clicked', () => {
            const returnValue = this._extension.openPreferences();

            // Handle promise rejection if user closes the preferences window
            if (returnValue && typeof returnValue.catch === 'function') {
                returnValue.catch(() => {
                    // Ignore errors from user closing the window
                });
            }
        });
        wrapper.add_child(this._settingsBtn);

        // Add all content sections
        this._addSection('pinned', _("Pinned Clipboard"), _("Clipboard"));
        this._addSection('emoji', _("Recent Emojis"), _("Emoji"));
        this._addSection('gif', _("Recent GIFs"), _("GIF"));
        this._addSection('kaomoji', _("Recent Kaomojis"), _("Kaomoji"));
        this._addSection('symbols', _("Recent Symbols"), _("Symbols"));
        this._addSection('clipboard', _("Recent Clipboard History"), _("Clipboard"));

        // Enable keyboard navigation
        this.reactive = true;
        this.connect('key-press-event', this._onKeyPress.bind(this));
    }

    /**
     * Add a collapsible section with header and "Show All" button
     *
     * @param {string} id - Unique identifier for the section
     * @param {string} title - Display title for the section header
     * @param {string} tabToNavigateTo - Target tab name when "Show All" is clicked
     * @private
     */
    _addSection(id, title, tabToNavigateTo) {
        // Separator line
        const separator = new St.Widget({
            style_class: 'recently-used-separator',
            visible: false
        });
        this._mainContainer.add_child(separator);

        // Section container
        const section = new St.BoxLayout({
            vertical: true,
            style_class: 'recently-used-section',
            x_expand: true
        });

        // Header with title and "Show All" button
        const header = new St.BoxLayout({
            style_class: 'recently-used-header',
            x_expand: true
        });

        const showAllBtn = new St.Button({
            label: _("Show All"),
            style_class: 'recently-used-show-all-button button',
            can_focus: true
        });
        showAllBtn.connect('clicked', () => {
            this.emit('navigate-to-main-tab', tabToNavigateTo);
        });

        // Ensure "Show All" button scrolls into view when focused
        showAllBtn.connect('key-focus-in', () => {
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                ensureActorVisibleInScrollView(this._scrollView, showAllBtn);
                return GLib.SOURCE_REMOVE;
            });
        });

        header.add_child(new St.Label({
            text: title,
            style_class: 'recently-used-title',
            x_expand: true
        }));
        header.add_child(showAllBtn);

        // Body container for dynamic content
        const bodyContainer = new St.Bin({
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL
        });

        section.add_child(header);
        section.add_child(bodyContainer);
        this._mainContainer.add_child(section);

        // Store the separator along with the other section parts
        this._sections[id] = { section, showAllBtn, bodyContainer, separator };
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
        const features = ['emoji', 'kaomoji', 'symbols', 'gif'];
        const config = {
            emoji: { file: 'recent_emojis.json', key: 'emoji-recents-max-items' },
            kaomoji: { file: 'recent_kaomojis.json', key: 'kaomoji-recents-max-items' },
            symbols: { file: 'recent_symbols.json', key: 'symbols-recents-max-items' },
            gif: { file: 'recent_gifs.json', key: 'gif-recents-max-items' }
        };

        for (const feature of features) {
            this._recentManagers[feature] = new RecentItemsManager(
                this._extension.uuid,
                this._settings,
                config[feature].file,
                config[feature].key
            );
        }
    }

    /**
     * Connect to data change signals and perform initial render
     * @private
     */
    _connectSignalsAndRender() {
        // Listen for clipboard changes
        this._signalIds.push({
            obj: this._clipboardManager,
            id: this._clipboardManager.connect('history-changed', () => this._renderAll())
        });
        this._signalIds.push({
            obj: this._clipboardManager,
            id: this._clipboardManager.connect('pinned-list-changed', () => this._renderAll())
        });

        // Listen for recent item changes
        Object.entries(this._recentManagers).forEach(([feature, manager]) => {
            this._signalIds.push({
                obj: manager,
                id: manager.connect('recents-changed', () => this._renderAll())
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

        // Hide all separators before we begin rendering
        for (const id in this._sections) {
            this._sections[id].separator.visible = false;
        }

        this._renderPinnedSection();
        this._renderGridSection('emoji');
        this._renderGridSection('gif');
        this._renderListSection('kaomoji');
        this._renderGridSection('symbols');
        this._renderListSection('clipboard');

        // Centralized visibility logic
        const sectionOrder = ['pinned', 'emoji', 'gif', 'kaomoji', 'symbols', 'clipboard'];
        const visibleSections = sectionOrder.map(id => this._sections[id]).filter(s => s && s.section.visible);

        if (visibleSections.length === 0) {
            // No content, so show the empty view and hide the scroll view
            this._scrollView.visible = false;
            this._emptyView.visible = true;
        } else {
            // There is content, so show the scroll view and hide the empty view
            this._scrollView.visible = true;
            this._emptyView.visible = false;

            // Show separators for all but the first visible section
            for (let i = 1; i < visibleSections.length; i++) {
                visibleSections[i].separator.visible = true;
            }
        }

        // Settings button is always the last focusable element
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
        let pinnedScrollView = null;

        items.forEach(item => {
            const widget = this._createFullWidthClipboardItem(item, true);
            container.add_child(widget);

            // Ensure item scrolls into view when focused
            widget.connect('key-focus-in', () => {
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    // Defensive check: Only run if the widget is part of the main UI tree.
                    if (widget.get_stage()) {
                        if (pinnedScrollView) {
                            ensureActorVisibleInScrollView(pinnedScrollView, widget);
                        } else {
                            ensureActorVisibleInScrollView(this._scrollView, widget);
                        }
                    }
                    return GLib.SOURCE_REMOVE;
                });
            });

            this._focusGrid.push([widget]);
        });

        // Add nested scroll view if too many pinned items
        if (items.length > MAX_PINNED_DISPLAY_COUNT) {
            pinnedScrollView = new St.ScrollView({
                hscrollbar_policy: St.PolicyType.NEVER,
                vscrollbar_policy: St.PolicyType.AUTOMATIC,
                overlay_scrollbars: true,
                x_expand: true
            });
            pinnedScrollView.style = `height: ${MAX_PINNED_DISPLAY_COUNT * PINNED_ITEM_HEIGHT}px;`;
            pinnedScrollView.set_child(container);
            sectionData.bodyContainer.set_child(pinnedScrollView);
        } else {
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
        const items = (id === 'kaomoji')
            ? this._recentManagers.kaomoji.getRecents().slice(0, 5)
            : this._clipboardManager.getHistoryItems().slice(0, 5);

        if (items.length === 0) {
            sectionData.section.hide();
            return;
        }

        sectionData.section.show();
        this._focusGrid.push([sectionData.showAllBtn]);

        const container = new St.BoxLayout({ vertical: true, x_expand: true });

        items.forEach(item => {
            const itemData = (id === 'kaomoji')
                ? { type: 'kaomoji', preview: item.value, rawItem: item }
                : item;
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
                column_spacing: 4
            }),
            x_expand: true
        });

        const layout = grid.get_layout_manager();
        const sectionFocusables = [];

        items.forEach((item, index) => {
            const widget = this._createGridItem(item, id);
            layout.attach(widget, index, 0, 1, 1);
            sectionFocusables.push(widget);
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
        const isKaomoji = itemData.type === 'kaomoji';
        const isImage = itemData.type === 'image';
        const previewSize = this._imagePreviewSize || DEFAULT_RECENT_CLIPBOARD_IMAGE_PREVIEW_SIZE;

        // Start with the base class
        let styleClass = 'button recently-used-list-item';

        // Add the text class if it's kaomoji or an image
        if (isImage) {
            styleClass += ' recently-used-normal-item recently-used-list-item-image';
        } else if (isKaomoji) {
            styleClass += ' recently-used-bold-item';
        }

        const button = new St.Button({
            style_class: styleClass, // Use the correctly built class string
            can_focus: true,
            x_expand: true
        });
        button.set_style(null);

        const box = new St.BoxLayout({
            x_expand: true,
            y_align: isImage ? Clutter.ActorAlign.FILL : Clutter.ActorAlign.CENTER,
            x_align: (isKaomoji || isImage) ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.FILL
        });
        box.spacing = 8;
        if (isImage) {
            const minHeight = Math.max(previewSize + 24, 64);
            button.set_style(`min-height: ${minHeight}px; padding-top: 8px; padding-bottom: 8px;`);
            box.y_expand = true;
        }
        button.set_child(box);

        if (isKaomoji) {
            const label = new St.Label({
                text: itemData.preview || '',
                y_align: Clutter.ActorAlign.CENTER,
                x_align: Clutter.ActorAlign.CENTER
            });
            box.add_child(label);
        } else if (isImage) {
            const imagePath = GLib.build_filenamev([
                this._clipboardManager._imagesDir,
                itemData.image_filename
            ]);
            const imageWrapper = new St.Bin({
                x_expand: true,
                y_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'recently-used-list-item-image-wrapper'
            });

            const icon = new St.Icon({
                gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(imagePath) }),
                icon_size: previewSize,
                style_class: 'recently-used-list-item-image-icon',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true
            });

            imageWrapper.set_style(`min-height: ${previewSize}px;`);
            imageWrapper.set_child(icon);
            box.add_child(imageWrapper);
        } else {
            const label = new St.Label({
                text: itemData.preview || '',
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true
            });
            label.get_clutter_text().set_line_wrap(false);
            label.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
            box.add_child(label);
        }

        // Handle click events
        button.connect('clicked', () => {
            this._onItemClicked(isKaomoji ? itemData.rawItem : itemData, feature);
        });

        // Ensure button scrolls into view when focused
        button.connect('key-focus-in', () => {
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                // Defensive check: Only run if the widget is part of the main UI tree.
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
        const button = new St.Button({
            style_class: 'button recently-used-grid-item',
            can_focus: true
        });

        if (feature === 'gif') {
            this._setStretchedGifIcon(button, itemData.preview_url, this._renderSession);
            button.tooltip_text = itemData.description || _("GIF");
        } else {
            button.label = itemData.char || itemData.value || '';
            button.tooltip_text = itemData.name || button.label;
        }

        button.connect('clicked', () => this._onItemClicked(itemData, feature));

        // Ensure button scrolls into view when focused
        button.connect('key-focus-in', () => {
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
        const featureKeyMap = {
            emoji: 'auto-paste-emoji',
            gif: 'auto-paste-gif',
            kaomoji: 'auto-paste-kaomoji',
            symbols: 'auto-paste-symbols',
            clipboard: 'auto-paste-clipboard'
        };

        let copySuccess = false;

        if (feature === 'clipboard') {
            if (itemData.type === 'text') {
                const fullContent = await this._clipboardManager.getContent(itemData.id);
                if (fullContent) {
                    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, fullContent);
                    copySuccess = true;
                }
            } else if (itemData.type === 'image') {
                try {
                    const imagePath = GLib.build_filenamev([
                        this._clipboardManager._imagesDir,
                        itemData.image_filename
                    ]);
                    const file = Gio.File.new_for_path(imagePath);

                    // Determine MIME type from filename
                    let mimetype = 'image/png'; // Default
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
                } catch (e) {
                    console.error(`[AIO-Clipboard] Failed to copy recent image to clipboard: ${e.message}`);
                    copySuccess = false;
                }
            }
        } else {
            // This handles emojis, GIFs, kaomojis, symbols
            const contentToCopy = itemData.full_url || itemData.char || itemData.value || '';
            if (contentToCopy) {
                St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, contentToCopy);
                copySuccess = true;
            }
        }

        if (copySuccess) {
            // If the item was from the clipboard, tell the manager to handle its state.
            if (feature === 'clipboard') {
                this._clipboardManager.promoteItemToTop(itemData.id);
            }

            // Check if auto-paste is enabled
            if (AutoPaster.shouldAutoPaste(this._settings, featureKeyMap[feature])) {
                await getAutoPaster().trigger();
            }
        }

        this._extension._indicator.menu.close();
    }

    /**
     * Fetch image bytes from a URL.
     *
     * @param {string} url - The image URL
     * @returns {Promise<GLib.Bytes>} The image bytes
     * @private
     */
    async _fetchImageBytes(url) {
        const message = new Soup.Message({
            method: 'GET',
            uri: GLib.Uri.parse(url, GLib.UriFlags.NONE)
        });

        return new Promise((resolve, reject) => {
            this._httpSession.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                null,
                (session, res) => {
                    if (this._isDestroyed) {
                        return reject(new Error('Recently Used Tab was destroyed.'));
                    }
                    if (message.get_status() >= 300) {
                        return reject(new Error(`HTTP Error ${message.get_status()}`));
                    }
                    try {
                        resolve(session.send_and_read_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                }
            );
        });
    }

    /**
     * Saves a GLib.Bytes object to a file, wrapping the callback-based
     * function in a Promise to guarantee completion.
     * @private
     */
    async _saveBytesToFile(file, bytes) {
        return new Promise((resolve, reject) => {
            file.replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.NONE, null, (source, res) => {
                try {
                    source.replace_contents_finish(res);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    /**
     * Load and display GIF preview image asynchronously
     *
     * @param {St.Button} button - Button to update with GIF icon
     * @param {string} url - URL of the GIF preview image
     * @param {object} renderSession - The session token for this render pass
     * @private
     * @async
     */
    async _setStretchedGifIcon(button, url, renderSession) {
        const icon = new St.Icon({
            style_class: 'recently-used-gif-icon',
            icon_name: 'image-x-generic-symbolic',
            icon_size: 64
        });
        button.set_child(icon);

        if (!url) return;

        try {
            const hash = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, url, -1);
            const filename = `${hash}.gif`;
            const file = Gio.File.new_for_path(GLib.build_filenamev([this._gifCacheDir, filename]));

            if (!file.query_exists(null)) {
                const bytes = await this._fetchImageBytes(url);
                await this._saveBytesToFile(file, bytes);

                // Trigger cleanup of old cached GIFs
                getGifCacheManager().triggerDebouncedCleanup();
            }

            if (this._isDestroyed || renderSession !== this._renderSession) {
                return;
            }

            // Successfully loaded the GIF, update the icon
            icon.set_gicon(new Gio.FileIcon({ file }));

        } catch (e) {
            if (!e.message.startsWith('Recently Used Tab')) {
                console.warn(`[AIO-Clipboard] Failed to load recent GIF preview: ${e.message}`);
            }
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

        // If no item is focused, start navigation from first item
        if (!allFocusable.includes(currentFocus)) {
            if (symbol === Clutter.KEY_Down && this._focusGrid.length > 0) {
                this._focusGrid[0][0].grab_key_focus();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }

        // Find current focus position in grid
        let rowIndex = -1, colIndex = -1;
        for (let r = 0; r < this._focusGrid.length; r++) {
            let c = this._focusGrid[r].indexOf(currentFocus);
            if (c !== -1) {
                rowIndex = r;
                colIndex = c;
                break;
            }
        }

        if (rowIndex === -1) return Clutter.EVENT_PROPAGATE;

        // Calculate next focus position based on arrow key
        let nextRow = rowIndex, nextCol = colIndex;

        if (symbol === Clutter.KEY_Up) {
            if (rowIndex > 0) {
                nextRow--;
            } else {
                return Clutter.EVENT_PROPAGATE; // Let menu handle upward navigation
            }
        } else if (symbol === Clutter.KEY_Down) {
            if (rowIndex < this._focusGrid.length - 1) {
                nextRow++;
            } else {
                return Clutter.EVENT_STOP; // Prevent navigation beyond last row
            }
        } else if (symbol === Clutter.KEY_Left) {
            if (colIndex > 0) nextCol--;
        } else if (symbol === Clutter.KEY_Right) {
            if (colIndex < this._focusGrid[rowIndex].length - 1) nextCol++;
        } else {
            return Clutter.EVENT_PROPAGATE;
        }

        // Handle single-item rows (like "Show All" buttons)
        if (this._focusGrid[nextRow].length === 1) {
            nextCol = 0;
        } else {
            nextCol = Math.min(nextCol, this._focusGrid[nextRow].length - 1);
        }

        const targetWidget = this._focusGrid[nextRow][nextCol];

        // Special handling for settings button (excluded from auto-focus)
        if (targetWidget === this._settingsBtn) {
            this._settingsBtn.can_focus = true;
            this._settingsBtn.grab_key_focus();

            // Disable focus participation again after focusing
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
        // Show the main tab bar
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            if (!this._isDestroyed) { // A safety check in case the tab is destroyed quickly
                this.emit('set-main-tab-bar-visibility', true);
            }
            return GLib.SOURCE_REMOVE;
        });

        this._renderAll();
        this._restoreFocus();
    }

    /**
     * Helper method to intelligently restore focus to the first content item
     * @private
     */
    _restoreFocus() {
        // Use idle_add to ensure the UI is fully rendered before grabbing focus
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (this._focusGrid.length === 0) {
                return GLib.SOURCE_REMOVE;
            }

            // Find the first actual content item (not a "Show All" button, not settings button)
            for (let i = 0; i < this._focusGrid.length; i++) {
                const row = this._focusGrid[i];

                // Skip empty rows
                if (row.length === 0) continue;

                const firstItemInRow = row[0];

                // Skip the settings button (always last)
                if (firstItemInRow === this._settingsBtn) continue;

                // Skip "Show All" buttons - they have the specific style class
                if (firstItemInRow.style_class?.includes('recently-used-show-all-button')) continue;

                // This is a content item! Focus it and exit
                firstItemInRow.grab_key_focus();
                return GLib.SOURCE_REMOVE;
            }

            // Fallback: if somehow no content items exist, focus the first thing
            if (this._focusGrid[0] && this._focusGrid[0][0]) {
                this._focusGrid[0][0].grab_key_focus();
            }

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
        this._isDestroyed = true;
        if (this._httpSession) {
            this._httpSession.abort();
            this._httpSession = null;
        }
        this._signalIds.forEach(({ obj, id }) => {
            try {
                obj.disconnect(id);
            } catch (e) {
                // Ignore disconnection errors
            }
        });

        Object.values(this._recentManagers).forEach(m => m?.destroy());

        super.destroy();
    }
});
