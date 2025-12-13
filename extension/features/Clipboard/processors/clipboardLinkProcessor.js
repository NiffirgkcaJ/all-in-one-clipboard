import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

import { IOFile } from '../../../shared/utilities/utilityIO.js';
import { ServiceImage } from '../../../shared/services/serviceImage.js';

import { ClipboardType } from '../constants/clipboardConstants.js';
import { ProcessorUtils } from '../utilities/clipboardProcessorUtils.js';

// Validation Patterns
const URL_REGEX = /^(https?:\/\/[^\s]+)$/i;

const SESSION_TIMEOUT = 5;
const HTML_CHUNK_SIZE = 50000;

/**
 * Handles URL detection and metadata fetching with comprehensive favicon detection.
 */
export class LinkProcessor {
    /**
     * Initializes the LinkProcessor with a Soup session.
     */
    constructor() {
        this._session = new Soup.Session();
        this._session.timeout = SESSION_TIMEOUT;
    }

    /**
     * Extracts link data from the clipboard.
     * @param {string} text - The text to process.
     * @returns {Object|null} An object containing URL data or null if not a URL.
     */
    static process(text) {
        if (!text) return null;
        const cleanText = text.trim();

        if (URL_REGEX.test(cleanText)) {
            const hash = ProcessorUtils.computeHashForString(cleanText);

            return {
                type: ClipboardType.URL,
                url: cleanText,
                title: cleanText,
                hash: hash,
            };
        }
        return null;
    }

