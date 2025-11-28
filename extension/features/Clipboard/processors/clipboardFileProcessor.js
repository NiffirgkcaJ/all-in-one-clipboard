import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { ClipboardType } from '../constants/clipboardConstants.js';

const MAX_PREVIEW_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

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

        try {
            const file = Gio.File.new_for_uri(uri);

            // Safely query metadata without reading file content
            const info = file.query_info('standard::name,standard::content-type,standard::type,standard::size', Gio.FileQueryInfoFlags.NONE, null);

            if (info.get_file_type() !== Gio.FileType.REGULAR) {
                return null;
            }

            const mime = info.get_content_type();
            const size = info.get_size();
            const filename = info.get_name();

            // Image File
            if (mime && mime.startsWith('image/') && size <= MAX_PREVIEW_SIZE_BYTES) {
                const bytes = await new Promise((resolve) => {
                    file.load_contents_async(null, (source, res) => {
                        try {
                            const [ok, content] = source.load_contents_finish(res);
                            resolve(ok ? content : null);
                        } catch {
                            resolve(null);
                        }
                    });
                });

                if (bytes && bytes.length > 0) {
                    const hash = GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, bytes);
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
            const uriHash = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, uri, -1);
            return {
                type: ClipboardType.FILE,
                file_uri: uri,
                preview: filename, // Store filename as the preview text
                hash: uriHash,
            };
        } catch {
            // Permission errors, invalid URIs, etc.
            return null;
        }
    }
}
