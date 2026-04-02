import St from 'gi://St';

import { RecentlyUsedNestedScrollView } from '../utilities/recentlyUsedNestedScrollView.js';
import { RecentlyUsedUI } from '../constants/recentlyUsedConstants.js';

/**
 * Render a pure nested section, with items inside an inner scroll container.
 * Always creates a scroll view. Returns layout result for focus wiring.
 *
 * @param {object} params
 * @param {string} params.id Section id
 * @param {object} params.nestedLayout Nested layout values
 * @param {number} params.nestedLayout.maxVisible Max visible items in nested viewport
 * @param {number} params.nestedLayout.itemHeight Height per nested row item
 * @param {object} params.sections Section map
 * @param {Array<object>} params.items Pre-resolved items (all items, no truncation)
 * @param {Array<Array<object>>} params.focusGrid Focus matrix
 * @param {Function} params.createItemWidget Callback creating item widgets
 * @param {object} params.scrollLockController Scroll lock controller
 * @returns {object} Layout result for focus wiring
 */
export function renderRecentlyUsedNestedSection({ id, nestedLayout, sections, items, focusGrid, createItemWidget, scrollLockController }) {
    const sectionData = sections[id];
    const maxVisible = nestedLayout?.maxVisible ?? RecentlyUsedUI.MAX_NESTED_DISPLAY_COUNT;
    const itemHeight = nestedLayout?.itemHeight ?? RecentlyUsedUI.NESTED_ITEM_HEIGHT;

    sectionData.section.show();
    focusGrid.push([sectionData.showAllBtn]);

    const container = new St.BoxLayout({ vertical: true, x_expand: true });

    const nestedScrollView = new RecentlyUsedNestedScrollView({
        hscrollbar_policy: St.PolicyType.NEVER,
        vscrollbar_policy: St.PolicyType.AUTOMATIC,
        overlay_scrollbars: true,
        x_expand: true,
    });
    nestedScrollView.style = `height: ${maxVisible * itemHeight}px;`;

    nestedScrollView.set_child(container);
    sectionData.bodyContainer.set_child(nestedScrollView);
    scrollLockController?.configureNestedScrollHandoff(nestedScrollView);

    const widgets = [];

    items.forEach((item) => {
        const widget = createItemWidget(item, id);
        container.add_child(widget);
        widgets.push(widget);
        focusGrid.push([widget]);
    });

    return {
        widgets,
        nestedScrollView,
        showAllBtn: sectionData.showAllBtn,
    };
}
