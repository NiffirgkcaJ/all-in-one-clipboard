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
     * Process clipboard text to detect email addresses or phone numbers.
     *
     * @param {string} text The clipboard text content.
     * @returns {Promise<Object|null>} Processed contact object or null if no contact was detected.
     */
    static async process(text) {
        if (!text || text.length > MAX_CONTACT_LENGTH) return null;
        const cleanText = text.trim();

        // Email
        if (EMAIL_REGEX.test(cleanText)) {
            const hash = ProcessorUtils.computeHashForString(cleanText);

            return {
                type: ClipboardType.CONTACT,
                subtype: 'email',
                text: cleanText,
                preview: cleanText,
                hash: hash,
                metadata: null,
            };
        }

        // Phone
        const phoneMatch = cleanText.match(PHONE_REGEX);

        if (phoneMatch) {
            if (this._initPromise) {
                await this._initPromise;
            } else {
                Logger.warn('process() called before init()! Cannot load country data.', 'ContactProcessor');
            }

            const countryInfo = ContactProcessor._resolveCountryForPhone(cleanText);
            const hash = ProcessorUtils.computeHashForString(cleanText);

            return {
                type: ClipboardType.CONTACT,
                subtype: 'phone',
                text: cleanText,
                preview: cleanText,
                hash: hash,
                metadata: countryInfo
                    ? {
                          code: countryInfo.code,
                          name: countryInfo.name,
                      }
                    : null,
            };
        }

        return null;
    }

    /**
     * Extract contact items embedded within text content.
     *
     * @param {string} text Text content to scan for contacts.
     * @param {number} limit Maximum number of contacts to extract.
     * @returns {Promise<Array<object>>} List of extracted contact intent objects.
     */
    static async extractContacts(text, limit) {
        if (!text) return [];

        if (this._initPromise) {
            await this._initPromise;
        }

        const contacts = [];
        const seen = new Set();

        // Emails
        const emailMatches = text.matchAll(EMBEDDED_EMAIL_REGEX);
        for (const match of emailMatches) {
            if (typeof limit === 'number' && contacts.length >= limit) break;

            const email = match[0].trim();
            if (EMAIL_REGEX.test(email) && !seen.has(email)) {
                seen.add(email);
                contacts.push({
                    type: ClipboardType.CONTACT,
                    subtype: 'email',
                    text: email,
                    preview: email,
                    hash: ProcessorUtils.computeHashForString(email),
                    metadata: null,
                });
            }
        }

        // Phones
        const phoneMatches = text.matchAll(EMBEDDED_PHONE_REGEX);
        for (const match of phoneMatches) {
            if (typeof limit === 'number' && contacts.length >= limit) break;

            let phone = match[0].trim();
            while (/[.,;!?:>]$/.test(phone) || (phone.endsWith(')') && (phone.match(/\)/g) || []).length > (phone.match(/\(/g) || []).length)) {
                phone = phone.slice(0, -1).trim();
            }

            if (PHONE_REGEX.test(phone) && !seen.has(phone)) {
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
                });
            }
        }

        return contacts;
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
