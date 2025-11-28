import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/**
 * Manages the size of a cache directory by deleting the least recently accessed files
 * when a size limit is exceeded.
 *
 * @param {string} cacheDirPath - The absolute path to the cache directory.
 * @param {number} limitInMB - The cache size limit in megabytes. If 0, no limit is enforced.
 */
export async function manageCacheSize(cacheDirPath, limitInMB) {
    // If the limit is 0, it means unlimited. Do nothing.
    if (limitInMB <= 0) {
        return;
    }

    const cacheDir = Gio.File.new_for_path(cacheDirPath);
    if (!cacheDir.query_exists(null)) {
        return;
    }

    const limitInBytes = limitInMB * 1024 * 1024;
    let totalSize = 0;
    const files = [];

    try {
        const enumerator = cacheDir.enumerate_children('standard::name,time::access,standard::size', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);

        while (true) {
            const fileInfo = enumerator.next_file(null);
            if (!fileInfo) break;

            totalSize += fileInfo.get_size();
            files.push({
                path: GLib.build_filenamev([cacheDirPath, fileInfo.get_name()]),
                accessTime: fileInfo.get_attribute_uint64('time::access'),
                size: fileInfo.get_size(),
            });
        }
    } catch (e) {
        console.warn(`[AIO-Clipboard] Failed to enumerate cache directory: ${e.message}`);
        return;
    }

    // If we're under the limit, we're done.
    if (totalSize <= limitInBytes) {
        return;
    }

    // Sort files by access time, oldest first.
    files.sort((a, b) => a.accessTime - b.accessTime);

    // Delete the oldest files until the total size is under the limit.
    for (const file of files) {
        if (totalSize <= limitInBytes) {
            break; // We've deleted enough.
        }

        try {
            const fileToDelete = Gio.File.new_for_path(file.path);
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => {
                fileToDelete.delete_async(GLib.PRIORITY_LOW, null, (source, res) => {
                    try {
                        source.delete_finish(res);
                        resolve();
                    } catch {
                        // Don't reject, just warn and continue. The file might have been deleted by another process.
                        resolve();
                    }
                });
            });
            totalSize -= file.size;
        } catch {
            // Ignore errors here as well, just move on.
        }
    }
}
