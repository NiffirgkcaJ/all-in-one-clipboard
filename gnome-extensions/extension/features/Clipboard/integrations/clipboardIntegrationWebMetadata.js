// ============================================================================
// Public API
// ============================================================================

/**
 * Create a web metadata enrichment integration for items that can resolve a web address.
 *
 * @param {object} config Integration configuration.
 * @param {Function} config.resolveAddress Resolves the web address from an item.
 * @param {string} config.titleField Item field receiving the title.
 * @param {string} config.iconField Item field receiving the icon filename.
 * @param {boolean} config.updateTitle Whether title metadata should be written.
 * @param {Function} config.fetchMetadata Function that fetches metadata.
 * @param {Function} config.downloadFavicon Function that downloads a favicon.
 * @returns {Function} Async enrichment integration.
 */
export function ClipboardIntegrationWebMetadataEnrichment({ resolveAddress, titleField = 'title', iconField = 'icon_filename', updateTitle = true, fetchMetadata, downloadFavicon }) {
    return async (item, context = {}) => {
        const address = resolveAddress(item, context);
        if (!address || context.exclusionUtils.isAddressExcluded(address)) return;

        const metadata = await fetchMetadata(address, context);
        let nextTitle = null;
        let nextIconFilename = null;

        if (updateTitle && metadata?.title) {
            nextTitle = metadata.title;
        }

        if (metadata?.iconUrl) {
            nextIconFilename = await downloadFavicon(metadata.iconUrl, context.storage.linkPreviewsDir, item.id, context);
        }

        context.itemUpdateService.updateItemById(item.id, (targetItem) => {
            let updated = false;

            if (nextTitle) {
                targetItem[titleField] = nextTitle;
                updated = true;
            }

            if (nextIconFilename) {
                targetItem[iconField] = nextIconFilename;
                updated = true;
            }

            return updated;
        });
    };
}
