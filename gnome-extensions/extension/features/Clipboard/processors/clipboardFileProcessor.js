import GLib from 'gi://GLib';

import { IOFile } from '../../../shared/utilities/utilityIO.js';

import { ClipboardType } from '../constants/clipboardConstants.js';
import { ProcessorUtils } from '../utilities/clipboardProcessorUtils.js';

// Configuration
const MAX_PREVIEW_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * FileProcessor
 *
 * Analyzes file URIs from the clipboard, delegating image files to the ImageProcessor.
 */
export class FileProcessor {
    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Analyze a text string to determine if it represents a valid file URI or path.
     *
     * @param {string} text Potential URI string.
     * @returns {Promise<Object|null>} Processed file or image object, or null if invalid.
     */
    static async process(text) {
        if (!text) return null;

        const cleanText = text.trim();

        if (!cleanText.startsWith('file://') && !cleanText.startsWith('/')) {
            return null;
        }

        const lines = cleanText.split(/[\r\n]+/).filter((l) => l.trim() !== '');
        if (lines.length !== 1) return null;

        const uri = lines[0].startsWith('file://') ? lines[0] : `file://${lines[0]}`;
        let path = null;

        if (cleanText.startsWith('file://')) {
            try {
                [path] = GLib.filename_from_uri(uri);
            } catch {
                return null;
            }
        } else {
            path = cleanText;
        }

        if (!path) return null;

        const info = await IOFile.getInfo(path);
        if (!info || !info.type.is('REGULAR')) {
            return null;
        }

        const { mime, size, name: filename } = info;

        // Image
        if (mime && mime.startsWith('image/') && size <= MAX_PREVIEW_SIZE_BYTES) {
            const bytes = await IOFile.read(path);

            if (bytes && bytes.length > 0) {
                const hash = ProcessorUtils.computeHashForData(bytes);

                return {
                    type: ClipboardType.IMAGE,
                    data: bytes,
                    hash,
                    mimetype: mime,
                    file_uri: uri,
                };
            }
        }

        // Generic
        const uriHash = ProcessorUtils.computeHashForString(uri);

        return {
            type: ClipboardType.FILE,
            file_uri: uri,
            preview: filename,
            hash: uriHash,
        };
    }
}
