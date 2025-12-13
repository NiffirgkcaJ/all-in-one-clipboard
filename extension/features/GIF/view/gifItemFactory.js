import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import { ensureActorVisibleInScrollView } from 'resource:///org/gnome/shell/misc/animationUtils.js';

import { createStaticIcon } from '../../../shared/utilities/utilityIcon.js';
import { IOFile } from '../../../shared/utilities/utilityIO.js';

import { getGifCacheManager } from '../logic/gifCacheManager.js';
import { GifIcons } from '../constants/gifConstants.js';

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
        this._renderSession = {};
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

        bin.tooltip_text = String(itemData.description || '');

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
            const filePath = GLib.build_filenamev([this._cacheDir, filename]);

            if (!IOFile.existsSync(filePath)) {
                await this._downloadService.downloadAndSave(url, filePath);

                getGifCacheManager().triggerDebouncedCleanup();
            }

            if (session !== this._renderSession) {
                return;
            }

            const imageActor = new St.Bin({
                style: `
                    background-image: url("file://${filePath}");
                    background-size: cover;
                    background-repeat: no-repeat;
                `,
                x_expand: true,
                y_expand: true,
            });

            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (session !== this._renderSession) {
                    return GLib.SOURCE_REMOVE;
                }

                bin.set_child(imageActor);
                return GLib.SOURCE_REMOVE;
            });
        } catch (e) {
            if (session !== this._renderSession) {
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
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            if (bin.get_stage()) {
                bin.set_child(createStaticIcon(GifIcons.ERROR_PLACEHOLDER));
            }
            return GLib.SOURCE_REMOVE;
        });

        if (!error.message.startsWith('GIF Tab') && !error.message.startsWith('Render session')) {
            console.warn(`[AIO-Clipboard] Failed to load GIF preview: ${error.message}`);
        }
    }

    /**
     * Clean up resources.
     */
    destroy() {
        this._renderSession = Symbol('destroyed');
    }
}
