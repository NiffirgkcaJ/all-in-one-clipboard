import GLib from 'gi://GLib';

import { IOFile } from '../../../shared/utilities/utilityIO.js';

import { ClipboardType } from '../constants/clipboardConstants.js';
import { ProcessorUtils } from '../utilities/clipboardProcessorUtils.js';

// Configuration
const MAX_PREVIEW_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * FileProcessor - Handles file URIs from clipboard
 *
 * Pattern: Single-phase (process)
 * - process(): Analyzes file URIs, delegates image files to ImageProcessor
 */
export class FileProcessor {
    /**
     * Analyzes a text string to see if it is a valid file URI.
     *
     * @param {string} text - The potential URI string.
     * @returns {Promise<Object|null>}
     *   - { type: 'image', data, hash, mimetype, file_uri }
     *   - { type: 'file', file_uri, preview, hash }
     *   - null
     */
    static async process(text) {
        if (!text) return null;

        const cleanText = text.trim();
        // Must be a file URI or absolute path
        if (!cleanText.startsWith('file://') && !cleanText.startsWith('/')) {
            return null;
        }

        // Extract single URI from potential multi-line input
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

        // Image File
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

        // Generic File
        const uriHash = ProcessorUtils.computeHashForString(uri);
        return {
            type: ClipboardType.FILE,
            file_uri: uri,
            preview: filename, // Store filename as the preview text
            hash: uriHash,
        };
    }
}
