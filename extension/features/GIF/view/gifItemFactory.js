import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import { ensureActorVisibleInScrollView } from 'resource:///org/gnome/shell/misc/animationUtils.js';
import { getGifCacheManager } from '../logic/gifCacheManager.js';

/**
 * GifItemFactory
 *
 * Responsible for creating UI widgets for GIF items.
 */
export class GifItemFactory {
    /**
     * @param {GifDownloadService} downloadService - Service for downloading images
     * @param {string} cacheDir - Directory to store preview images
     * @param {object} scrollView - The scroll view to ensure visibility in
     */
    constructor(downloadService, cacheDir, scrollView) {
        this._downloadService = downloadService;
        this._cacheDir = cacheDir;
        this._scrollView = scrollView;
        this._renderSession = {}; // Track current render session to avoid race conditions
    }

    /**
     * Start a new render session.
     * Call this before rendering a new batch of items to invalidate old async operations.
     */
    startNewSession() {
        this._renderSession = {};
    }

    /**
     * Create a masonry item widget for a GIF.
     *
     * @param {object} itemData - The GIF data
     * @param {Function} onSelected - Callback when item is selected
     * @returns {St.Bin|null} The created widget
     */
    createItem(itemData, onSelected) {
        if (!this._isValidItemData(itemData)) {
            console.warn('[AIO-Clipboard] Skipping item with invalid data:', itemData);
            return null;
        }

        const bin = new St.Bin({
            style_class: 'gif-grid-button button',
            reactive: true,
            can_focus: true,
            track_hover: true,
        });

        bin.tooltip_text = itemData.description || '';

        bin.connect('button-press-event', () => {
            onSelected(itemData);
            return Clutter.EVENT_STOP;
        });

        bin.connect('key-press-event', (actor, event) => {
            const symbol = event.get_key_symbol();
            if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
                onSelected(itemData);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        bin.connect('key-focus-in', () => {
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (this._scrollView) {
                    ensureActorVisibleInScrollView(this._scrollView, bin);
                }
                return GLib.SOURCE_REMOVE;
            });
        });

        this._loadPreviewImage(bin, itemData.preview_url, this._renderSession).catch(() => {
            /* Ignore */
        });

        return bin;
    }

    /**
     * Validate that item data has all required properties.
     *
     * @param {object} itemData - The item data to validate
     * @returns {boolean} True if valid
     * @private
     */
    _isValidItemData(itemData) {
        return itemData && itemData.preview_url && itemData.width && itemData.height;
    }

    /**
     * Load and set the preview image for a GIF item.
     *
     * @param {St.Bin} bin - The container widget
     * @param {string} url - The preview image URL
     * @param {object} session - Session object for tracking async operations
     * @private
     */
    async _loadPreviewImage(bin, url, session) {
        try {
            const hash = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, url, -1);
            const filename = `${hash}.gif`;
            const file = Gio.File.new_for_path(GLib.build_filenamev([this._cacheDir, filename]));

            if (!file.query_exists(null)) {
                await this._downloadService.downloadAndSave(url, file.get_path());

                getGifCacheManager().triggerDebouncedCleanup();
            }

            if (session !== this._renderSession) {
                return;
            }

            // Set the preview image
            const imageActor = new St.Bin({
                style: `
                    background-image: url("file://${file.get_path()}");
                    background-size: cover;
                    background-repeat: no-repeat;
                `,
                x_expand: true,
                y_expand: true,
            });

            bin.set_child(imageActor);
        } catch (e) {
            // Handle errors gracefully
            if (session !== this._renderSession || !bin.get_stage()) {
                return;
            }
            this._handleError(bin, e);
        }
    }

    /**
     * Handle errors when loading preview images.
     *
     * @param {St.Bin} bin - The container widget
     * @param {Error} error - The error that occurred
     * @private
     */
    _handleError(bin, error) {
        bin.set_child(
            new St.Icon({
                icon_name: 'image-missing-symbolic',
                icon_size: 64,
            }),
        );

        if (!error.message.startsWith('GIF Tab') && !error.message.startsWith('Render session')) {
            console.warn(`[AIO-Clipboard] Failed to load GIF preview: ${error.message}`);
        }
    }
}
