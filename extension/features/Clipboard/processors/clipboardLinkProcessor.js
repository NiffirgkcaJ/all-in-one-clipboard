import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

import { ClipboardType } from '../constants/clipboardConstants.js';

const URL_REGEX = /^(https?:\/\/[^\s]+)$/i;

export class LinkProcessor {
    /**
     * Extracts link data from the clipboard.
     * @param {string} text - The text to process.
     * @returns {Object|null} An object containing URL data or null if not a URL.
     */
    static process(text) {
        if (!text) return null;
        const cleanText = text.trim();

        if (URL_REGEX.test(cleanText)) {
            const hash = GLib.compute_checksum_for_string(
                GLib.ChecksumType.SHA256, cleanText, -1
            );

            return {
                type: ClipboardType.URL,
                url: cleanText,
                title: cleanText,
                hash: hash
            };
        }
        return null;
    }

    /**
     * Fetches title and favicon URL.
     * @returns {Promise<Object>} { title: string|null, iconUrl: string|null }
     */
    static async fetchMetadata(url) {
        const session = new Soup.Session();
        session.timeout = 5;

        try {
            const message = Soup.Message.new('GET', url);
            const bytes = await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);

            if (message.status_code !== 200 || !bytes) return { title: null, iconUrl: null };

            const decoder = new TextDecoder('utf-8');
            const data = bytes.get_data();
            // Read more data (30KB) to increase chance of finding <link> tags in headers
            const chunk = data instanceof Uint8Array ? data : new Uint8Array(data);
            const html = decoder.decode(chunk.slice(0, 30000));

            // Extract Title
            let title = null;
            const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
            if (titleMatch && titleMatch[1]) {
                title = this._decodeEntities(titleMatch[1].trim());
            }

            // Extract Favicon URL
            let iconUrl = null;
            // Look for <link rel="icon" ... href="..."> or rel="shortcut icon"
            const iconRegex = /<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i;
            const iconMatch = html.match(iconRegex);

            if (iconMatch && iconMatch[1]) {
                iconUrl = iconMatch[1];
            } else {
                // Fallback to /favicon.ico
            }

            // Resolve relative URLs
            if (iconUrl) {
                try {
                    // This GLib helper resolves relative paths against the base URI
                    const baseUri = GLib.Uri.parse(url, GLib.UriFlags.NONE);
                    const resolvedUri = GLib.Uri.resolve_relative(baseUri.to_string(), iconUrl, GLib.UriFlags.NONE);
                    iconUrl = resolvedUri || iconUrl;
                } catch (e) {
                    // Fallback manual resolution if GLib fails
                    if (iconUrl.startsWith('//')) {
                        iconUrl = 'https:' + iconUrl;
                    } else if (iconUrl.startsWith('/')) {
                        const match = url.match(/^(https?:\/\/[^\/]+)/);
                        if (match) iconUrl = match[1] + iconUrl;
                    }
                }
            }

            return { title, iconUrl };

        } catch (e) {
            return { title: null, iconUrl: null };
        }
    }

    /**
     * Downloads the icon to the cache directory.
     * @returns {Promise<string|null>} The saved filename, or null.
     */
    static async downloadFavicon(iconUrl, destinationDir, fileBasename) {
        if (!iconUrl) return null;

        const session = new Soup.Session();
        session.timeout = 5;

        try {
            const message = Soup.Message.new('GET', iconUrl);
            const bytes = await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);

            if (message.status_code !== 200 || !bytes) return null;

            // Determine extension from URL or Content-Type, default to .png
            let ext = 'png';
            if (iconUrl.endsWith('.ico')) ext = 'ico';
            else if (iconUrl.endsWith('.svg')) ext = 'svg';
            else if (iconUrl.endsWith('.jpg') || iconUrl.endsWith('.jpeg')) ext = 'jpg';

            const filename = `${fileBasename}.${ext}`;
            const file = Gio.File.new_for_path(
                GLib.build_filenamev([destinationDir, filename])
            );

            // Write to disk
            await new Promise((resolve, reject) => {
                file.replace_async(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, GLib.PRIORITY_DEFAULT, null, (src, res) => {
                    try {
                        const stream = src.replace_finish(res);
                        stream.write_bytes(bytes, null);
                        stream.close(null);
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            return filename;
        } catch (e) {
            return null;
        }
    }

    static _decodeEntities(str) {
        return str.replace(/&amp;/g, '&')
                  .replace(/&lt;/g, '<')
                  .replace(/&gt;/g, '>')
                  .replace(/&#39;/g, "'")
                  .replace(/&quot;/g, '"');
    }
}