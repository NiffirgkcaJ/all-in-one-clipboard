import Clutter from 'gi://Clutter';
import St from 'gi://St';

import { RecentlyUsedDefaultPolicy } from '../constants/recentlyUsedPolicyConstants.js';
import { RecentlyUsedUI } from '../constants/recentlyUsedConstants.js';

/**
 * Render a flat grid section with items in wrapped rows.
 *
 * @param {object} params
 * @param {string} params.id Section id
 * @param {object} params.sections Section map
 * @param {Array<object>} params.items Pre-resolved and truncated items
 * @param {object} [params.gridLayout] Grid layout settings
 * @param {number} [params.gridLayout.columnCount] Number of columns for wrapped grid rows
 * @param {Array<Array<object>>} params.focusGrid Focus matrix
 * @param {Function} params.createItemWidget Callback creating item widgets
 */
export function renderRecentlyUsedGridSection({ id, sections, items, gridLayout, focusGrid, createItemWidget }) {
    const sectionData = sections[id];
    const rawColumnCount = gridLayout?.columnCount;
    const columnCount = Number.isFinite(rawColumnCount) && rawColumnCount > 0 ? Math.floor(rawColumnCount) : RecentlyUsedDefaultPolicy.GRID_WINDOW_COLUMNS;

    sectionData.section.show();
    focusGrid.push([sectionData.showAllBtn]);

    const grid = new St.Widget({
        layout_manager: new Clutter.GridLayout({
            column_homogeneous: true,
            column_spacing: RecentlyUsedUI.GRID_COLUMN_SPACING,
            row_spacing: RecentlyUsedUI.GRID_ROW_SPACING,
        }),
        x_expand: true,
    });

    const layout = grid.get_layout_manager();
    const focusRows = [];

    items.forEach((item, index) => {
        const row = Math.floor(index / columnCount);
        const col = index % columnCount;
        const widget = createItemWidget(item, id);
        layout.attach(widget, col, row, 1, 1);

        if (!focusRows[row]) {
            focusRows[row] = [];
        }
        focusRows[row].push(widget);
    });

    focusRows.forEach((rowWidgets) => {
        if (rowWidgets?.length > 0) {
            focusGrid.push(rowWidgets);
        }
    });

    sectionData.bodyContainer.set_child(grid);
}
