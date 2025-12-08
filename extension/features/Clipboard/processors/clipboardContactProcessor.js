import Gio from 'gi://Gio';

import { ClipboardType } from '../constants/clipboardConstants.js';
import { ProcessorUtils } from '../utilities/clipboardProcessorUtils.js';
import { ResourcePaths } from '../../../shared/constants/storagePaths.js';

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
                // Use Gio.resources_lookup_data to load from GResource bundle
                const resourcePath = ResourcePaths.CONTENT.COUNTRIES;
                const bytes = Gio.resources_lookup_data(resourcePath, Gio.ResourceLookupFlags.NONE);

                if (bytes) {
                    const jsonString = new TextDecoder('utf-8').decode(bytes.get_data());
                    const countriesArray = JSON.parse(jsonString);

                    // Build a lookup map: dial_code -> country info
                    this._countryByDialCode = new Map();
                    for (const country of countriesArray) {
                        if (country.dial_code) {
                            this._countryByDialCode.set(country.dial_code, country);
                        }
                    }
                } else {
                    console.error('[AIO-Clipboard] ContactProcessor: Failed to lookup countries.json from GResource');
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

        // Check for Email
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

        // Check for Phone
        const phoneMatch = cleanText.match(PHONE_REGEX);
        if (phoneMatch) {
            // Ensure data is loaded
            if (this._initPromise) {
                await this._initPromise;
            } else {
                console.warn('[AIO-Clipboard] ContactProcessor: process() called before init()! Cannot load country data.');
            }

            // Extract digits only to match against dial codes
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
