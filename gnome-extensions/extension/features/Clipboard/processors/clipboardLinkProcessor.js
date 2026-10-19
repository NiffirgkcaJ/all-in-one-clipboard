import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

import { Logger } from '../../../shared/utilities/utilityLogger.js';
import { ResourceItem } from '../../../shared/constants/storagePaths.js';
import { IOFile, IOImage, IOJson, IOResource, IOText } from '../../../shared/utilities/utilityIO.js';

import { ClipboardType } from '../constants/clipboardPluginConstants.js';
import { ProcessorUtils } from '../utilities/clipboardProcessorUtils.js';

// Validation Patterns
const EMBEDDED_URL_REGEX = /(https?:\/\/[^\s<>"'\]}]+|\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}(?::\d+)?(?:\/[^\s<>"'\]}]*)?)/gi;
const BARE_CODE_EXTENSIONS = new Set(['py', 'sh', 'pl']);

// Configuration
const SESSION_TIMEOUT = 5;
const HTML_CHUNK_SIZE = 50000;
const MAX_URL_LENGTH = 2048;
const GOOGLE_FAVICON_SIZE = 64;
const IGNORED_HOSTS = new Set(['schemas.microsoft.com', 'schemas.openxmlformats.org', 'w3.org', 'www.w3.org']);

/**
 * LinkProcessor
 *
 * Handles URL detection and metadata fetching with comprehensive favicon detection.
 */
export class LinkProcessor {
    static _validTlds = null;
    static _initPromise = null;

    // ========================================================================
    // Initialization
    // ========================================================================

    /**
     * Initialize the LinkProcessor with a Soup session.
     */
    constructor() {
        this._httpSession = new Soup.Session();
        this._httpSession.timeout = SESSION_TIMEOUT;
    }

    /**
     * Asynchronously initialize authoritative top level domain set from GResource.
     *
     * @returns {Promise<void>} Initialization promise.
     */
    static init() {
        if (this._initPromise) return this._initPromise;

        this._initPromise = (async () => {
            try {
                const rawData = await IOResource.readJson(ResourceItem.TLDS);
                const tldsPayload = rawData ? rawData.data : null;

                if (tldsPayload && Array.isArray(tldsPayload.all)) {
                    this._validTlds = new Set(tldsPayload.all.map((tld) => tld.toLowerCase()));
                } else if (Array.isArray(tldsPayload)) {
                    this._validTlds = new Set(tldsPayload.map((tld) => tld.toLowerCase()));
                } else {
                    Logger.error('Failed to load tlds.json from GResource', 'LinkProcessor');
                }
            } catch (e) {
                Logger.warn(`Failed to load TLD data: ${e.message}`, 'LinkProcessor');
            }
        })();

        return this._initPromise;
    }

    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Check if a top level domain label is valid.
     *
     * @param {string} tld Top level domain string.
     * @returns {boolean} True when top level domain is valid.
     */
    static isValidTld(tld) {
        if (!tld) return false;
        if (!this._validTlds || this._validTlds.size === 0) return true;
        return this._validTlds.has(tld.toLowerCase().replace(/^\./, ''));
    }

    /**
     * Sanitize and validate a candidate URL string.
     *
     * @param {string} candidate The candidate URL string.
     * @returns {string|null} The clean URL or null when invalid.
     */
    static sanitizeUrl(candidate) {
        if (!candidate || candidate.length > MAX_URL_LENGTH) return null;

        let clean = candidate.trim();
        clean = LinkProcessor._stripWrappersAndDelimiters(clean);
        clean = LinkProcessor._normalizeCandidate(clean);
        if (!clean) return null;

        return LinkProcessor._validateUri(clean);
    }

    /**
     * Extract link data from the clipboard text.
     *
     * @param {string} text The text to process.
     * @returns {Object|null} An object containing URL data or null if not a URL.
     */
    static process(text) {
        if (!text) return null;

        if (text.length > MAX_URL_LENGTH) return null;

        const cleanText = text.trim();
        const sanitizedUrl = LinkProcessor.sanitizeUrl(cleanText);

        if (sanitizedUrl) {
            const hash = ProcessorUtils.computeHashForString(sanitizedUrl);

            return {
                type: ClipboardType.LINK,
                url: sanitizedUrl,
                title: sanitizedUrl,
                hash: hash,
            };
        }

        return null;
    }

    /**
     * Extract unique web links embedded within text.
     *
     * @param {string} text The text to scan for web links.
     * @param {number} limit Maximum number of links to extract.
     * @returns {Array<string>} Array of clean URL strings.
     */
    static extractLinks(text, limit = Infinity) {
        if (!text) return [];

        const matches = text.matchAll(EMBEDDED_URL_REGEX);
        const extracted = new Set();

        for (const match of matches) {
            if (extracted.size >= limit) break;

            const candidate = match[1];
            const sanitized = LinkProcessor.sanitizeUrl(candidate);
            if (sanitized) {
                extracted.add(sanitized);
            }
        }

        return Array.from(extracted);
    }

    /**
     * Fetch title and favicon URL for a given link.
     *
     * @param {string} url The URL to fetch metadata for.
     * @returns {Promise<Object>} Metadata object containing title and iconUrl.
     */
    async fetchMetadata(url) {
        try {
            const message = Soup.Message.new('GET', url);
            if (!message) return { title: null, iconUrl: null };

            const bytes = await new Promise((resolve, reject) => {
                this._httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, res) => {
                    try {
                        const result = session.send_and_read_finish(res);
                        resolve(result);
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            if (message.status_code !== 200 || !bytes) return { title: null, iconUrl: null };

            const data = bytes.get_data();
            const chunk = data instanceof Uint8Array ? data : new Uint8Array(data);
            const html = IOText.parseBytes(chunk.slice(0, HTML_CHUNK_SIZE)) || '';

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
     * Download a favicon to the local cache.
     *
     * @param {string} iconUrl The URL of the icon to download.
     * @param {string} destinationDir Directory to save the icon.
     * @param {string} fileBasename Base filename without extension.
     * @returns {Promise<string|null>} The saved filename or null on failure.
     */
    async downloadFavicon(iconUrl, destinationDir, fileBasename) {
        if (!iconUrl) return null;

        try {
            const result = await IOImage.download(this._httpSession, iconUrl);
            if (!result?.bytes || result.bytes.length === 0) return null;

            const ext = this._getExtensionFromContentType(result.contentType, iconUrl);
            const filename = `${fileBasename}.${ext}`;
            const filePath = GLib.build_filenamev([destinationDir, filename]);

            const success = await IOFile.write(filePath, IOImage.stringifyBytes(result.bytes));
            if (!success) return null;

            return filename;
        } catch {
            return null;
        }
    }

    /**
     * Regenerate the icon for an existing clipboard item.
     *
     * @param {Object} item The clipboard item.
     * @param {string} linkPreviewsDir Directory for link previews.
     * @returns {Promise<string|null>} The new filename or null.
     */
    async regenerateIcon(item, linkPreviewsDir) {
        if (!item.url || !this._httpSession) return null;

        const { iconUrl } = await this.fetchMetadata(item.url);

        if (iconUrl) {
            return await this.downloadFavicon(iconUrl, linkPreviewsDir, item.id);
        }

        return null;
    }

    // ========================================================================
    // Internal Helpers
    // ========================================================================

    /**
     * Strip outer wrapper characters, punctuation, and unclosed trailing delimiters.
     *
     * @param {string} str Candidate string to clean.
     * @returns {string} Cleaned candidate string.
     * @private
     */
    static _stripWrappersAndDelimiters(str) {
        let clean = str;
        let prev;
        do {
            prev = clean;

            // Markdown
            const markdownMatch = clean.match(/^\[[^\]]*\]\((.*?)\)$/);
            if (markdownMatch) {
                clean = markdownMatch[1].trim();
            }

            // Wrappers
            while (/^[<([{ "']/.test(clean)) {
                clean = clean.slice(1).trim();
            }

            // Punctuation
            while (/[.,;!?:]$/.test(clean)) {
                clean = clean.slice(0, -1);
            }

            // Delimiters
            while (
                /[>"'}]$/.test(clean) ||
                (clean.endsWith(']') && (clean.match(/\]/g) || []).length > (clean.match(/\[/g) || []).length) ||
                (clean.endsWith(')') && (clean.match(/\)/g) || []).length > (clean.match(/\(/g) || []).length)
            ) {
                clean = clean.slice(0, -1).trim();
            }
        } while (clean !== prev);

        return clean;
    }

    /**
     * Normalize candidate scheme and synthesize protocol for bare domains.
     *
     * @param {string} clean Candidate string.
     * @returns {string|null} Normalized candidate string or null when invalid.
     * @private
     */
    static _normalizeCandidate(clean) {
        if (clean.startsWith('xhttp://')) {
            return `http://${clean.slice(8)}`;
        }

        if (clean.startsWith('xhttps://')) {
            return `https://${clean.slice(9)}`;
        }

        if (clean.startsWith('http://') || clean.startsWith('https://')) {
            return clean;
        }

        const host = clean.split('/')[0].split(':')[0];
        if (LinkProcessor._isBareCodeFile(clean, host)) return null;

        if (LinkProcessor._isValidHost(host)) {
            return `https://${clean}`;
        }

        return null;
    }

    /**
     * Validate candidate URL scheme and hostname.
     *
     * @param {string} clean Candidate string.
     * @returns {string|null} Validated string or null.
     * @private
     */
    static _validateUri(clean) {
        if (!clean.startsWith('http://') && !clean.startsWith('https://')) return null;

        try {
            const uri = GLib.Uri.parse(clean, GLib.UriFlags.NONE);
            const scheme = uri.get_scheme();
            const host = uri.get_host();
            if ((scheme === 'http' || scheme === 'https') && LinkProcessor._isValidHost(host)) {
                return clean;
            }
        } catch {
            return null;
        }

        return null;
    }

    /**
     * Check if a hostname is valid.
     *
     * @param {string} host Hostname string to check.
     * @returns {boolean} True when hostname is valid.
     * @private
     */
    static _isValidHost(host) {
        if (!host) return false;

        const lowerHost = host.toLowerCase();
        if (IGNORED_HOSTS.has(lowerHost)) return false;

        if (lowerHost === 'localhost') return true;

        if (lowerHost.includes(':')) return true;

        if (/^(\d{1,3}\.){3}\d{1,3}$/.test(lowerHost)) return true;

        if (!lowerHost.includes('.')) return false;

        const labels = lowerHost.replace(/\.+$/, '').split('.');
        const tld = labels[labels.length - 1];

        return LinkProcessor.isValidTld(tld);
    }

    /**
     * Check if a candidate string is a standalone script file rather than a web domain.
     *
     * @param {string} candidate Candidate string.
     * @param {string} host Hostname string.
     * @returns {boolean} True when candidate is a standalone script file.
     * @private
     */
    static _isBareCodeFile(candidate, host) {
        if (candidate.includes('/') || candidate.toLowerCase().startsWith('www.')) return false;

        const labels = host.replace(/\.+$/, '').split('.');
        if (labels.length !== 2) return false;

        const tld = labels[1].toLowerCase();
        return BARE_CODE_EXTENSIONS.has(tld);
    }

    /**
     * Extract the page title from HTML content using multiple strategies.
     *
     * @param {string} html HTML content.
     * @returns {string|null} The extracted title or null.
     * @private
     */
    _extractTitle(html) {
        // Title
        const titleMatch = html.match(/<title[^>]*>([^]*?)<\/title>/i);
        if (titleMatch?.[1]?.trim()) {
            return this._decodeEntities(titleMatch[1].trim().replace(/\s+/g, ' '));
        }

        // Open Graph
        const ogPatterns = [/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i, /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i];
        for (const pattern of ogPatterns) {
            const match = html.match(pattern);
            if (match?.[1]) {
                return this._decodeEntities(match[1].trim());
            }
        }

        // Twitter
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
     * Extract the favicon URL from HTML content using multi-source detection.
     *
     * @param {string} html HTML content.
     * @param {string} baseUrl Base URL for resolving relative paths.
     * @returns {Promise<string|null>} The resolved icon URL or null.
     * @private
     */
    async _extractIconUrl(html, baseUrl) {
        const manifestUrl = await this._extractManifestIconUrl(html, baseUrl);
        if (manifestUrl) return manifestUrl;

        const iconPatterns = [
            // Apple Touch
            /<link[^>]+rel=["']apple-touch-icon(?:-precomposed)?["'][^>]+href=["']([^"']+)["']/i,
            /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']apple-touch-icon(?:-precomposed)?["']/i,

            // Sizes
            /<link[^>]+rel=["']icon["'][^>]+sizes=["']\d+x\d+["'][^>]+href=["']([^"']+)["']/i,
            /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']icon["'][^>]+sizes=["']\d+x\d+["']/i,
            /<link[^>]+sizes=["']\d+x\d+["'][^>]+rel=["']icon["'][^>]+href=["']([^"']+)["']/i,

            // Shortcut
            /<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i,
            /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'](?:shortcut )?icon["']/i,

            // Safari Mask
            /<link[^>]+rel=["']mask-icon["'][^>]+href=["']([^"']+)["']/i,
            /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']mask-icon["']/i,

            // Microsoft Tile
            /<meta[^>]+name=["']msapplication-TileImage["'][^>]+content=["']([^"']+)["']/i,
            /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']msapplication-TileImage["']/i,

            // Open Graph
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
     * Extract icon URL from a web app manifest file.
     *
     * @param {string} html HTML content.
     * @param {string} baseUrl Base URL.
     * @returns {Promise<string|null>} The icon URL or null.
     * @private
     */
    async _extractManifestIconUrl(html, baseUrl) {
        const manifestPatterns = [/<link[^>]+rel=["']manifest["'][^>]+href=["']([^"']+)["']/i, /<link[^>]+href=["']([^"']+)["']/i];

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
            if (!message) return null;

            const bytes = await new Promise((resolve, reject) => {
                this._httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, res) => {
                    try {
                        const result = session.send_and_read_finish(res);
                        resolve(result);
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            if (message.status_code !== 200 || !bytes) return null;

            const manifest = IOJson.parseBytes(bytes.get_data());
            if (!manifest) return null;

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
            // Manifest parsing failed.
        }

        return null;
    }

    /**
     * Try fetching /favicon.ico from the domain root as a fallback.
     *
     * @param {string} baseUrl Original URL.
     * @returns {Promise<string|null>} The favicon URL if it exists, or null.
     * @private
     */
    async _tryFaviconFallback(baseUrl) {
        try {
            const originMatch = baseUrl.match(/^(https?:\/\/[^/]+)/);
            if (!originMatch) return null;

            const faviconUrl = `${originMatch[1]}/favicon.ico`;
            const message = Soup.Message.new('HEAD', faviconUrl);

            if (message) {
                await new Promise((resolve, reject) => {
                    this._httpSession.send_async(message, GLib.PRIORITY_DEFAULT, null, (session, res) => {
                        try {
                            session.send_finish(res);
                            resolve();
                        } catch (e) {
                            reject(e);
                        }
                    });
                });

                if (message.status_code === 200) {
                    return faviconUrl;
                }
            }
        } catch {
            // Head request failed.
        }

        return null;
    }

    /**
     * Get Google's S2 Favicon API URL as ultimate fallback.
     *
     * @param {string} url Website URL.
     * @returns {string|null} The Google favicon API URL or null.
     * @private
     */
    _getGoogleFaviconUrl(url) {
        try {
            const uri = GLib.Uri.parse(url, GLib.UriFlags.NONE);
            const domain = uri.get_host();
            return `https://www.google.com/s2/favicons?domain=${domain}&sz=${GOOGLE_FAVICON_SIZE}`;
        } catch {
            return null;
        }
    }

    /**
     * Resolve a relative URL against a base URL.
     *
     * @param {string} relativeUrl URL to resolve.
     * @param {string} baseUrl Base URL.
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
     * Determine file extension from Content-Type or URL.
     *
     * @param {string} contentType Content-Type header value.
     * @param {string} url Icon URL.
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
     * Decode HTML entities in a string.
     *
     * @param {string} str String to decode.
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

    // ========================================================================
    // Lifecycle
    // ========================================================================

    /**
     * Clean up resources and abort active network requests.
     */
    destroy() {
        if (this._httpSession) {
            this._httpSession.abort();
            this._httpSession = null;
        }
    }
}
