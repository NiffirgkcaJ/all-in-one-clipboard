import { IOResource } from '../../../shared/utilities/utilityIO.js';
import { ResourceItem } from '../../../shared/constants/storagePaths.js';
import { ServiceJson } from '../../../shared/services/serviceJson.js';

import { ClipboardType } from '../constants/clipboardConstants.js';
import { ProcessorUtils } from '../utilities/clipboardProcessorUtils.js';

// Configuration
const MAX_CONTACT_LENGTH = 200;

// Validation Patterns
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const PHONE_REGEX = /^\+(\d{1,4})[\s-]?\(?\d{1,4}\)?[\s-]?\d{1,4}[\s-]?\d{1,9}$/;

/**
 * ContactProcessor - Handles email and phone number detection
 *
 * Pattern: Single-phase (process) with initialization
 * - init(): Loads country data for phone number parsing
 * - process(): Detects and validates emails/phone numbers
 */
export class ContactProcessor {
    static _countryByDialCode = null;
    static _initPromise = null;

    /**
     * Initialize the processor by loading country data.
     * @param {string} extensionPath - Path to the extension root.
     */
    static init() {
        if (this._initPromise) return this._initPromise;

        this._initPromise = (async () => {
            try {
                const bytes = await IOResource.read(ResourceItem.COUNTRIES);

                if (bytes) {
                    const countriesArray = ServiceJson.parse(bytes);

                    this._countryByDialCode = new Map();
                    for (const country of countriesArray) {
                        if (country.dial_code) {
                            this._countryByDialCode.set(country.dial_code, country);
                        }
                    }
                } else {
                    console.error('[AIO-Clipboard] ContactProcessor: Failed to load countries.json from GResource');
                }
            } catch (e) {
                console.warn(`[AIO-Clipboard] ContactProcessor: Failed to load country data: ${e.message}`);
            }
        })();

        return this._initPromise;
    }

    /**
     * Process clipboard text to detect contacts.
     * @param {string} text - The clipboard text.
     * @returns {Promise<Object|null>} Processed contact object or null.
     */
    static async process(text) {
        if (!text || text.length > MAX_CONTACT_LENGTH) return null; // Contacts are usually short
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
                console.warn('[AIO-Clipboard] ContactProcessor: process() called before init()! Cannot load country data.');
            }

            const dialCodeMatch = cleanText.match(/^(\+\d+)/);

            let countryCode = null;
            let countryName = null;

            if (this._countryByDialCode && dialCodeMatch) {
                // Try to match the longest possible dial code
                const fullDial = dialCodeMatch[1];
                for (let i = fullDial.length; i >= 2; i--) {
                    const dialCode = fullDial.substring(0, i);
                    if (this._countryByDialCode.has(dialCode)) {
                        const countryInfo = this._countryByDialCode.get(dialCode);
                        countryCode = countryInfo.code;
                        countryName = countryInfo.name;
                        break;
                    }
                }
            }

            const hash = ProcessorUtils.computeHashForString(cleanText);

            return {
                type: ClipboardType.CONTACT,
                subtype: 'phone',
                text: cleanText,
                preview: cleanText, // Just the text
                hash: hash,
                metadata: countryCode
                    ? {
                          code: countryCode,
                          name: countryName,
                      }
                    : null,
            };
        }

        return null;
    }
}
