import St from 'gi://St';

/**
 * Render a flat list section with items in a single column.
 *
 * @param {object} params
 * @param {string} params.id Section id
 * @param {object} params.sections Section map
 * @param {Array<object>} params.items Pre-resolved and truncated items
 * @param {Array<Array<object>>} params.focusGrid Focus matrix
 * @param {Function} params.createItemWidget Callback creating item widgets
 */
export function renderRecentlyUsedListSection({ id, sections, items, focusGrid, createItemWidget }) {
    const sectionData = sections[id];

    sectionData.section.show();
    focusGrid.push([sectionData.showAllBtn]);

    const container = new St.BoxLayout({ vertical: true, x_expand: true });

    items.forEach((item) => {
        const widget = createItemWidget(item, id);
        container.add_child(widget);
        focusGrid.push([widget]);
    });

    sectionData.bodyContainer.set_child(container);
}
