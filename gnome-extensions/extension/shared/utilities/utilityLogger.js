/**
 * Global Logger utility for the extension.
 * Centralizes all console output and provides consistent prefixing.
 */
export const Logger = {
    /**
     * Formats the log message with a prefix and an optional tag.
     * @private
     * @param {string} msg The message to log.
     * @param {string} [tag] Optional tag/flag for context.
     * @returns {string} The formatted message.
     */
    _format(msg, tag) {
        const prefix = '[AIO-Clipboard]';
        const tagStr = typeof tag === 'string' && tag ? ` [${tag}]` : '';
        return `${prefix}${tagStr} ${msg}`;
    },

    /**
     * Internal method to safely route arguments depending on whether a tag is present.
     * @private
     */
    _log(level, msg, tag, ...args) {
        if (typeof tag === 'string' || tag === undefined || tag === null) {
            // If the tag is a string, use it for formatting
            console[level](this._format(msg, tag), ...args);
        } else {
            // If the tag is actually a data object, shift it to the args
            console[level](this._format(msg), tag, ...args);
        }
    },

    /**
     * Log an informational message.
     * @param {string} msg
     * @param {string|any} [tag] Optional tag string, or the first data argument.
     * @param  {...any} args Extra arguments to pass to console
     */
    info(msg, tag, ...args) {
        this._log('info', msg, tag, ...args);
    },

    /**
     * Log a warning message.
     * @param {string} msg
     * @param {string|any} [tag] Optional tag string, or the first data argument.
     * @param  {...any} args Extra arguments to pass to console
     */
    warn(msg, tag, ...args) {
        this._log('warn', msg, tag, ...args);
    },

    /**
     * Log an error message.
     * @param {string} msg
     * @param {string|any} [tag] Optional tag string, or the first data argument.
     * @param  {...any} args Extra arguments to pass to console
     */
    error(msg, tag, ...args) {
        this._log('error', msg, tag, ...args);
    },

    /**
     * Log a debug message.
     * @param {string} msg
     * @param {string|any} [tag] Optional tag string, or the first data argument.
     * @param  {...any} args Extra arguments to pass to console
     */
    debug(msg, tag, ...args) {
        this._log('debug', msg, tag, ...args);
    },
};
