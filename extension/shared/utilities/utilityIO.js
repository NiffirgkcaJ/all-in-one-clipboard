import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/**
 * File operations for the local filesystem.
 * All methods work with raw bytes (Uint8Array).
 */
export const IOFile = {
    /**
     * Reads a file and returns its contents as bytes.
     * @param {string} path - Absolute path to the file
     * @returns {Promise<Uint8Array|null>} File contents or null if not found
     */
    async read(path) {
        try {
            const file = Gio.File.new_for_path(path);
            return await new Promise((resolve, reject) => {
                file.load_contents_async(null, (source, res) => {
                    try {
                        const [ok, contents] = source.load_contents_finish(res);
                        resolve(ok ? contents : null);
                    } catch (e) {
                        if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) {
                            resolve(null);
                        } else {
                            reject(e);
                        }
                    }
                });
            });
        } catch (e) {
            console.error(`[AIO-Clipboard] IOFile.read failed for '${path}': ${e.message}`);
            return null;
        }
    },

    /**
     * Writes bytes to a file, creating parent directories if needed.
     * @param {string} path - Absolute path
     * @param {Uint8Array|GLib.Bytes} data - Data to write
     * @returns {Promise<boolean>} True if successful
     */
    async write(path, data) {
        try {
            const file = Gio.File.new_for_path(path);
            const parent = file.get_parent();
            if (parent && !parent.query_exists(null)) {
                try {
                    parent.make_directory_with_parents(null);
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS)) throw e;
                }
            }

            const bytes = data instanceof GLib.Bytes ? data : new GLib.Bytes(data);
            const flags = Gio.FileCreateFlags.REPLACE_DESTINATION | Gio.FileCreateFlags.PRIVATE;

            return await new Promise((resolve) => {
                file.replace_contents_bytes_async(bytes, null, false, flags, null, (source, res) => {
                    try {
                        source.replace_contents_finish(res);
                        resolve(true);
                    } catch (e) {
                        console.error(`[AIO-Clipboard] IOFile.write failed for '${path}': ${e.message}`);
                        resolve(false);
                    }
                });
            });
        } catch (e) {
            console.error(`[AIO-Clipboard] IOFile.write failed for '${path}': ${e.message}`);
            return false;
        }
    },

    /**
     * Deletes a file.
     * @param {string} path - Absolute path
     * @returns {Promise<boolean>} True if deleted or didn't exist
     */
    async delete(path) {
        try {
            const file = Gio.File.new_for_path(path);
            return await new Promise((resolve) => {
                file.delete_async(GLib.PRIORITY_DEFAULT, null, (source, res) => {
                    try {
                        source.delete_finish(res);
                        resolve(true);
                    } catch (e) {
                        if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) {
                            resolve(true);
                        } else {
                            console.warn(`[AIO-Clipboard] IOFile.delete failed for '${path}': ${e.message}`);
                            resolve(false);
                        }
                    }
                });
            });
        } catch (e) {
            console.error(`[AIO-Clipboard] IOFile.delete failed for '${path}': ${e.message}`);
            return false;
        }
    },

    /**
     * Checks if a file/directory exists asynchronously.
     * @param {string} path - Absolute path
     * @returns {Promise<boolean>}
     */
    async exists(path) {
        try {
            const file = Gio.File.new_for_path(path);
            return await new Promise((resolve) => {
                file.query_info_async(Gio.FILE_ATTRIBUTE_STANDARD_TYPE, Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null, (obj, res) => {
                    try {
                        obj.query_info_finish(res);
                        resolve(true);
                    } catch {
                        resolve(false);
                    }
                });
            });
        } catch {
            return false;
        }
    },

    /**
     * Checks if a file/directory exists synchronously.
     * @param {string} path - Absolute path
     * @returns {boolean}
     */
    existsSync(path) {
        return Gio.File.new_for_path(path).query_exists(null);
    },

    /**
     * Gets file metadata.
     * @param {string} path - Absolute path
     * @returns {Promise<{size: number, mime: string, name: string, type: {value: number, is: function(string): boolean}}|null>}
     */
    async getInfo(path) {
        try {
            const file = Gio.File.new_for_path(path);
            return await new Promise((resolve) => {
                file.query_info_async('standard::name,standard::content-type,standard::type,standard::size', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null, (obj, res) => {
                    try {
                        const info = obj.query_info_finish(res);
                        const fileType = info.get_file_type();
                        resolve({
                            size: info.get_size(),
                            mime: info.get_content_type(),
                            name: info.get_name(),
                            type: {
                                value: fileType,
                                is: (typeName) => fileType === Gio.FileType[typeName],
                            },
                        });
                    } catch {
                        resolve(null);
                    }
                });
            });
        } catch {
            return null;
        }
    },

    /**
     * Creates a directory and parents if needed (sync).
     * @param {string} path - Absolute path
     * @returns {boolean} True if exists or created
     */
    mkdir(path) {
        try {
            const dir = Gio.File.new_for_path(path);
            if (!dir.query_exists(null)) {
                dir.make_directory_with_parents(null);
            }
            return true;
        } catch (e) {
            if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS)) return true;
            console.error(`[AIO-Clipboard] IOFile.mkdir failed for '${path}': ${e.message}`);
            return false;
        }
    },

    /**
     * Lists files in a directory.
     * @param {string} path - Absolute path to directory
     * @returns {Promise<Array<{name: string, path: string}>|null>}
     */
    async list(path) {
        try {
            if (!(await this.exists(path))) return null;
            const dir = Gio.File.new_for_path(path);

            const enumerator = await new Promise((resolve, reject) => {
                dir.enumerate_children_async('standard::name', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_LOW, null, (obj, res) => {
                    try {
                        resolve(obj.enumerate_children_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            const files = [];
            const fetchBatch = async () => {
                const infos = await new Promise((resolve, reject) => {
                    enumerator.next_files_async(50, GLib.PRIORITY_LOW, null, (obj, res) => {
                        try {
                            resolve(obj.next_files_finish(res));
                        } catch (e) {
                            reject(e);
                        }
                    });
                });
                if (!infos || infos.length === 0) return;
                for (const info of infos) {
                    files.push({ name: info.get_name(), path: GLib.build_filenamev([path, info.get_name()]) });
                }
                await fetchBatch();
            };

            await fetchBatch();
            await new Promise((resolve) => {
                enumerator.close_async(GLib.PRIORITY_LOW, null, resolve);
            });
            return files;
        } catch (e) {
            console.warn(`[AIO-Clipboard] IOFile.list failed for '${path}': ${e.message}`);
            return null;
        }
    },

    /**
     * Empties a directory (deletes all children, keeps directory).
     * @param {string} path - Absolute path to directory
     * @returns {Promise<void>}
     */
    async empty(path) {
        try {
            if (!(await this.exists(path))) return;
            const dir = Gio.File.new_for_path(path);
            await this._deleteRecursively(dir, false);
        } catch (e) {
            console.warn(`[AIO-Clipboard] IOFile.empty failed for '${path}': ${e.message}`);
        }
    },

    /**
     * Recursively deletes a file or directory.
     * @param {string} path - Absolute path
     * @returns {Promise<boolean>}
     */
    async remove(path) {
        try {
            if (!(await this.exists(path))) return true;
            const file = Gio.File.new_for_path(path);
            await this._deleteRecursively(file, true);
            return true;
        } catch (e) {
            console.warn(`[AIO-Clipboard] IOFile.remove failed for '${path}': ${e.message}`);
            return false;
        }
    },

    /**
     * Copies a file.
     * @param {string} src - Source path
     * @param {string} dest - Destination path
     * @returns {Promise<boolean>}
     */
    async copy(src, dest) {
        try {
            const srcFile = Gio.File.new_for_path(src);
            const destFile = Gio.File.new_for_path(dest);
            const destParent = destFile.get_parent();
            if (destParent && !destParent.query_exists(null)) {
                destParent.make_directory_with_parents(null);
            }

            return await new Promise((resolve) => {
                srcFile.copy_async(destFile, Gio.FileCopyFlags.OVERWRITE, GLib.PRIORITY_DEFAULT, null, null, (source, res) => {
                    try {
                        source.copy_finish(res);
                        resolve(true);
                    } catch (e) {
                        console.error(`[AIO-Clipboard] IOFile.copy failed: ${e.message}`);
                        resolve(false);
                    }
                });
            });
        } catch (e) {
            console.error(`[AIO-Clipboard] IOFile.copy failed: ${e.message}`);
            return false;
        }
    },

    /**
     * Moves a file.
     * @param {string} src - Source path
     * @param {string} dest - Destination path
     * @returns {Promise<boolean>}
     */
    async move(src, dest) {
        try {
            const srcFile = Gio.File.new_for_path(src);
            const destFile = Gio.File.new_for_path(dest);
            const destParent = destFile.get_parent();
            if (destParent && !destParent.query_exists(null)) {
                destParent.make_directory_with_parents(null);
            }

            return await new Promise((resolve) => {
                srcFile.move_async(destFile, Gio.FileCopyFlags.OVERWRITE, GLib.PRIORITY_DEFAULT, null, null, (source, res) => {
                    try {
                        source.move_finish(res);
                        resolve(true);
                    } catch (e) {
                        console.error(`[AIO-Clipboard] IOFile.move failed: ${e.message}`);
                        resolve(false);
                    }
                });
            });
        } catch (e) {
            console.error(`[AIO-Clipboard] IOFile.move failed: ${e.message}`);
            return false;
        }
    },

    /**
     * Prunes a directory by deleting oldest files until under size limit.
     * @param {string} path - Directory path
     * @param {number} limitMB - Size limit in MB
     * @returns {Promise<void>}
     */
    async prune(path, limitMB) {
        if (limitMB <= 0) return;
        try {
            if (!(await this.exists(path))) return;

            const dir = Gio.File.new_for_path(path);
            const limitBytes = limitMB * 1024 * 1024;
            let totalSize = 0;
            const files = [];

            const enumerator = await new Promise((resolve, reject) => {
                dir.enumerate_children_async('standard::name,time::access,standard::size', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, GLib.PRIORITY_LOW, null, (obj, res) => {
                    try {
                        resolve(obj.enumerate_children_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            const fetchBatch = async () => {
                const infos = await new Promise((resolve, reject) => {
                    enumerator.next_files_async(50, GLib.PRIORITY_LOW, null, (obj, res) => {
                        try {
                            resolve(obj.next_files_finish(res));
                        } catch (e) {
                            reject(e);
                        }
                    });
                });
                if (!infos || infos.length === 0) return;
                for (const info of infos) {
                    totalSize += info.get_size();
                    files.push({
                        path: GLib.build_filenamev([path, info.get_name()]),
                        accessTime: info.get_attribute_uint64('time::access'),
                        size: info.get_size(),
                    });
                }
                await fetchBatch();
            };

            await fetchBatch();
            await new Promise((resolve) => {
                enumerator.close_async(GLib.PRIORITY_LOW, null, resolve);
            });

            if (totalSize <= limitBytes) return;

            files.sort((a, b) => a.accessTime - b.accessTime);
            const toDelete = [];
            for (const file of files) {
                if (totalSize <= limitBytes) break;
                toDelete.push(file);
                totalSize -= file.size;
            }

            await Promise.all(toDelete.map((f) => this.delete(f.path)));
        } catch (e) {
            console.warn(`[AIO-Clipboard] IOFile.prune failed for '${path}': ${e.message}`);
        }
    },

    /** @private */
    async _deleteRecursively(fileOrDir, deleteSelf = true) {
        try {
            const info = await new Promise((resolve) => {
                fileOrDir.query_info_async(Gio.FILE_ATTRIBUTE_STANDARD_TYPE, Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null, (obj, res) => {
                    try {
                        resolve(obj.query_info_finish(res));
                    } catch {
                        resolve(null);
                    }
                });
            });

            if (info && info.get_file_type() === Gio.FileType.DIRECTORY) {
                const enumerator = await new Promise((resolve, reject) => {
                    fileOrDir.enumerate_children_async('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null, (obj, res) => {
                        try {
                            resolve(obj.enumerate_children_finish(res));
                        } catch (e) {
                            reject(e);
                        }
                    });
                });

                const deleteChildren = async () => {
                    return new Promise((resolve, reject) => {
                        enumerator.next_files_async(50, GLib.PRIORITY_DEFAULT, null, (obj, res) => {
                            try {
                                const files = obj.next_files_finish(res);
                                if (files.length === 0) {
                                    resolve();
                                    return;
                                }
                                const promises = files.map((fileInfo) => {
                                    const child = fileOrDir.get_child(fileInfo.get_name());
                                    return this._deleteRecursively(child, true);
                                });
                                Promise.all(promises)
                                    .then(() => {
                                        deleteChildren().then(resolve).catch(reject);
                                    })
                                    .catch(reject);
                            } catch (e) {
                                reject(e);
                            }
                        });
                    });
                };

                await deleteChildren();
                await new Promise((resolve) => {
                    enumerator.close_async(GLib.PRIORITY_DEFAULT, null, resolve);
                });
            }

            if (deleteSelf) {
                await new Promise((resolve) => {
                    fileOrDir.delete_async(GLib.PRIORITY_DEFAULT, null, (obj, res) => {
                        try {
                            obj.delete_finish(res);
                        } catch {
                            // ignore
                        }
                        resolve();
                    });
                });
            }
        } catch (e) {
            console.warn(`[AIO-Clipboard] IOFile._deleteRecursively failed: ${e.message}`);
        }
    },
};

/**
 * Resource operations for GResource bundles (read-only).
 */
export const IOResource = {
    /**
     * Reads a resource from a GResource bundle.
     * @param {string} uri - Full resource URI (e.g., 'resource:///org/gnome/...')
     * @returns {Promise<Uint8Array|null>}
     */
    async read(uri) {
        try {
            const file = Gio.File.new_for_uri(uri);
            return await new Promise((resolve, reject) => {
                file.load_contents_async(null, (source, res) => {
                    try {
                        const [ok, contents] = source.load_contents_finish(res);
                        resolve(ok ? contents : null);
                    } catch (e) {
                        reject(e);
                    }
                });
            });
        } catch (e) {
            console.error(`[AIO-Clipboard] IOResource.read failed for '${uri}': ${e.message}`);
            return null;
        }
    },
};
