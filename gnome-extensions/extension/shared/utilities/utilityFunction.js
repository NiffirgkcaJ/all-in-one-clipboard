/**
 * Checks whether a value can be called.
 *
 * @param {*} value Value to inspect.
 * @returns {boolean} True when the value is a function.
 */
export function isCallable(value) {
    return typeof value === 'function';
}
