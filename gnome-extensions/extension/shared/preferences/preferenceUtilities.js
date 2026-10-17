import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

// ========================================================================
// Navigation Utilities
// ========================================================================

/**
 * Creates a navigation subpage with a standard toolbar and scroll container.
 *
 * @param {Object} params Configuration parameters.
 * @param {string} params.title Window and page title.
 * @param {string} params.tag Unique navigation tag.
 * @returns {Object} Navigation page and preferences page child.
 */
export function createNavigationPage({ title, tag }) {
    const page = new Adw.NavigationPage({ title, tag });
    const toolbar = new Adw.ToolbarView();
    page.set_child(toolbar);

    const header = new Adw.HeaderBar({
        title_widget: new Adw.WindowTitle({ title }),
        show_end_title_buttons: true,
    });
    toolbar.add_top_bar(header);

    const scroll = new Gtk.ScrolledWindow({
        vexpand: true,
    });
    const content = new Adw.PreferencesPage({ title });
    scroll.set_child(content);
    toolbar.set_content(scroll);

    return { page, content };
}

/**
 * Presents a subpage using available preferences window navigation APIs.
 *
 * @param {Gtk.Widget} sourceWidget Source trigger widget.
 * @param {Adw.NavigationPage} subpage Navigation page to push.
 * @param {Adw.PreferencesWindow} [window] Root preferences window.
 */
export function presentSubpage(sourceWidget, subpage, window = null) {
    if (window && window.push_subpage) {
        window.push_subpage(subpage);
        return;
    }

    if (window && window.present_subpage) {
        window.present_subpage(subpage);
        return;
    }

    const root = sourceWidget.get_root();
    if (root && root.push_subpage) {
        root.push_subpage(subpage);
        return;
    }

    if (root && root.present_subpage) {
        root.present_subpage(subpage);
    }
}

// ========================================================================
// Schema and Icon Utilities
// ========================================================================

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
 * @param {string|Object} config The icon name string or a configuration object with an icon property.
 * @returns {string} The normalized icon name.
 */
export function getIconName(config) {
    const name = typeof config === 'string' ? config : config?.icon;
    return name ? name.replace(/\.svg$/, '') : '';
}
