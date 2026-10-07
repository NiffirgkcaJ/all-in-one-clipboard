import GLib from 'gi://GLib';

import { IOFile } from '../../../shared/utilities/utilityIO.js';

import { ClipboardType } from '../constants/clipboardPluginConstants.js';
import { ProcessorUtils } from '../utilities/clipboardProcessorUtils.js';

// Configuration
const MAX_PREVIEW_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * ResourceProcessor
 *
 * Analyzes resource file and directory URIs from the clipboard, delegating image files to the ImageProcessor.
 */
export class ResourceProcessor {
    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Analyze a text string to determine if it represents valid file or directory URIs.
     *
     * @param {string} text Potential URI string.
     * @param {object} [context] Processing context.
     * @returns {Promise<Object|null>} Processed resource or image object, or null if invalid.
     */
    static async process(text, context = {}) {
        if (!text) return null;

        const cleanText = text.trim();
        const lines = cleanText
            .split(/[\r\n]+/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0);

        if (lines.length === 0) return null;

        const isFilePattern = lines.every((line) => line.startsWith('file://') || line.startsWith('/'));
        if (!isFilePattern) return null;

        const candidates = ResourceProcessor._parseCandidates(lines);
        if (candidates.length === 0) return null;

        const validItems = await ResourceProcessor._resolveValidItems(candidates);
        if (!validItems) return null;

        // Exclusion Check
        if (context.exclusionUtils) {
            const uris = validItems.map((item) => item.uri);
            if (context.exclusionUtils.isPathExcluded(uris)) {
                return {
                    type: ClipboardType.RESOURCE,
                    suppressed: true,
                };
            }
        }

        if (validItems.length === 1) {
            return await ResourceProcessor._createSingleResult(validItems[0]);
        }

        return ResourceProcessor._createMultipleResult(validItems);
    }

    // ========================================================================
    // Internal Helpers
    // ========================================================================

    /**
     * Parse URI or file path candidates from input lines.
     *
     * @param {string[]} lines Candidate input lines.
     * @returns {Array<object>} Candidate URI and path pairs.
     * @private
     */
    static _parseCandidates(lines) {
        const candidates = [];
        for (const line of lines) {
            const uri = line.startsWith('file://') ? line : `file://${line}`;
            let path = null;
            try {
                [path] = GLib.filename_from_uri(uri);
            } catch {
                path = line.startsWith('/') ? line : null;
            }
            if (!path) return [];
            candidates.push({ uri, path });
        }
        return candidates;
    }

    /**
     * Resolve filesystem information for candidate paths.
     *
     * @param {Array<object>} candidates Candidate URI and path pairs.
     * @returns {Promise<Array<object>|null>} Validated resource items or null.
     * @private
     */
    static async _resolveValidItems(candidates) {
        const itemResults = await Promise.all(
            candidates.map(async (candidate) => {
                const info = await IOFile.getInfo(candidate.path);
                if (!info) return null;

                const isRegular = info.type.is('REGULAR');
                const isDirectory = info.type.is('DIRECTORY');
                if (!isRegular && !isDirectory) return null;

                return {
                    ...candidate,
                    name: info.name || GLib.path_get_basename(candidate.path),
                    isRegular,
                    isDirectory,
                    mime: info.mime,
                    size: info.size,
                };
            }),
        );

        if (itemResults.some((item) => item === null)) {
            return null;
        }

        return itemResults;
    }

    /**
     * Create result for a single file or directory item.
     *
     * @param {object} single Resolved item descriptor.
     * @returns {Promise<object>} Clipboard result object.
     * @private
     */
    static async _createSingleResult(single) {
        if (single.isRegular && single.mime && single.mime.startsWith('image/') && single.size <= MAX_PREVIEW_SIZE_BYTES) {
            const bytes = await IOFile.read(single.path);

            if (bytes && bytes.length > 0) {
                const hash = ProcessorUtils.computeHashForData(bytes);

                return {
                    type: ClipboardType.IMAGE,
                    data: bytes,
                    hash,
                    mimetype: single.mime,
                    file_uri: single.uri,
                };
            }
        }

        const subtype = single.isDirectory ? 'folder' : 'file';
        const uriHash = ProcessorUtils.computeHashForString(single.uri);

        return {
            type: ClipboardType.RESOURCE,
            subtype,
            count: 1,
            file_uri: single.uri,
            preview: single.name,
            hash: uriHash,
        };
    }

    /**
     * Create result for multiple file and directory items.
     *
     * @param {Array<object>} validItems Resolved item descriptors.
     * @returns {object} Clipboard result object.
     * @private
     */
    static _createMultipleResult(validItems) {
        const allDirectories = validItems.every((item) => item.isDirectory);
        const allRegular = validItems.every((item) => item.isRegular);
        let subtype = 'items';
        let itemLabel = 'item';
        let itemsLabel = 'items';

        if (allDirectories) {
            subtype = 'folders';
            itemLabel = 'folder';
            itemsLabel = 'folders';
        } else if (allRegular) {
            subtype = 'files';
            itemLabel = 'file';
            itemsLabel = 'files';
        }

        const count = validItems.length;
        const firstItem = validItems[0];
        const remaining = count - 1;
        const noun = remaining === 1 ? itemLabel : itemsLabel;
        const preview = `${firstItem.name} and ${remaining} other ${noun}`;
        const allUris = validItems.map((item) => item.uri).join('\n');
        const uriHash = ProcessorUtils.computeHashForString(allUris);

        return {
            type: ClipboardType.RESOURCE,
            subtype,
            count,
            file_uri: allUris,
            preview,
            hash: uriHash,
        };
    }
}
