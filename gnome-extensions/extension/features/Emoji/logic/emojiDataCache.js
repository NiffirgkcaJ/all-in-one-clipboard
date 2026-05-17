import { IOResource } from '../../../shared/utilities/utilityIO.js';
import { Logger } from '../../../shared/utilities/utilityLogger.js';
import { ResourceItem } from '../../../shared/constants/storagePaths.js';

import { EmojiJsonParser } from '../parsers/emojiJsonParser.js';

// Unicode Control Characters
const ZWJ_CHAR = '\u200D';
const VS16_CHAR = '\uFE0F';

// ========================================================================
// State
// ========================================================================

let _skinnableCharSetCache = null;
let _cachePromise = null;

/**
 * A singleton cache for the pre-processed set of skinnable emoji characters.
 * This performs the expensive task of parsing the emojis.json file only once.
 *
 * @returns {Promise<Set<string>>} A promise that resolves to the Set of skinnable characters.
 */
export function getSkinnableCharSet() {
    if (_skinnableCharSetCache) {
        return Promise.resolve(_skinnableCharSetCache);
    }

    if (_cachePromise) {
        return _cachePromise;
    }

    _cachePromise = (async () => {
        try {
            const rawData = await IOResource.readJson(ResourceItem.EMOJI);
            if (!rawData) {
                throw new Error('Failed to load emojis.json from GResource.');
            }

            const parser = new EmojiJsonParser();
            const emojiData = parser.parse(rawData);

            const skinnableChars = new Set();
            for (const item of emojiData) {
                if (item.skinToneSupport && !item.char.includes(ZWJ_CHAR)) {
                    const baseChar = item.char.endsWith(VS16_CHAR) ? item.char.slice(0, -1) : item.char;
                    skinnableChars.add(baseChar);
                }
            }

            _skinnableCharSetCache = skinnableChars;
            return _skinnableCharSetCache;
        } catch (e) {
            Logger.error(`Failed to build skinnable character set cache: ${e.message}`);
            _cachePromise = null;
            return new Set();
        }
    })();

    return _cachePromise;
}

/**
 * Resets the singleton cache.
 * This should be called from the main extension's disable() method.
 * It ensures a clean state on extension reload, which is crucial for development.
 */
export function destroySkinnableCharSetCache() {
    _skinnableCharSetCache = null;
    _cachePromise = null;
}
