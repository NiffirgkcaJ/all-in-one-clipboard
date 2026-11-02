import { IOResource } from '../../../shared/utilities/utilityIO.js';
import { Logger } from '../../../shared/utilities/utilityLogger.js';
import { ResourceItem } from '../../../shared/constants/storagePaths.js';

import { ClipboardType } from '../constants/clipboardPluginConstants.js';
import { ProcessorUtils } from '../utilities/clipboardProcessorUtils.js';

// Configuration
const MAX_CONTACT_LENGTH = 200;

// Validation Patterns
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const PHONE_REGEX = /^\+(\d{1,4})[\s-]?\(?\d{1,4}\)?[\s-]?\d{1,4}[\s-]?\d{1,9}$/;
const EMBEDDED_EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,63}/g;
const EMBEDDED_PHONE_REGEX = /\+\d{1,4}[\s-]?\(?\d{1,4}\)?[\s-]?\d{1,4}[\s-]?\d{1,9}\b/g;

/**
 * ContactProcessor
 *
 * Handles email and phone number detection, loading country data for phone number parsing and validation.
 */
export class ContactProcessor {
    static _countryByDialCode = null;
    static _initPromise = null;

    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Initialize the processor by loading country data for phone number detection.
     *
     * @returns {Promise<void>} Initialization promise.
     */
    static init() {
        if (this._initPromise) return this._initPromise;

        this._initPromise = (async () => {
            try {
                const rawData = await IOResource.readJson(ResourceItem.COUNTRIES);
                const countriesArray = rawData ? rawData.data : null;

                if (Array.isArray(countriesArray)) {
                    this._countryByDialCode = new Map();

                    for (const country of countriesArray) {
                        if (country.dial_code) {
                            this._countryByDialCode.set(country.dial_code, country);
                        }
                    }
                } else {
                    Logger.error('Failed to load countries.json from GResource', 'ContactProcessor');
                }
            } catch (e) {
                Logger.warn(`Failed to load country data: ${e.message}`, 'ContactProcessor');
            }
        })();

        return this._initPromise;
    }

    /**
     * Extract contact items embedded within text content.
     *
     * @param {string} source Text content to scan for contacts.
     * @param {object} [_context] Extraction context.
     * @returns {Promise<Array<object>>} List of extracted contact intent objects.
     */
    static async extractIntents(source, _context = {}) {
        if (!source) return [];

        if (this._initPromise) {
            await this._initPromise;
        }

        const contacts = [];
        const seen = new Set();

        // Emails
        const emailMatches = source.matchAll(EMBEDDED_EMAIL_REGEX);
        for (const match of emailMatches) {
            const email = match[0].trim();
            if (!EMAIL_REGEX.test(email) || seen.has(email)) continue;

            seen.add(email);
            contacts.push({
                type: ClipboardType.CONTACT,
                subtype: 'email',
                text: email,
                preview: email,
                hash: ProcessorUtils.computeHashForString(email),
                metadata: null,
                startIndex: this._getFullTextMatchRange(source, match.index, match[0].length).startIndex,
                endIndex: this._getFullTextMatchRange(source, match.index, match[0].length).endIndex,
            });
        }

        // Phones
        const phoneMatches = source.matchAll(EMBEDDED_PHONE_REGEX);
        for (const match of phoneMatches) {
            let phone = match[0].trim();
            while (/[.,;!?:>]$/.test(phone) || (phone.endsWith(')') && (phone.match(/\)/g) || []).length > (phone.match(/\(/g) || []).length)) {
                phone = phone.slice(0, -1).trim();
            }

            if (!PHONE_REGEX.test(phone) || seen.has(phone)) continue;

            seen.add(phone);
            const countryInfo = ContactProcessor._resolveCountryForPhone(phone);
            contacts.push({
                type: ClipboardType.CONTACT,
                subtype: 'phone',
                text: phone,
                preview: phone,
                hash: ProcessorUtils.computeHashForString(phone),
                metadata: countryInfo
                    ? {
                          code: countryInfo.code,
                          name: countryInfo.name,
                      }
                    : null,
                startIndex: this._getFullTextMatchRange(source, match.index, phone.length).startIndex,
                endIndex: this._getFullTextMatchRange(source, match.index, phone.length).endIndex,
            });
        }

        return contacts;
    }

    /**
     * Expand a match spanning the trimmed source to cover the complete source.
     *
     * @param {string} source Original text source.
     * @param {number} startIndex Match start.
     * @param {number} matchLength Match length.
     * @returns {{startIndex: number, endIndex: number}} Source-relative span.
     * @private
     */
    static _getFullTextMatchRange(source, startIndex, matchLength) {
        const trimmed = source.trim();
        if (source.length <= MAX_CONTACT_LENGTH && trimmed && source.slice(startIndex, startIndex + matchLength).trim() === trimmed) {
            return { startIndex: 0, endIndex: source.length };
        }

        return { startIndex, endIndex: startIndex + matchLength };
    }

    // ========================================================================
    // Internal Helpers
    // ========================================================================

    /**
     * Resolve country information matching the dial code prefix of a phone number.
     *
     * @param {string} phone Clean phone number string.
     * @returns {object|null} Country information object or null.
     * @private
     */
    static _resolveCountryForPhone(phone) {
        if (!this._countryByDialCode) return null;

        const dialCodeMatch = phone.match(/^(\+\d+)/);
        if (!dialCodeMatch) return null;

        const fullDial = dialCodeMatch[1];
        for (let i = fullDial.length; i >= 2; i--) {
            const dialCode = fullDial.substring(0, i);

            if (this._countryByDialCode.has(dialCode)) {
                return this._countryByDialCode.get(dialCode);
            }
        }

        return null;
    }
}
