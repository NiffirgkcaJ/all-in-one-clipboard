import Clutter from 'gi://Clutter';

/**
 * A mapping of special key names to their corresponding Clutter key symbols.
 * This is used to handle keys that do not have a direct single-character representation.
 */
const KEY_MAP = {
    // --- Core Navigation & Control ---
    Escape: Clutter.KEY_Escape,
    Tab: Clutter.KEY_Tab,
    ISO_Left_Tab: Clutter.KEY_ISO_Left_Tab,
    space: Clutter.KEY_space,
    BackSpace: Clutter.KEY_BackSpace,
    Return: Clutter.KEY_Return,
    Enter: Clutter.KEY_KP_Enter, // Common alias
    Insert: Clutter.KEY_Insert,
    Delete: Clutter.KEY_Delete,

    // --- Arrows & Page Navigation ---
    Up: Clutter.KEY_Up,
    Down: Clutter.KEY_Down,
    Left: Clutter.KEY_Left,
    Right: Clutter.KEY_Right,
    Home: Clutter.KEY_Home,
    End: Clutter.KEY_End,
    Page_Up: Clutter.KEY_Page_Up,
    Page_Down: Clutter.KEY_Page_Down,

    // --- Function Keys ---
    F1: Clutter.KEY_F1,
    F2: Clutter.KEY_F2,
    F3: Clutter.KEY_F3,
    F4: Clutter.KEY_F4,
    F5: Clutter.KEY_F5,
    F6: Clutter.KEY_F6,
    F7: Clutter.KEY_F7,
    F8: Clutter.KEY_F8,
    F9: Clutter.KEY_F9,
    F10: Clutter.KEY_F10,
    F11: Clutter.KEY_F11,
    F12: Clutter.KEY_F12,

    // --- Standard Punctuation & Symbols ---
    grave: Clutter.KEY_grave, // `
    asciitilde: Clutter.KEY_asciitilde, // ~
    exclam: Clutter.KEY_exclam, // !
    at: Clutter.KEY_at, // @
    numbersign: Clutter.KEY_numbersign, // #
    dollar: Clutter.KEY_dollar, // $
    percent: Clutter.KEY_percent, // %
    asciicircum: Clutter.KEY_asciicircum, // ^
    ampersand: Clutter.KEY_ampersand, // &
    asterisk: Clutter.KEY_asterisk, // *
    parenleft: Clutter.KEY_parenleft, // (
    parenright: Clutter.KEY_parenright, // )
    minus: Clutter.KEY_minus, // -
    underscore: Clutter.KEY_underscore, // _
    plus: Clutter.KEY_plus, // +
    equal: Clutter.KEY_equal, // =
    bracketleft: Clutter.KEY_bracketleft, // [
    bracketright: Clutter.KEY_bracketright, // ]
    braceleft: Clutter.KEY_braceleft, // {
    braceright: Clutter.KEY_braceright, // }
    backslash: Clutter.KEY_backslash, // \
    bar: Clutter.KEY_bar, // |
    semicolon: Clutter.KEY_semicolon, // ;
    colon: Clutter.KEY_colon, // :
    apostrophe: Clutter.KEY_apostrophe, // '
    quotedbl: Clutter.KEY_quotedbl, // "
    comma: Clutter.KEY_comma, // ,
    less: Clutter.KEY_less, // <
    period: Clutter.KEY_period, // .
    greater: Clutter.KEY_greater, // >
    slash: Clutter.KEY_slash, // /
    question: Clutter.KEY_question, // ?

    // --- Keypad (Numbers) ---
    KP_0: Clutter.KEY_KP_0,
    KP_1: Clutter.KEY_KP_1,
    KP_2: Clutter.KEY_KP_2,
    KP_3: Clutter.KEY_KP_3,
    KP_4: Clutter.KEY_KP_4,
    KP_5: Clutter.KEY_KP_5,
    KP_6: Clutter.KEY_KP_6,
    KP_7: Clutter.KEY_KP_7,
    KP_8: Clutter.KEY_KP_8,
    KP_9: Clutter.KEY_KP_9,

    // --- Keypad (Operations & Control) ---
    KP_Add: Clutter.KEY_KP_Add,
    KP_Subtract: Clutter.KEY_KP_Subtract,
    KP_Multiply: Clutter.KEY_KP_Multiply,
    KP_Divide: Clutter.KEY_KP_Divide,
    KP_Decimal: Clutter.KEY_KP_Decimal,
    KP_Enter: Clutter.KEY_KP_Enter,
    KP_Insert: Clutter.KEY_KP_Insert,
    KP_Delete: Clutter.KEY_KP_Delete,

    // --- Keypad (Navigation) ---
    KP_Up: Clutter.KEY_KP_Up,
    KP_Down: Clutter.KEY_KP_Down,
    KP_Left: Clutter.KEY_KP_Left,
    KP_Right: Clutter.KEY_KP_Right,
    KP_Home: Clutter.KEY_KP_Home,
    KP_End: Clutter.KEY_KP_End,
    KP_Page_Up: Clutter.KEY_KP_Page_Up,
    KP_Page_Down: Clutter.KEY_KP_Page_Down,
    KP_Begin: Clutter.KEY_KP_Begin, // Often the '5' key with NumLock off
    KP_Next: Clutter.KEY_KP_Next, // Often aliases to Page Down
};

