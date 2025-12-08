import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

/**
 * GifDownloadService
 *
 * Handles downloading images and saving them to disk.
 */
export class GifDownloadService {
    /**
     * @param {Soup.Session} httpSession - The HTTP session to use for requests
     */
    constructor(httpSession) {
        this._httpSession = httpSession || new Soup.Session();
    }

    /**
     * Fetch image bytes from a URL.
     *
     * @param {string} url - The image URL
     * @returns {Promise<GLib.Bytes>} The image bytes
     */
    async fetchImageBytes(url) {
        const message = new Soup.Message({
            method: 'GET',
            uri: GLib.Uri.parse(url, GLib.UriFlags.NONE),
        });

        return new Promise((resolve, reject) => {
            this._httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, res) => {
                if (message.get_status() >= 300) {
                    reject(new Error(`HTTP Error ${message.get_status()}`));
                    return;
                }

                try {
                    resolve(session.send_and_read_finish(res));
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    /**
     * Saves a GLib.Bytes object to a file.
     *
     * @param {Gio.File} file - The target file
     * @param {GLib.Bytes} bytes - The data to save
     * @returns {Promise<void>}
     */
    async saveBytesToFile(file, bytes) {
        return new Promise((resolve, reject) => {
            file.replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.NONE, null, (source, res) => {
                try {
                    source.replace_contents_finish(res);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    /**
     * Helper to download and save an image to a specific path.
     *
     * @param {string} url - The URL to download
     * @param {string} destPath - The absolute path to save to
     * @returns {Promise<void>}
     */
    async downloadAndSave(url, destPath) {
        const bytes = await this.fetchImageBytes(url);
        const file = Gio.File.new_for_path(destPath);
        await this.saveBytesToFile(file, bytes);
        return bytes;
    }

    /**
     * Cancel any pending requests
     */
    destroy() {
        if (this._httpSession) {
            this._httpSession.abort();
            this._httpSession = null;
        }
    }
}
