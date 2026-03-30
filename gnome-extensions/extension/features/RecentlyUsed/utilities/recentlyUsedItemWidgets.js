import GLib from 'gi://GLib';
import { ensureActorVisibleInScrollView } from 'resource:///org/gnome/shell/misc/animationUtils.js';

import { RecentlyUsedViewRenderer } from '../view/recentlyUsedViewRenderer.js';

/**
 * Create a full-width list item button for clipboard/kaomoji content.
 *
 * @param {object} params
 * @param {object} params.itemData Item payload
 * @param {boolean} params.isPinned Whether item is pinned
 * @param {string} params.feature Feature id
 * @param {object} params.clipboardManager Clipboard manager
 * @param {number} params.imagePreviewSize Image preview size setting
 * @param {Function} params.onItemClicked Callback for click actions
 * @param {Function} params.unlockOuterScroll Callback to unlock outer scroll
 * @param {St.ScrollView} params.scrollView Outer scroll view
 * @param {Function} params.getScrollIntoViewIdleId Getter for active idle id
 * @param {Function} params.setScrollIntoViewIdleId Setter for active idle id
 * @returns {St.Button}
 */
export function createFullWidthClipboardButton({
    itemData,
    isPinned,
    feature,
    clipboardManager,
    imagePreviewSize,
    onItemClicked,
    unlockOuterScroll,
    scrollView,
    getScrollIntoViewIdleId,
    setScrollIntoViewIdleId,
}) {
    const context = {
        clipboardManager,
        imagePreviewSize,
    };

    const button = RecentlyUsedViewRenderer.createFullWidthListItem(itemData, isPinned, feature, context);

    button.connect('clicked', () => {
        const payload = itemData.type === 'kaomoji' ? itemData.rawItem : itemData;
        onItemClicked(payload, feature);
    });

    button.connect('key-focus-in', () => {
        unlockOuterScroll();

        clearScrollIntoViewIdle(getScrollIntoViewIdleId, setScrollIntoViewIdleId);
        const idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            setScrollIntoViewIdleId(0);
            if (button.get_stage()) {
                ensureActorVisibleInScrollView(scrollView, button);
            }
            return GLib.SOURCE_REMOVE;
        });
        setScrollIntoViewIdleId(idleId);
    });

    return button;
}

/**
 * Create a grid item button for emoji/GIF/symbol content.
 *
 * @param {object} params
 * @param {object} params.itemData Item payload
 * @param {string} params.feature Feature id
 * @param {Function} params.onItemClicked Callback for click actions
 * @param {Function} params.unlockOuterScroll Callback to unlock outer scroll
 * @param {St.ScrollView} params.scrollView Outer scroll view
 * @param {Function} params.getScrollIntoViewIdleId Getter for active idle id
 * @param {Function} params.setScrollIntoViewIdleId Setter for active idle id
 * @returns {St.Button}
 */
export function createGridButton({ itemData, feature, onItemClicked, unlockOuterScroll, scrollView, getScrollIntoViewIdleId, setScrollIntoViewIdleId }) {
    const button = RecentlyUsedViewRenderer.createGridItem(itemData, feature);

    button.connect('clicked', () => {
        onItemClicked(itemData, feature);
    });

    button.connect('key-focus-in', () => {
        unlockOuterScroll();

        clearScrollIntoViewIdle(getScrollIntoViewIdleId, setScrollIntoViewIdleId);
        const idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            setScrollIntoViewIdleId(0);
            ensureActorVisibleInScrollView(scrollView, button);
            return GLib.SOURCE_REMOVE;
        });
        setScrollIntoViewIdleId(idleId);
    });

    return button;
}

function clearScrollIntoViewIdle(getScrollIntoViewIdleId, setScrollIntoViewIdleId) {
    const idleId = getScrollIntoViewIdleId();
    if (!idleId) {
        return;
    }

    GLib.source_remove(idleId);
    setScrollIntoViewIdleId(0);
}
