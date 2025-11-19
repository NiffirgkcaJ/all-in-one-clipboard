import Gio from 'gi://Gio';
import { EmojiJsonParser } from '../parsers/emojiJsonParser.js';

let _skinnableCharSetCache = null;
let _cachePromise = null;

const ZWJ_CHAR = '\u200D';
const VS16_CHAR = '\uFE0F';

/**
 * A singleton cache for the pre-processed set of skinnable emoji characters.
 * This performs the expensive task of parsing the emojis.json file only once.
 *
 * @param {string} extensionPath - The root path of the extension.
 * @returns {Promise<Set<string>>} A promise that resolves to the Set of skinnable characters.
 */
export function getSkinnableCharSet(extensionPath) {
    if (_skinnableCharSetCache) {
        return Promise.resolve(_skinnableCharSetCache);
    }

    if (_cachePromise) {
        return _cachePromise;
    }

    _cachePromise = (async () => {
        try {
            const resourcePath = `/org/gnome/shell/extensions/all-in-one-clipboard/assets/data/emojis.json`;
            const bytes = Gio.resources_lookup_data(resourcePath, Gio.ResourceLookupFlags.NONE);
            if (!bytes) {
                throw new Error('Failed to load emojis.json from GResource.');
            }

            const jsonString = new TextDecoder('utf-8').decode(bytes.get_data());
            const rawData = JSON.parse(jsonString);

            // Use the existing parser to get standardized data
            const parser = new EmojiJsonParser();
            const emojiData = parser.parse(rawData);

            const skinnableChars = new Set();
            for (const item of emojiData) {
                // We only care about single characters that support skin tones.
                if (item.skinToneSupport && !item.char.includes(ZWJ_CHAR)) {
                    // Strip the variation selector to get the true base character.
                    const baseChar = item.char.endsWith(VS16_CHAR) ? item.char.slice(0, -1) : item.char;
                    skinnableChars.add(baseChar);
                }
            }

            _skinnableCharSetCache = skinnableChars;
            return _skinnableCharSetCache;

        } catch (e) {
            console.error(`[AIO-Clipboard] Failed to build skinnable character set cache: ${e.message}`);
            _cachePromise = null; // Allow retrying if it failed
            return new Set(); // Return empty set on failure
        }
    })();

    return _cachePromise;
}

/**
 * Resets the singleton cache.
 * This should be called from the main extension's disable() method to ensure
 * a clean state on extension reload, which is crucial for development.
 */
export function destroySkinnableCharSetCache() {
    _skinnableCharSetCache = null;
    _cachePromise = null;
}