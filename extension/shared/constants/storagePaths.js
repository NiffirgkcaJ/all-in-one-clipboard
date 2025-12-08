import GLib from 'gi://GLib';

// Internal constants
const RESOURCE_BASE_PATH = '/org/gnome/shell/extensions/all-in-one-clipboard';
const RESOURCE_SCHEME = 'resource://';

/**
 * Helper to get user data directory
 */
function getUserDataDir(uuid) {
    return GLib.build_filenamev([GLib.get_user_data_dir(), uuid]);
}

/**
 * Helper to get user cache directory
 */
function getUserCacheDir(uuid) {
    return GLib.build_filenamev([GLib.get_user_cache_dir(), uuid]);
}

/**
 * Encapsulated storage paths.
 * Consumers request a specific path by purpose, not by constructing it manually.
 */
export const Storage = {
    // -------------------------------------------------------------------------
    // File Paths
    // -------------------------------------------------------------------------
    getClipboardHistoryPath: (uuid) => GLib.build_filenamev([getUserCacheDir(uuid), 'history_clipboard.json']),
    getPinnedClipboardPath: (uuid) => GLib.build_filenamev([getUserDataDir(uuid), 'pinned_clipboard.json']),

    getRecentEmojiPath: (uuid) => GLib.build_filenamev([getUserCacheDir(uuid), 'recent_emojis.json']),
    getRecentKaomojiPath: (uuid) => GLib.build_filenamev([getUserCacheDir(uuid), 'recent_kaomojis.json']),
    getRecentSymbolsPath: (uuid) => GLib.build_filenamev([getUserCacheDir(uuid), 'recent_symbols.json']),
    getRecentGifsPath: (uuid) => GLib.build_filenamev([getUserCacheDir(uuid), 'recent_gifs.json']),

    // -------------------------------------------------------------------------
    // Directory Paths
    // -------------------------------------------------------------------------
    getImagesDir: (uuid) => GLib.build_filenamev([getUserDataDir(uuid), 'images']),
    getTextsDir: (uuid) => GLib.build_filenamev([getUserDataDir(uuid), 'texts']),
    getLinkPreviewsDir: (uuid) => GLib.build_filenamev([getUserCacheDir(uuid), 'link-previews']),
    getGifPreviewsDir: (uuid) => GLib.build_filenamev([getUserCacheDir(uuid), 'gif-previews']),
};

/**
 * For direct GResource lookups and URI construction
 */
export const ResourcePaths = {
    CONTENT: {
        EMOJI: `${RESOURCE_BASE_PATH}/assets/data/json/emojis.json`,
        KAOMOJI: `${RESOURCE_BASE_PATH}/assets/data/json/kaomojis.json`,
        SYMBOLS: `${RESOURCE_BASE_PATH}/assets/data/json/symbols.json`,
        COUNTRIES: `${RESOURCE_BASE_PATH}/assets/data/json/countries.json`,
    },
    // Base paths for constructing dynamic paths
    ASSETS: {
        ICONS: `${RESOURCE_SCHEME}${RESOURCE_BASE_PATH}/assets/icons/ui`,
        FLAGS: `${RESOURCE_SCHEME}${RESOURCE_BASE_PATH}/assets/icons/flags`,
    },
};
