/**
 * Orchestrate Recently Used section rendering and high-level visibility state.
 *
 * @param {object} params
 * @param {object} params.sections Section map
 * @param {Array<string>} params.sectionOrder Section display order
 * @param {St.ScrollView} params.scrollView Outer scroll view
 * @param {St.Bin} params.emptyView Empty-state actor
 * @param {St.Button} params.settingsBtn Floating settings button
 * @param {Array<Array<object>>} params.focusGrid Focus matrix
 * @param {Function} params.renderPinnedSection Callback to render pinned section
 * @param {Function} params.renderGridSection Callback to render grid section
 * @param {Function} params.renderListSection Callback to render list section
 */
export function renderRecentlyUsedSections({ sections, sectionOrder, scrollView, emptyView, settingsBtn, focusGrid, renderPinnedSection, renderGridSection, renderListSection }) {
    for (const id in sections) {
        sections[id].separator.visible = false;
    }

    renderPinnedSection();
    renderGridSection('emoji');
    renderGridSection('gif');
    renderListSection('kaomoji');
    renderGridSection('symbols');
    renderListSection('clipboard');

    const visibleSections = sectionOrder.map((id) => sections[id]).filter((sectionEntry) => sectionEntry && sectionEntry.section.visible);

    if (visibleSections.length === 0) {
        scrollView.visible = false;
        emptyView.visible = true;
    } else {
        scrollView.visible = true;
        emptyView.visible = false;

        for (let i = 1; i < visibleSections.length; i++) {
            visibleSections[i].separator.visible = true;
        }
    }

    focusGrid.push([settingsBtn]);
}