    /**
     * Fetches title and favicon URL with comprehensive detection.
     * @param {string} url - The URL to fetch metadata for.
     * @returns {Promise<Object>} { title: string|null, iconUrl: string|null }
     */
    async fetchMetadata(url) {
        try {
            const message = Soup.Message.new('GET', url);
            const bytes = await this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);

            if (message.status_code !== 200 || !bytes) return { title: null, iconUrl: null };

            const data = bytes.get_data();
            const chunk = data instanceof Uint8Array ? data : new Uint8Array(data);
            const html = new TextDecoder('utf-8').decode(chunk.slice(0, HTML_CHUNK_SIZE));

            const title = this._extractTitle(html);
            let iconUrl = await this._extractIconUrl(html, url);

            if (!iconUrl) {
                iconUrl = await this._tryFaviconFallback(url);
            }
            if (!iconUrl) {
                iconUrl = this._getGoogleFaviconUrl(url);
            }

            return { title, iconUrl };
        } catch {
            return { title: null, iconUrl: null };
        }
    }

    /**
     * Extract page title with multiple fallback strategies.
     * @param {string} html - The HTML content.
     * @returns {string|null} The extracted title or null.
     * @private
     */
    _extractTitle(html) {
        const titleMatch = html.match(/<title[^>]*>([^]*?)<\/title>/i);
        if (titleMatch?.[1]?.trim()) {
            return this._decodeEntities(titleMatch[1].trim().replace(/\s+/g, ' '));
        }

        const ogPatterns = [/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i, /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i];
        for (const pattern of ogPatterns) {
            const match = html.match(pattern);
            if (match?.[1]) {
                return this._decodeEntities(match[1].trim());
            }
        }

        const twitterPatterns = [/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i, /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:title["']/i];
        for (const pattern of twitterPatterns) {
            const match = html.match(pattern);
            if (match?.[1]) {
                return this._decodeEntities(match[1].trim());
            }
        }

        return null;
    }

    /**
     * Extract favicon URL with comprehensive multi-source detection.
     * Priority order: manifest icons > apple-touch-icon > standard icon > MS tile > og:image
     * @param {string} html - The HTML content.
     * @param {string} baseUrl - The base URL for resolving relative paths.
     * @returns {Promise<string|null>} The resolved icon URL or null.
     * @private
     */
    async _extractIconUrl(html, baseUrl) {
        const manifestUrl = await this._extractManifestIconUrl(html, baseUrl);
        if (manifestUrl) return manifestUrl;

        const iconPatterns = [
            // Apple Touch icons
            /<link[^>]+rel=["']apple-touch-icon(?:-precomposed)?["'][^>]+href=["']([^"']+)["']/i,
            /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']apple-touch-icon(?:-precomposed)?["']/i,

            // Standard favicon with sizes
            /<link[^>]+rel=["']icon["'][^>]+sizes=["']\d+x\d+["'][^>]+href=["']([^"']+)["']/i,
            /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']icon["'][^>]+sizes=["']\d+x\d+["']/i,
            /<link[^>]+sizes=["']\d+x\d+["'][^>]+rel=["']icon["'][^>]+href=["']([^"']+)["']/i,

            // Standard icon
            /<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i,
            /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'](?:shortcut )?icon["']/i,

            // Safari mask-icon
            /<link[^>]+rel=["']mask-icon["'][^>]+href=["']([^"']+)["']/i,
            /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']mask-icon["']/i,

            // Microsoft tile image
            /<meta[^>]+name=["']msapplication-TileImage["'][^>]+content=["']([^"']+)["']/i,
            /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']msapplication-TileImage["']/i,

            // Open Graph image
            /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
            /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
        ];

        for (const pattern of iconPatterns) {
            const match = html.match(pattern);
            if (match?.[1]) {
                return this._resolveUrl(match[1], baseUrl);
            }
        }

        return null;
    }

    /**
     * Extract icon URL from web app manifest file.
     * @param {string} html - The HTML content.
     * @param {string} baseUrl - The base URL.
     * @returns {Promise<string|null>} The icon URL or null.
     * @private
     */
    async _extractManifestIconUrl(html, baseUrl) {
        const manifestPatterns = [/<link[^>]+rel=["']manifest["'][^>]+href=["']([^"']+)["']/i, /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']manifest["']/i];

        let manifestPath = null;
        for (const pattern of manifestPatterns) {
            const match = html.match(pattern);
            if (match?.[1]) {
                manifestPath = match[1];
                break;
            }
        }

        if (!manifestPath) return null;

        try {
            const manifestUrl = this._resolveUrl(manifestPath, baseUrl);
            if (!manifestUrl) return null;

            const message = Soup.Message.new('GET', manifestUrl);
            const bytes = await this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);

            if (message.status_code !== 200 || !bytes) return null;

            const manifestText = new TextDecoder('utf-8').decode(bytes.get_data());
            const manifest = JSON.parse(manifestText);

            if (!manifest.icons || !Array.isArray(manifest.icons)) return null;

            const sortedIcons = manifest.icons
                .filter((icon) => icon.src)
                .sort((a, b) => {
                    const sizeA = parseInt(a.sizes?.split('x')[0] || '0', 10);
                    const sizeB = parseInt(b.sizes?.split('x')[0] || '0', 10);
                    return sizeB - sizeA;
                });

            if (sortedIcons.length > 0) {
                return this._resolveUrl(sortedIcons[0].src, manifestUrl);
            }
        } catch {
            // Manifest parsing failed
        }

        return null;
    }

    /**
     * Try fetching /favicon.ico from the domain root as a fallback.
     * @param {string} baseUrl - The original URL.
     * @returns {Promise<string|null>} The favicon URL if it exists, or null.
     * @private
     */
    async _tryFaviconFallback(baseUrl) {
        try {
            const originMatch = baseUrl.match(/^(https?:\/\/[^/]+)/);
            if (!originMatch) return null;

            const faviconUrl = `${originMatch[1]}/favicon.ico`;
            const message = Soup.Message.new('HEAD', faviconUrl);

            await this._session.send_async(message, GLib.PRIORITY_DEFAULT, null);

            if (message.status_code === 200) {
                return faviconUrl;
            }
        } catch {
            // Ignore errors
        }
        return null;
    }

    /**
     * Get Google's S2 Favicon API URL as ultimate fallback.
     * @param {string} url - The website URL.
     * @returns {string} The Google favicon API URL.
     * @private
     */
    _getGoogleFaviconUrl(url) {
        try {
            const uri = GLib.Uri.parse(url, GLib.UriFlags.NONE);
            const domain = uri.get_host();
            return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
        } catch {
            return null;
        }
    }

    /**
     * Resolve a relative URL against a base URL.
     * @param {string} relativeUrl - The URL to resolve.
     * @param {string} baseUrl - The base URL.
     * @returns {string|null} The resolved URL or null.
     * @private
     */
    _resolveUrl(relativeUrl, baseUrl) {
        if (!relativeUrl) return null;

        if (relativeUrl.startsWith('data:')) return null;

        try {
            const baseUri = GLib.Uri.parse(baseUrl, GLib.UriFlags.NONE);
            return GLib.Uri.resolve_relative(baseUri.to_string(), relativeUrl, GLib.UriFlags.NONE);
        } catch {
            if (relativeUrl.startsWith('//')) {
                return 'https:' + relativeUrl;
            } else if (relativeUrl.startsWith('/')) {
                const match = baseUrl.match(/^(https?:\/\/[^/]+)/);
                return match ? match[1] + relativeUrl : null;
            } else if (relativeUrl.startsWith('http')) {
                return relativeUrl;
            }
            return null;
        }
    }

    /**
     * Downloads the icon to the cache directory.
     * @param {string} iconUrl - The URL of the icon to download.
     * @param {string} destinationDir - The directory to save the icon.
     * @param {string} fileBasename - The base filename (without extension).
     * @returns {Promise<string|null>} The saved filename, or null.
     */
    async downloadFavicon(iconUrl, destinationDir, fileBasename) {
        if (!iconUrl) return null;

        try {
            const message = Soup.Message.new('GET', iconUrl);
            const bytes = await this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);

            if (message.status_code !== 200 || !bytes || bytes.get_size() === 0) return null;

            const contentType = message.get_response_headers().get_one('Content-Type') || '';
            const ext = this._getExtensionFromContentType(contentType, iconUrl);

            const filename = `${fileBasename}.${ext}`;
            const filePath = GLib.build_filenamev([destinationDir, filename]);

            const success = await IOFile.write(filePath, ServiceImage.encode(bytes.get_data()));
            if (!success) return null;

            return filename;
        } catch {
            return null;
        }
    }

    /**
     * Determine file extension from Content-Type or URL.
     * @param {string} contentType - The Content-Type header value.
     * @param {string} url - The icon URL.
     * @returns {string} The file extension.
     * @private
     */
    _getExtensionFromContentType(contentType, url) {
        const urlLower = url.toLowerCase();

        if (contentType.includes('svg')) return 'svg';
        if (contentType.includes('ico') || contentType.includes('x-icon')) return 'ico';
        if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
        if (contentType.includes('gif')) return 'gif';
        if (contentType.includes('webp')) return 'webp';
        if (contentType.includes('png')) return 'png';

        if (urlLower.endsWith('.svg')) return 'svg';
        if (urlLower.endsWith('.ico')) return 'ico';
        if (urlLower.endsWith('.jpg') || urlLower.endsWith('.jpeg')) return 'jpg';
        if (urlLower.endsWith('.gif')) return 'gif';
        if (urlLower.endsWith('.webp')) return 'webp';

        return 'png';
    }

    /**
     * Regenerate icon for an existing item.
     * @param {Object} item - The clipboard item.
     * @param {string} linkPreviewsDir - The directory for link previews.
     * @returns {Promise<string|null>} The new filename or null.
     */
    async regenerateIcon(item, linkPreviewsDir) {
        if (!item.url || !this._session) return null;

        const { iconUrl } = await this.fetchMetadata(item.url);
        if (iconUrl) {
            return await this.downloadFavicon(iconUrl, linkPreviewsDir, item.id);
        }
        return null;
    }

    /**
     * Decode HTML entities
     * @param {string} str - The string to decode.
     * @returns {string} The decoded string.
     * @private
     */
    _decodeEntities(str) {
        return str
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&#x27;/g, "'")
            .replace(/&#x2F;/g, '/')
            .replace(/&nbsp;/g, ' ')
            .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
            .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    }

    /**
     * Cleanup resources
     */
    destroy() {
        if (this._session) {
            this._session.abort();
            this._session = null;
        }
    }
}