/**
 * Checks if a Clutter event matches any of the keyboard shortcuts defined in GSettings.
 *
 * @param {Clutter.Event} event - The Clutter event to check.
 * @param {Gio.Settings} settings - The GSettings object containing the shortcuts.
 * @param {string} settingsKey - The key in GSettings where the shortcuts are stored.
 * @returns {boolean} - True if the event matches any shortcut, false otherwise.
 */
export function eventMatchesShortcut(event, settings, settingsKey) {
    const shortcuts = settings.get_strv(settingsKey);
    if (!shortcuts || shortcuts.length === 0) return false;

    const eventSymbol = event.get_key_symbol();
    const eventState = event.get_state();

    // Clutter Modifier Masks
    const MASK_CTRL = Clutter.ModifierType.CONTROL_MASK;
    const MASK_SHIFT = Clutter.ModifierType.SHIFT_MASK;
    const MASK_ALT = Clutter.ModifierType.MOD1_MASK | Clutter.ModifierType.META_MASK;
    const MASK_SUPER = Clutter.ModifierType.SUPER_MASK | Clutter.ModifierType.MOD4_MASK | Clutter.ModifierType.HYPER_MASK;

    // Determine actual active modifiers from event
    const hasCtrl = (eventState & MASK_CTRL) !== 0;
    const hasShift = (eventState & MASK_SHIFT) !== 0;
    const hasAlt = (eventState & MASK_ALT) !== 0;
    const hasSuper = (eventState & MASK_SUPER) !== 0;

    for (const shortcutString of shortcuts) {
        const modifiers = _parseModifiers(shortcutString);

        // Skip if modifiers don't match
        if (hasCtrl !== modifiers.reqCtrl) continue;
        if (hasAlt !== modifiers.reqAlt) continue;
        if (hasSuper !== modifiers.reqSuper) continue;

        // Extract key name by removing all modifier tags
        const keyName = shortcutString.replace(/<[^>]+>/g, '');

        // Check if the key matches
        if (_checkKeyMatch(keyName, eventSymbol, hasShift, modifiers.reqShift)) {
            return true;
        }
    }

    return false;
}

/**
 * Parse modifier requirements from a shortcut string
 * @param {string} shortcutString - The shortcut string to parse
 * @returns {Object} Object with reqCtrl, reqShift, reqAlt, reqSuper properties
 * @private
 */
function _parseModifiers(shortcutString) {
    return {
        reqCtrl: /<Control>|<Ctrl>|<Primary>/i.test(shortcutString),
        reqShift: /<Shift>/i.test(shortcutString),
        reqAlt: /<Alt>|<Mod1>|<Meta>/i.test(shortcutString),
        reqSuper: /<Super>|<Mod4>|<Hyper>/i.test(shortcutString),
    };
}

/**
 * Check if a key name matches the event symbol
 * @param {string} keyName - The key name from the shortcut
 * @param {number} eventSymbol - The Clutter key symbol from the event
 * @param {boolean} hasShift - Whether Shift is pressed
 * @param {boolean} reqShift - Whether Shift is required
 * @returns {boolean} True if the key matches
 * @private
 */
function _checkKeyMatch(keyName, eventSymbol, hasShift, reqShift) {
    // Check Mapped Special Keys
    const mappedSymbol = KEY_MAP[keyName];
    if (mappedSymbol) {
        // Tab and ISO_Left_Tab Match
        if (keyName === 'Tab' || keyName === 'ISO_Left_Tab') {
            const isEventTab = eventSymbol === Clutter.KEY_Tab || eventSymbol === Clutter.KEY_ISO_Left_Tab;
            return isEventTab && hasShift === reqShift;
        }
        // General Key Map Match
        return mappedSymbol === eventSymbol;
    }

    // Check Single Character Keys
    if (keyName.length === 1) {
        const reqChar = keyName.charCodeAt(0);

        // Case-Sensitive Match
        if (eventSymbol === reqChar) {
            // If exact match, Shift must match requirements
            return hasShift === reqShift;
        }
        // Case-Insensitive Match
        if (hasShift && reqShift) {
            const upper = keyName.toUpperCase().charCodeAt(0);
            return eventSymbol === upper;
        }
    }

    return false;
}
