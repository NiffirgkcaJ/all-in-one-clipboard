const ZWJ = '\u200D'; // Zero Width Joiner
const VS16 = '\uFE0F'; // Variation Selector-16 for emoji presentation
const HANDSHAKE_CHAR = '\u{1F91D}'; // Handshake Emoji

// Standard Unicode Skin Tone Modifiers
const SKIN_TONE_MODIFIERS = ['🏻', '🏼', '🏽', '🏾', '🏿'];

// Map precomposed multi-person emojis to ZWJ equivalents for applying dual skin tones
const PRECOMPOSED_TO_ZWJ_MAP = {
    '\u{1F46D}': '👩‍🤝‍👩', // Women Holding Hands
    '\u{1F46B}': '👩‍🤝‍👨', // Woman and Man Holding Hands
    '\u{1F46C}': '👨‍🤝‍👨', // Men Holding Hands
    '\u{1F48F}': '🧑‍❤️‍💋‍🧑', // Kiss: People
    '\u{1F491}': '🧑‍❤️‍🧑', // Couple with Heart: People
};

/**
 * A static utility class for analyzing and modifying emoji characters,
 * particularly for applying and removing skin tones.
 */
export class EmojiModifier {
    /**
     * Checks if a given emoji character string already contains a skin tone modifier.
     * @param {string} char - The emoji string to check.
     * @returns {boolean} True if a skin tone modifier is found.
     */
    static hasSkinTone(char) {
        if (!char) return false;
        return SKIN_TONE_MODIFIERS.some((tone) => char.includes(tone));
    }

    /**
     * Applies custom skin tones to an emoji character based on user settings.
     * This method handles single characters, ZWJ sequences, and on-the-fly
     * conversion of older precomposed emojis.
     *
     * @param {string} originalEmojiChar - The base emoji character.
     * @param {boolean} useCustomTones - Whether custom skin tones are enabled.
     * @param {string|null} primaryTone - The user's preferred primary skin tone modifier.
     * @param {string|null} secondaryTone - The user's preferred secondary skin tone modifier.
     * @param {Set<string>} skinToneableBaseChars - A Set of single base characters known to support skin tones.
     * @returns {string} The emoji character with applied/removed skin tones.
     */
    static applyCustomTones(originalEmojiChar, useCustomTones, primaryTone, secondaryTone, skinToneableBaseChars) {
        if (!originalEmojiChar) return '';

        let currentEmojiChar = originalEmojiChar;

        const validPrimaryTone = SKIN_TONE_MODIFIERS.includes(primaryTone) ? primaryTone : null;
        const validSecondaryTone = SKIN_TONE_MODIFIERS.includes(secondaryTone) ? secondaryTone : null;

        if (useCustomTones && validPrimaryTone && validSecondaryTone && validPrimaryTone !== validSecondaryTone && PRECOMPOSED_TO_ZWJ_MAP[currentEmojiChar]) {
            currentEmojiChar = PRECOMPOSED_TO_ZWJ_MAP[currentEmojiChar];
        }

        if (!useCustomTones) {
            const components = currentEmojiChar.split(ZWJ);
            const neutralComponents = components.map((comp) => {
                let baseComp = comp.endsWith(VS16) ? comp.slice(0, -1) : comp;
                let stripped = baseComp;
                for (const mod of SKIN_TONE_MODIFIERS) {
                    if (stripped.endsWith(mod)) {
                        stripped = stripped.slice(0, -mod.length);
                        break;
                    }
                }
                return comp.endsWith(VS16) ? stripped + VS16 : stripped;
            });
            return neutralComponents.join(ZWJ);
        }

        const components = currentEmojiChar.split(ZWJ);
        let personCount = 0;

        if (components.length === 1) {
            const component = components[0];
            let baseComponent = component.endsWith(VS16) ? component.slice(0, -1) : component;
            let toneStrippedBase = baseComponent;
            for (const mod of SKIN_TONE_MODIFIERS) {
                if (toneStrippedBase.endsWith(mod)) {
                    toneStrippedBase = toneStrippedBase.slice(0, -mod.length);
                    break;
                }
            }

            if (skinToneableBaseChars.has(toneStrippedBase) && validPrimaryTone) {
                const newEmoji = toneStrippedBase + validPrimaryTone;
                return component.endsWith(VS16) ? newEmoji + VS16 : newEmoji;
            }
            return currentEmojiChar;
        }

        const modifiedComponents = components.map((component, index) => {
            let baseOfComponent = component.endsWith(VS16) ? component.slice(0, -1) : component;
            let toneStrippedBase = baseOfComponent;
            for (const mod of SKIN_TONE_MODIFIERS) {
                if (toneStrippedBase.endsWith(mod)) {
                    toneStrippedBase = toneStrippedBase.slice(0, -mod.length);
                    break;
                }
            }

            if (toneStrippedBase === HANDSHAKE_CHAR) {
                return component;
            }

            if (skinToneableBaseChars.has(toneStrippedBase)) {
                personCount++;
                let toneToApply = null;

                if (personCount === 1 && validPrimaryTone) {
                    toneToApply = validPrimaryTone;
                } else if (personCount >= 2) {
                    toneToApply = validSecondaryTone || validPrimaryTone;
                }

                if (toneToApply) {
                    let newComp = toneStrippedBase + toneToApply;
                    if (component.endsWith(VS16) && index === components.length - 1) {
                        newComp += VS16;
                    }
                    return newComp;
                }
            }
            return component;
        });

        return modifiedComponents.join(ZWJ);
    }
}
