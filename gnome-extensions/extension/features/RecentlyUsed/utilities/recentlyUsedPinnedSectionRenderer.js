import GLib from 'gi://GLib';
import St from 'gi://St';
import { ensureActorVisibleInScrollView } from 'resource:///org/gnome/shell/misc/animationUtils.js';

/**
 * Render pinned clipboard section.
 *
 * @param {object} params
 * @param {object} params.sections Section map
 * @param {object} params.clipboardManager Clipboard manager
 * @param {Array<Array<object>>} params.focusGrid Focus matrix
 * @param {Function} params.createFullWidthClipboardItem Widget builder callback
 * @param {object} params.recentlyUsedUI RecentlyUsedUI constants
 * @param {Function} params.createPinnedNestedScrollView Factory creating pinned nested scroll view
 * @param {Function} params.configurePinnedScrollHandoff Callback to wire nested handoff
 * @param {Function} params.unlockOuterScroll Callback to unlock outer scroll
 * @param {Function} params.lockOuterScroll Callback to lock outer scroll
 * @param {St.ScrollView} params.scrollView Outer scroll view
 * @param {Function} params.getPreviousFocus Getter for previous focus actor
 * @param {Function} params.setPreviousFocus Setter for previous focus actor
 * @param {Function} params.getScrollIntoViewIdleId Getter for active scroll idle id
 * @param {Function} params.setScrollIntoViewIdleId Setter for active scroll idle id
 * @param {Function} params.setLockTimeoutId Setter for lock timeout id
 * @returns {Set<object>} Set of pinned widgets used for focus-entry checks
 */
export function renderPinnedSection({
    sections,
    clipboardManager,
    focusGrid,
    createFullWidthClipboardItem,
    recentlyUsedUI,
    createPinnedNestedScrollView,
    configurePinnedScrollHandoff,
    unlockOuterScroll,
    lockOuterScroll,
    scrollView,
    getPreviousFocus,
    setPreviousFocus,
    getScrollIntoViewIdleId,
    setScrollIntoViewIdleId,
    setLockTimeoutId,
}) {
    const sectionData = sections.pinned;
    const items = clipboardManager.getPinnedItems();
    const pinnedWidgets = new Set();

    if (items.length === 0) {
        sectionData.section.hide();
        return pinnedWidgets;
    }

    sectionData.section.show();
    focusGrid.push([sectionData.showAllBtn]);

    const container = new St.BoxLayout({ vertical: true, x_expand: true });
    const useNestedScroll = items.length > recentlyUsedUI.MAX_PINNED_DISPLAY_COUNT;
    let pinnedScrollView = null;

    if (useNestedScroll) {
        pinnedScrollView = createPinnedNestedScrollView();
        pinnedScrollView.style = `height: ${recentlyUsedUI.MAX_PINNED_DISPLAY_COUNT * recentlyUsedUI.PINNED_ITEM_HEIGHT}px;`;

        pinnedScrollView.set_child(container);
        sectionData.bodyContainer.set_child(pinnedScrollView);
        configurePinnedScrollHandoff(pinnedScrollView);

        pinnedWidgets.add(sectionData.showAllBtn);
    }

    items.forEach((item) => {
        const widget = createFullWidthClipboardItem(item, true);
        container.add_child(widget);
        pinnedWidgets.add(widget);

        if (useNestedScroll) {
            widget.connect('key-focus-in', () => {
                const isEnteringFromOutside = !pinnedWidgets.has(getPreviousFocus());

                if (isEnteringFromOutside) {
                    unlockOuterScroll();

                    clearScrollIntoViewIdle(getScrollIntoViewIdleId, setScrollIntoViewIdleId);
                    const idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        setScrollIntoViewIdleId(0);
                        if (widget.get_stage()) {
                            ensureActorVisibleInScrollView(scrollView, sectionData.showAllBtn);
                            ensureActorVisibleInScrollView(pinnedScrollView, widget);

                            const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, recentlyUsedUI.OUTER_SCROLL_LOCK_DELAY_MS, () => {
                                setLockTimeoutId(null);
                                lockOuterScroll();
                                return GLib.SOURCE_REMOVE;
                            });
                            setLockTimeoutId(timeoutId);
                        }
                        return GLib.SOURCE_REMOVE;
                    });
                    setScrollIntoViewIdleId(idleId);
                } else {
                    lockOuterScroll();

                    clearScrollIntoViewIdle(getScrollIntoViewIdleId, setScrollIntoViewIdleId);
                    const idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        setScrollIntoViewIdleId(0);
                        if (widget.get_stage()) {
                            ensureActorVisibleInScrollView(pinnedScrollView, widget);
                        }
                        return GLib.SOURCE_REMOVE;
                    });
                    setScrollIntoViewIdleId(idleId);
                }

                setPreviousFocus(widget);
            });
        } else {
            widget.connect('key-focus-in', () => {
                unlockOuterScroll();

                clearScrollIntoViewIdle(getScrollIntoViewIdleId, setScrollIntoViewIdleId);
                const idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    setScrollIntoViewIdleId(0);
                    if (widget.get_stage()) {
                        ensureActorVisibleInScrollView(scrollView, widget);
                    }
                    return GLib.SOURCE_REMOVE;
                });
                setScrollIntoViewIdleId(idleId);

                setPreviousFocus(widget);
            });
        }

        focusGrid.push([widget]);
    });

    if (!useNestedScroll) {
        sectionData.bodyContainer.set_child(container);
    }

    return pinnedWidgets;
}

function clearScrollIntoViewIdle(getScrollIntoViewIdleId, setScrollIntoViewIdleId) {
    const idleId = getScrollIntoViewIdleId();
    if (!idleId) {
        return;
    }

    GLib.source_remove(idleId);
    setScrollIntoViewIdleId(0);
}
