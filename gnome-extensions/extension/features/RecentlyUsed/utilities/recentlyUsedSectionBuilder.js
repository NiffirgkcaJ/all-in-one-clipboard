import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import { ensureActorVisibleInScrollView } from 'resource:///org/gnome/shell/misc/animationUtils.js';

import { RecentlyUsedViewRenderer } from '../view/recentlyUsedViewRenderer.js';
import { RecentlyUsedStyles } from '../constants/recentlyUsedConstants.js';

/**
 * Add a collapsible section with header and Show All button.
 *
 * @param {object} params
 * @param {St.BoxLayout} params.mainContainer Main vertical content container
 * @param {object} params.sectionConfig Section configuration metadata
 * @param {St.ScrollView} params.scrollView Outer scroll view
 * @param {Function} params.onNavigateToMainTab Callback to navigate to another main tab
 * @param {Function} params.onUnlockOuterScroll Callback to unlock outer scroll
 * @param {Function} params.getScrollIntoViewIdleId Getter for active scroll idle id
 * @param {Function} params.setScrollIntoViewIdleId Setter for active scroll idle id
 * @param {Function} params.setPreviousFocus Setter for previous focus actor
 * @returns {object} Created section entry
 */
export function buildRecentlyUsedSection({ mainContainer, sectionConfig, scrollView, onNavigateToMainTab, onUnlockOuterScroll, getScrollIntoViewIdleId, setScrollIntoViewIdleId, setPreviousFocus }) {
    const separator = RecentlyUsedViewRenderer.createSectionSeparator();
    mainContainer.add_child(separator);

    const section = new St.BoxLayout({
        vertical: true,
        style_class: RecentlyUsedStyles.SECTION,
        x_expand: true,
    });

    const { header, showAllBtn } = RecentlyUsedViewRenderer.createSectionHeader(sectionConfig.getTitle());
    showAllBtn.connect('clicked', () => {
        onNavigateToMainTab(sectionConfig.targetTab);
    });

    showAllBtn.connect('key-focus-in', () => {
        onUnlockOuterScroll();
        setPreviousFocus(showAllBtn);

        const currentIdleId = getScrollIntoViewIdleId();
        if (currentIdleId) {
            GLib.source_remove(currentIdleId);
            setScrollIntoViewIdleId(0);
        }

        const nextIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            setScrollIntoViewIdleId(0);
            ensureActorVisibleInScrollView(scrollView, showAllBtn);
            return GLib.SOURCE_REMOVE;
        });
        setScrollIntoViewIdleId(nextIdleId);
    });

    section.add_child(header);

    const bodyContainer = new St.Bin({
        x_expand: true,
        x_align: Clutter.ActorAlign.FILL,
    });

    section.add_child(bodyContainer);
    mainContainer.add_child(section);

    return { section, showAllBtn, bodyContainer, separator };
}
