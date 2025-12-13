import GLib from 'gi://GLib';

import { IOFile as IOFileImport, IOResource as IOResourceImport } from '../utilities/utilityIO.js';

// -------------------------------------------------------------
// Helpers
// -------------------------------------------------------------
function getUserDataDir(uuid) {
    return GLib.build_filenamev([GLib.get_user_data_dir(), uuid]);
}

function getUserCacheDir(uuid) {
    return GLib.build_filenamev([GLib.get_user_cache_dir(), uuid]);
}

function getResourceDataDir() {
    return 'assets/data';
}

function getResourceIconsDir() {
    return 'assets/icons';
}

function buildFileUri(absolutePath) {
    return `file://${absolutePath}`;
}

function buildResourceUri(relativePath) {
    return `resource:///org/gnome/shell/extensions/all-in-one-clipboard/${relativePath}`;
}

// -------------------------------------------------------------
// Exports — Operations
// -------------------------------------------------------------
export const IOFile = IOFileImport;
export const IOResource = IOResourceImport;

// -------------------------------------------------------------
// Exports — Paths
// -------------------------------------------------------------
export let FilePath = null;
export let FileItem = null;
export let ResourcePath = null;
export let ResourceItem = null;

// -------------------------------------------------------------
// Initialization
// -------------------------------------------------------------
export function initStorage(uuid) {
    // File base paths
    FilePath = {
        DATA: getUserDataDir(uuid),
        CACHE: getUserCacheDir(uuid),
    };
    FilePath.IMAGES = `${FilePath.DATA}/images`;
    FilePath.TEXTS = `${FilePath.DATA}/texts`;
    FilePath.LINK_PREVIEWS = `${FilePath.CACHE}/link-previews`;
    FilePath.GIF_PREVIEWS = `${FilePath.CACHE}/gif-previews`;
    FilePath.uri = buildFileUri;

    // File items
    FileItem = {
        CLIPBOARD_HISTORY: `${FilePath.CACHE}/history_clipboard.json`,
        CLIPBOARD_PINNED: `${FilePath.DATA}/pinned_clipboard.json`,
        RECENT_EMOJI: `${FilePath.CACHE}/recent_emojis.json`,
        RECENT_KAOMOJI: `${FilePath.CACHE}/recent_kaomojis.json`,
        RECENT_SYMBOLS: `${FilePath.CACHE}/recent_symbols.json`,
        RECENT_GIFS: `${FilePath.CACHE}/recent_gifs.json`,
    };

    // Resource base paths
    ResourcePath = {
        DATA: getResourceDataDir(),
        ICONS: getResourceIconsDir(),
    };
    ResourcePath.JSON = buildResourceUri(`${ResourcePath.DATA}/json`);
    ResourcePath.UI = buildResourceUri(`${ResourcePath.ICONS}/ui`);
    ResourcePath.FLAGS = buildResourceUri(`${ResourcePath.ICONS}/flags`);
    ResourcePath.uri = buildResourceUri;

    // Resource items
    ResourceItem = {
        EMOJI: `${ResourcePath.JSON}/emojis.json`,
        KAOMOJI: `${ResourcePath.JSON}/kaomojis.json`,
        SYMBOLS: `${ResourcePath.JSON}/symbols.json`,
        COUNTRIES: `${ResourcePath.JSON}/countries.json`,
    };
}
