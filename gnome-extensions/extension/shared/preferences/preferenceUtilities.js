/**
 * Extracts the min and max range from a GSettings schema key.
 *
 * @param {import('gi://Gio').Settings} settings The Gio.Settings instance.
 * @param {string} key The key to extract the range for.
 * @returns {Object|null} An object with min and max properties, or null if not a range.
 */
export function getRangeFromSchema(settings, key) {
    const schemaSource = settings.settings_schema;
    const schemaKey = schemaSource.get_key(key);
    const rangeVariant = schemaKey.get_range();
    const rangeType = rangeVariant.get_child_value(0).get_string()[0];

    if (rangeType === 'range') {
        const limits = rangeVariant.get_child_value(1).get_child_value(0);
        const min = limits.get_child_value(0).get_int32();
        const max = limits.get_child_value(1).get_int32();
        return { min, max };
    }

    return null;
}

/**
 * Normalizes an icon config into a usable icon theme name by stripping the .svg extension.
 *
 * @param {string|Object} config The icon name string or a configuration object with an `icon` property.
 * @returns {string} The normalized icon name.
 */
export function getIconName(config) {
    const name = typeof config === 'string' ? config : config?.icon;
    return name ? name.replace(/\.svg$/, '') : '';
}
