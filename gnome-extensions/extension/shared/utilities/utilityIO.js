import { ServiceIOImage } from '../services/serviceIOImage.js';
import { ServiceIOJson } from '../services/serviceIOJson.js';
import { ServiceIOText } from '../services/serviceIOText.js';
import { ServiceStorageFile } from '../services/serviceStorageFile.js';
import { ServiceStorageResource } from '../services/serviceStorageResource.js';

/**
 * IOFile helpers for reading and writing files on disk.
 * These methods are read/write and may not be suitable for all use cases, such as those involving GResources or other read-only resources.
 * For GResource IO, use the IOResource helpers instead.
 */
export const IOFile = {
    ...ServiceStorageFile,
    readText: (path) => ServiceIOText.readFile(path),
    writeText: (path, text) => ServiceIOText.writeFile(path, text),
    readJson: (path) => ServiceIOJson.readFile(path),
    writeJson: (path, data) => ServiceIOJson.writeFile(path, data),
};

/**
 * IOResource helpers for reading extension resources, such as those bundled in the extension's GResources.
 * These methods are read-only and may not be suitable for all use cases, such as those involving user data or files on disk.
 * For file IO, use the IOFile helpers instead.
 */
export const IOResource = {
    ...ServiceStorageResource,
    readText: (uri) => ServiceIOText.readResource(uri),
    readTextSync: (uri) => ServiceIOText.readResourceSync(uri),
    readJson: (uri) => ServiceIOJson.readResource(uri),
    readJsonSync: (uri) => ServiceIOJson.readResourceSync(uri),
};

/**
 * Text encoding and decoding helpers for converting between strings and byte arrays, with support for various encodings.
 */
export const IOText = {
    parseBytes: (bytes, encoding) => ServiceIOText.parseBytes(bytes, encoding),
    stringifyBytes: (text) => ServiceIOText.stringifyBytes(text),
    parseText: (text) => ServiceIOText.parseText(text),
    stringifyText: (text) => ServiceIOText.stringifyText(text),
};

/**
 * JSON parse and stringify helpers with byte and text conversion.
 */
export const IOJson = {
    parseBytes: (bytes) => ServiceIOJson.parseBytes(bytes),
    stringifyBytes: (data) => ServiceIOJson.stringifyBytes(data),
    parseText: (text) => ServiceIOJson.parseText(text),
    stringifyText: (data, space) => ServiceIOJson.stringifyText(data, space),
};

/**
 * Image encoding, decoding, and downloading helpers for working with image data in various formats.
 * Supports conversion between byte arrays and text representations, as well as downloading images from URLs.
 */
export const IOImage = {
    encode: (bytes) => ServiceIOImage.encode(bytes),
    decode: (bytes) => ServiceIOImage.decode(bytes),
    parseBytes: (bytes) => ServiceIOImage.parseBytes(bytes),
    stringifyBytes: (bytes) => ServiceIOImage.stringifyBytes(bytes),
    parseText: (bytes) => ServiceIOImage.parseText(bytes),
    stringifyText: (bytes) => ServiceIOImage.stringifyText(bytes),
    download: (httpSession, url) => ServiceIOImage.download(httpSession, url),
    hash: (bytes) => ServiceIOImage.hash(bytes),
    getMimeType: (filename) => ServiceIOImage.getMimeType(filename),
    getExtension: (mimetype) => ServiceIOImage.getExtension(mimetype),
};
