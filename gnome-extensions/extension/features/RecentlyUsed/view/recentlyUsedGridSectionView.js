import Clutter from 'gi://Clutter';
import St from 'gi://St';

import { RecentlyUsedUI } from '../constants/recentlyUsedConstants.js';

/**
 * Render a compact grid section.
 *
 * @param {object} params
 * @param {string} params.id Section id
 * @param {object} params.sections Section map
 * @param {Array<object>} params.items Pre-resolved and truncated items
 * @param {Array<Array<object>>} params.focusGrid Focus matrix
 * @param {Function} params.createItemWidget Callback creating item widgets
 */
export function renderRecentlyUsedGridSection({ id, sections, items, focusGrid, createItemWidget }) {
    const sectionData = sections[id];

    sectionData.section.show();
    focusGrid.push([sectionData.showAllBtn]);

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
        const widget = createItemWidget(item, id);
        layout.attach(widget, index, 0, 1, 1);
        sectionFocusables.push(widget);
    });

    focusGrid.push(sectionFocusables);
    sectionData.bodyContainer.set_child(grid);
}
