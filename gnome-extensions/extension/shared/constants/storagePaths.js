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

function getAssetDataDir() {
    return 'assets/data';
}

function getAssetIconsDir() {
    return 'assets/icons';
}

function getAssetLogosDir() {
    return 'assets/logos';
}

function buildFileUri(absolutePath) {
    return `file://${absolutePath}`;
}

function buildResourceUri(relativePath) {
    return `resource:///org/gnome/shell/extensions/all-in-one-clipboard/${relativePath}`;
}

function buildExtensionUri(relativePath) {
    return `/org/gnome/shell/extensions/all-in-one-clipboard/${relativePath}`;
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
export let ExtensionPath = null;
export let ExtensionItem = null;

// -------------------------------------------------------------
// Initialization
// -------------------------------------------------------------
function _initFilePaths(uuid = 'default') {
    // File base paths
    FilePath = {
        DATA: getUserDataDir(uuid),
        CACHE: getUserCacheDir(uuid),
    };
    FilePath.IMAGES = `${FilePath.DATA}/images`;
    FilePath.TEXTS = `${FilePath.DATA}/texts`;
    FilePath.IMAGE_PREVIEWS = `${FilePath.CACHE}/image-previews`;
    FilePath.LINK_PREVIEWS = `${FilePath.CACHE}/link-previews`;
    FilePath.GIF_PREVIEWS = `${FilePath.CACHE}/gif-previews`;
    FilePath.uri = buildFileUri;

    // File items
    FileItem = {
        CLIPBOARD_HISTORY: `${FilePath.CACHE}/history_clipboard.json`,
        CLIPBOARD_PINNED: `${FilePath.DATA}/pinned_clipboard.json`,
        RECENT_EMOJI: `${FilePath.CACHE}/recent_emojis.json`,
        RECENT_GIFS: `${FilePath.CACHE}/recent_gifs.json`,
        RECENT_KAOMOJI: `${FilePath.CACHE}/recent_kaomojis.json`,
        RECENT_SYMBOLS: `${FilePath.CACHE}/recent_symbols.json`,
    };
}

function _initResourcePaths() {
    // Resource base paths
    ResourcePath = {
        DATA: buildResourceUri(getAssetDataDir()),
        ICONS: buildResourceUri(getAssetIconsDir()),
        LOGOS: buildResourceUri(getAssetLogosDir()),
    };
    ResourcePath.CLIPBOARD = `${ResourcePath.DATA}/clipboard`;
    ResourcePath.EMOJI = `${ResourcePath.DATA}/emoji`;
    ResourcePath.GIF = `${ResourcePath.DATA}/gif`;
    ResourcePath.KAOMOJI = `${ResourcePath.DATA}/kaomoji`;
    ResourcePath.SYMBOLS = `${ResourcePath.DATA}/symbols`;
    ResourcePath.FLAGS = `${ResourcePath.ICONS}/flags`;
    ResourcePath.UI = `${ResourcePath.ICONS}/ui`;
    ResourcePath.uri = buildResourceUri;

    // Resource items
    ResourceItem = {
        COUNTRIES: `${ResourcePath.CLIPBOARD}/countries.json`,
        EMOJI: `${ResourcePath.EMOJI}/emojis.json`,
        KAOMOJI: `${ResourcePath.KAOMOJI}/kaomojis.json`,
        SYMBOLS: `${ResourcePath.SYMBOLS}/symbols.json`,
    };
}

function _initExtensionPaths() {
    // Extension base paths
    ExtensionPath = {
        DATA: buildExtensionUri(getAssetDataDir()),
        ICONS: buildExtensionUri(getAssetIconsDir()),
        LOGOS: buildExtensionUri(getAssetLogosDir()),
    };
    ExtensionPath.CLIPBOARD = `${ExtensionPath.DATA}/clipboard`;
    ExtensionPath.EMOJI = `${ExtensionPath.DATA}/emoji`;
    ExtensionPath.GIF = `${ExtensionPath.DATA}/gif`;
    ExtensionPath.KAOMOJI = `${ExtensionPath.DATA}/kaomoji`;
    ExtensionPath.SYMBOLS = `${ExtensionPath.DATA}/symbols`;
    ExtensionPath.FLAGS = `${ExtensionPath.ICONS}/flags`;
    ExtensionPath.UI = `${ExtensionPath.ICONS}/ui`;
    ExtensionPath.uri = buildExtensionUri;

    // Extension items
    ExtensionItem = {
        COUNTRIES: `${ExtensionPath.CLIPBOARD}/countries.json`,
        EMOJI: `${ExtensionPath.EMOJI}/emojis.json`,
        KAOMOJI: `${ExtensionPath.KAOMOJI}/kaomojis.json`,
        SYMBOLS: `${ExtensionPath.SYMBOLS}/symbols.json`,
    };
}

export function initStorage(uuid) {
    _initFilePaths(uuid);
    _initResourcePaths();
    _initExtensionPaths();
}
