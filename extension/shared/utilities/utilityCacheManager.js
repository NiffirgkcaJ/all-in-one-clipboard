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
    if (limitInMB <= 0) return;

    const cacheDir = Gio.File.new_for_path(cacheDirPath);
    try {
        const exists = await new Promise((resolve) => {
            cacheDir.query_exists_async(null, (obj, res) => {
                resolve(obj.query_exists_finish(res));
            });
        });
        if (!exists) return;
    } catch {
        return;
    }

    const limitInBytes = limitInMB * 1024 * 1024;
    let totalSize = 0;
    const files = [];

    try {
        const enumerator = await new Promise((resolve, reject) => {
            cacheDir.enumerate_children_async('standard::name,time::access,standard::size', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, GLib.PRIORITY_LOW, null, (obj, res) => {
                try {
                    resolve(obj.enumerate_children_finish(res));
                } catch (e) {
                    reject(e);
                }
            });
        });

        // Recursive helper to fetch all files without blocking loops
        const fetchNextBatch = async () => {
            const fileInfos = await new Promise((resolve, reject) => {
                enumerator.next_files_async(50, GLib.PRIORITY_LOW, null, (obj, res) => {
                    try {
                        resolve(obj.next_files_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            if (!fileInfos || fileInfos.length === 0) return;

            for (const info of fileInfos) {
                totalSize += info.get_size();
                files.push({
                    path: GLib.build_filenamev([cacheDirPath, info.get_name()]),
                    accessTime: info.get_attribute_uint64('time::access'),
                    size: info.get_size(),
                });
            }

            await fetchNextBatch();
        };

        await fetchNextBatch();
    } catch (e) {
        console.warn(`[AIO-Clipboard] Failed to enumerate cache directory: ${e.message}`);
        return;
    }

    if (totalSize <= limitInBytes) return;

    files.sort((a, b) => a.accessTime - b.accessTime);

    const filesToDelete = [];
    for (const file of files) {
        if (totalSize <= limitInBytes) break;
        filesToDelete.push(file);
        totalSize -= file.size;
    }

    // Delete identified files in parallel
    await Promise.all(
        filesToDelete.map((file) => {
            const fileToDelete = Gio.File.new_for_path(file.path);
            return new Promise((resolve) => {
                fileToDelete.delete_async(GLib.PRIORITY_LOW, null, (source, res) => {
                    try {
                        source.delete_finish(res);
                    } catch {
                        // Ignore deletion errors
                    }
                    resolve();
                });
            });
        }),
    );
}
