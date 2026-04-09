import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { RecentlyUsedPolicySettingKeys, RecentlyUsedPolicySettings } from '../constants/recentlyUsedPolicyConstants.js';

/**
 * Adds the Advanced Section Overrides row and subpages for Recently Used settings.
 *
 * Navigation flow:
 * Main Page -> Advanced Section Overrides -> Definition Detail.
 *
 * @param {object} options Setup options.
 * @param {Gio.Settings} options.settings Extension settings instance.
 * @param {Adw.PreferencesWindow} options.window Preferences window instance.
 * @param {Adw.PreferencesGroup} options.group Parent group where the row is added.
 * @param {Array<number>} options.signalIds Collector array for settings signal IDs.
 * @param {Function} options.getRangeFromSchema Function returning schema range by key.
 */
export function addRecentlyUsedAdvancedOverridesPrefs({ settings, window, group, signalIds = [], sectionDescriptors = [], getRangeFromSchema }) {
    if (!settings || !group || typeof getRangeFromSchema !== 'function') {
        return;
    }

    const advancedOverridesKey = RecentlyUsedPolicySettings.ADVANCED_SECTION_OVERRIDES;
    const policyKeys = RecentlyUsedPolicySettings;

    // ========================================================================
    // UI Utilities
    // ========================================================================

    const addRowToContainer = (container, row) => {
        if (typeof container?.add_row === 'function') {
            container.add_row(row);
            return;
        }

        container?.add?.(row);
    };

    const hasSchemaKey = (key) => {
        if (!settings?.settings_schema || typeof settings.settings_schema.get_key !== 'function') {
            return false;
        }

        try {
            settings.settings_schema.get_key(key);
            return true;
        } catch {
            return false;
        }
    };

    const presentSubpage = (sourceWidget, subpage) => {
        const root = sourceWidget?.get_root?.() ?? null;

        try {
            if (window && typeof window.push_subpage === 'function') {
                window.push_subpage(subpage);
                return;
            }
        } catch {
            // Fall through to alternate APIs.
        }

        try {
            if (window && typeof window.present_subpage === 'function') {
                window.present_subpage(subpage);
                return;
            }
        } catch {
            // Fall through to root APIs.
        }

        try {
            if (root && typeof root.push_subpage === 'function') {
                root.push_subpage(subpage);
                return;
            }
        } catch {
            // Fall through to root present API.
        }

        try {
            if (root && typeof root.present_subpage === 'function') {
                root.present_subpage(subpage);
            }
        } catch {
            // Keep preferences stable without throwing if all presentation APIs fail.
        }
    };

    const createNavigationPage = ({ title, tag }) => {
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
    };

    const policyModeOptions = [
        { id: 'limited', label: _('Limited') },
        { id: 'unlimited', label: _('Unlimited') },
    ];
    const displayModeOptions = [
        { id: 'fixed-window', label: _('Fixed Window') },
        { id: 'scroll-window', label: _('Scroll Window') },
    ];
    const validLimitModes = new Set(policyModeOptions.map((option) => option.id));
    const validDisplayModes = new Set(displayModeOptions.map((option) => option.id));

    const normalizePositiveInt = (value, fallback) => {
        if (!Number.isFinite(value)) {
            return fallback;
        }

        const normalized = Math.floor(value);
        return normalized >= 1 ? normalized : fallback;
    };
    const normalizeLimitMode = (value, fallback) => (validLimitModes.has(value) ? value : fallback);
    const normalizeDisplayMode = (value, fallback) => (validDisplayModes.has(value) ? value : fallback);

    const getLayoutLabel = (layoutFamily) => (layoutFamily === 'grid' ? _('Grid layout') : _('List layout'));
    const getSectionSubtitle = (descriptor, enabled) => {
        return _('%s - %s').format(getLayoutLabel(descriptor.layoutFamily), enabled ? _('Custom overrides enabled') : _('Using global defaults'));
    };

    // ========================================================================
    // Policy & State Management
    // ========================================================================

    const readGlobalPolicy = () => ({
        defaultLimitMode: settings.get_string(policyKeys.DEFAULT_LIMIT_MODE),
        customLimitByContext: settings.get_boolean(policyKeys.ENABLE_CUSTOM_LIMIT_POLICY),
        historyLimitMode: settings.get_string(policyKeys.HISTORY_LIMIT_MODE),
        searchLimitMode: settings.get_string(policyKeys.SEARCH_LIMIT_MODE),
        displayMode: settings.get_string(policyKeys.DEFAULT_DISPLAY_MODE),
        customDisplayByView: settings.get_boolean(policyKeys.ENABLE_CUSTOM_DISPLAY_MODE),
        listDisplayMode: settings.get_string(policyKeys.LIST_DISPLAY_MODE),
        gridDisplayMode: settings.get_string(policyKeys.GRID_DISPLAY_MODE),
        globalVisibleItems: settings.get_int(policyKeys.GLOBAL_VISIBLE_ITEMS),
        customVisibleByView: settings.get_boolean(policyKeys.ENABLE_CUSTOM_VISIBLE_ITEMS),
        listVisibleItems: settings.get_int(policyKeys.LIST_VISIBLE_ITEMS),
        gridVisibleItems: settings.get_int(policyKeys.GRID_VISIBLE_ITEMS),
        globalWindowRows: settings.get_int(policyKeys.GLOBAL_WINDOW_ROWS),
        customWindowByView: settings.get_boolean(policyKeys.ENABLE_CUSTOM_WINDOW_LIMITS),
        listWindowRows: settings.get_int(policyKeys.LIST_WINDOW_ROWS),
        gridWindowRows: settings.get_int(policyKeys.GRID_WINDOW_ROWS),
        gridWindowColumns: settings.get_int(policyKeys.GRID_WINDOW_COLUMNS),
        unlimitedSafetyCap: settings.get_int(policyKeys.UNLIMITED_SAFETY_CAP),
    });

    const readAdvancedRoot = () => {
        const fallback = { version: 1, sections: {} };

        let rawValue = '{}';
        try {
            rawValue = settings.get_string(advancedOverridesKey);
        } catch {
            return fallback;
        }

        try {
            const parsed = JSON.parse(rawValue);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return fallback;
            }

            const sections = parsed.sections;
            if (!sections || typeof sections !== 'object' || Array.isArray(sections)) {
                return fallback;
            }

            return {
                version: Number.isInteger(parsed.version) ? parsed.version : 1,
                sections: { ...sections },
            };
        } catch {
            return fallback;
        }
    };

    const writeAdvancedRoot = (root) => {
        const safeRoot = {
            version: Number.isInteger(root?.version) ? root.version : 1,
            sections: root?.sections && typeof root.sections === 'object' && !Array.isArray(root.sections) ? root.sections : {},
        };

        try {
            settings.set_string(advancedOverridesKey, JSON.stringify(safeRoot));
        } catch (e) {
            console.warn(`[AIO-Clipboard] Failed to write Recently Used advanced overrides: ${e?.message ?? String(e)}`);
        }
    };

    const readSectionState = (sectionId) => {
        const root = readAdvancedRoot();
        const rawEntry = root.sections?.[sectionId];
        const safeEntry = rawEntry && typeof rawEntry === 'object' && !Array.isArray(rawEntry) ? rawEntry : {};
        const rawPolicy = safeEntry.policy && typeof safeEntry.policy === 'object' && !Array.isArray(safeEntry.policy) ? safeEntry.policy : {};
        const globalPolicy = readGlobalPolicy();
        const hasRawPolicyKey = (key) => Object.prototype.hasOwnProperty.call(rawPolicy, key);
        const enabled = safeEntry.enabled === true;
        const policy = { ...globalPolicy, ...rawPolicy };

        // When section overrides are enabled, any missing custom flags default to false locally.
        if (enabled) {
            if (!hasRawPolicyKey('customLimitByContext')) {
                policy.customLimitByContext = false;
            }
            if (!hasRawPolicyKey('customDisplayByView')) {
                policy.customDisplayByView = false;
            }
            if (!hasRawPolicyKey('customVisibleByView')) {
                policy.customVisibleByView = false;
            }
            if (!hasRawPolicyKey('customWindowByView')) {
                policy.customWindowByView = false;
            }
        }

        return {
            enabled,
            policy,
            rawPolicy,
        };
    };

    const materializeSectionPolicy = (rawPolicy, enabled) => {
        const safeRawPolicy = rawPolicy && typeof rawPolicy === 'object' && !Array.isArray(rawPolicy) ? rawPolicy : {};
        const hasRawPolicyKey = (key) => Object.prototype.hasOwnProperty.call(safeRawPolicy, key);
        const globalPolicy = readGlobalPolicy();
        const merged = { ...globalPolicy, ...safeRawPolicy };

        if (enabled) {
            if (!hasRawPolicyKey('customLimitByContext')) {
                merged.customLimitByContext = false;
            }
            if (!hasRawPolicyKey('customDisplayByView')) {
                merged.customDisplayByView = false;
            }
            if (!hasRawPolicyKey('customVisibleByView')) {
                merged.customVisibleByView = false;
            }
            if (!hasRawPolicyKey('customWindowByView')) {
                merged.customWindowByView = false;
            }
        }

        const defaultLimitMode = normalizeLimitMode(merged.defaultLimitMode, globalPolicy.defaultLimitMode);
        const customLimitByContext = Boolean(merged.customLimitByContext);
        const historyLimitMode = customLimitByContext ? normalizeLimitMode(merged.historyLimitMode, globalPolicy.historyLimitMode) : defaultLimitMode;
        const searchLimitMode = customLimitByContext ? normalizeLimitMode(merged.searchLimitMode, globalPolicy.searchLimitMode) : defaultLimitMode;

        const displayMode = normalizeDisplayMode(merged.displayMode, globalPolicy.displayMode);
        const customDisplayByView = Boolean(merged.customDisplayByView);
        const listDisplayMode = customDisplayByView ? normalizeDisplayMode(merged.listDisplayMode, displayMode) : displayMode;
        const gridDisplayMode = customDisplayByView ? normalizeDisplayMode(merged.gridDisplayMode, displayMode) : displayMode;

        const globalVisibleItems = normalizePositiveInt(merged.globalVisibleItems, globalPolicy.globalVisibleItems);
        const customVisibleByView = Boolean(merged.customVisibleByView);
        const listVisibleItems = customVisibleByView ? normalizePositiveInt(merged.listVisibleItems, globalVisibleItems) : globalVisibleItems;
        const gridVisibleItems = customVisibleByView ? normalizePositiveInt(merged.gridVisibleItems, globalVisibleItems) : globalVisibleItems;

        const globalWindowRows = normalizePositiveInt(merged.globalWindowRows, globalPolicy.globalWindowRows);
        const customWindowByView = Boolean(merged.customWindowByView);
        const listWindowRows = customWindowByView ? normalizePositiveInt(merged.listWindowRows, globalWindowRows) : globalWindowRows;
        const gridWindowRows = customWindowByView ? normalizePositiveInt(merged.gridWindowRows, globalWindowRows) : globalWindowRows;
        const gridWindowColumns = customWindowByView ? normalizePositiveInt(merged.gridWindowColumns, globalPolicy.gridWindowColumns) : normalizePositiveInt(globalPolicy.gridWindowColumns, 1);

        const unlimitedSafetyCap = normalizePositiveInt(merged.unlimitedSafetyCap, globalPolicy.unlimitedSafetyCap);

        return {
            defaultLimitMode,
            customLimitByContext,
            historyLimitMode,
            searchLimitMode,
            displayMode,
            customDisplayByView,
            listDisplayMode,
            gridDisplayMode,
            globalVisibleItems,
            customVisibleByView,
            listVisibleItems,
            gridVisibleItems,
            globalWindowRows,
            customWindowByView,
            listWindowRows,
            gridWindowRows,
            gridWindowColumns,
            unlimitedSafetyCap,
        };
    };

    const updateSectionEntry = (sectionId, updater) => {
        const root = readAdvancedRoot();
        const currentEntry = root.sections?.[sectionId];
        const safeCurrent = currentEntry && typeof currentEntry === 'object' && !Array.isArray(currentEntry) ? currentEntry : { enabled: false, policy: {} };

        const nextEntry = updater({
            enabled: safeCurrent.enabled === true,
            policy: safeCurrent.policy && typeof safeCurrent.policy === 'object' && !Array.isArray(safeCurrent.policy) ? { ...safeCurrent.policy } : {},
        });

        const nextEnabled = nextEntry?.enabled === true;
        const nextRawPolicy = nextEntry?.policy && typeof nextEntry.policy === 'object' && !Array.isArray(nextEntry.policy) ? nextEntry.policy : {};

        root.sections[sectionId] = {
            enabled: nextEnabled,
            policy: materializeSectionPolicy(nextRawPolicy, nextEnabled),
        };
        writeAdvancedRoot(root);
    };

    // ========================================================================
    // Component Builders & Synchronizers
    // ========================================================================

    const setComboSelected = (row, options, value) => {
        const nextIndex = options.findIndex((option) => option.id === value);
        const safeIndex = nextIndex > -1 ? nextIndex : 0;
        if (row.get_selected() !== safeIndex) {
            row.set_selected(safeIndex);
        }
    };

    const setSwitchActive = (row, value) => {
        const nextValue = Boolean(value);
        if (row.get_active() !== nextValue) {
            row.set_active(nextValue);
        }
    };

    const syncExpanderEnabledState = (expander, enabled) => {
        expander.enable_expansion = Boolean(enabled);
        if (!expander.enable_expansion && expander.expanded) {
            expander.expanded = false;
        }
    };

    const watchForDisabledExpansion = (expander, isSyncingRef) => {
        expander.connect('notify::expanded', () => {
            if (isSyncingRef.get()) {
                return;
            }

            if (!expander.enable_expansion && expander.expanded) {
                isSyncingRef.set(true);
                expander.expanded = false;
                isSyncingRef.set(false);
            }
        });
    };

    const createOverrideComboRow = ({ container, title, subtitle, options, onSelect, isSyncingRef }) => {
        const row = new Adw.ComboRow({
            title,
            subtitle,
            model: new Gtk.StringList({ strings: options.map((option) => option.label) }),
        });
        addRowToContainer(container, row);

        row.connect('notify::selected', () => {
            if (isSyncingRef.get()) {
                return;
            }

            const index = row.get_selected();
            if (index < 0 || index >= options.length) {
                return;
            }

            onSelect(options[index].id);
        });

        return row;
    };

    const createOverrideSpinRow = ({ container, schemaKey, title, subtitle, onChange, isSyncingRef }) => {
        const range = getRangeFromSchema(schemaKey) || { min: 1, max: 1000 };

        let defaultValue = range.min;
        try {
            defaultValue = settings.get_default_value(schemaKey).get_int32();
        } catch {
            defaultValue = range.min;
        }

        const row = new Adw.SpinRow({
            title,
            subtitle: _('%s Range: %d-%d. Default: %d.').format(subtitle, range.min, range.max, defaultValue),
            adjustment: new Gtk.Adjustment({
                lower: range.min,
                upper: range.max,
                step_increment: 1,
            }),
        });
        addRowToContainer(container, row);

        row.adjustment.connect('value-changed', () => {
            if (isSyncingRef.get()) {
                return;
            }

            const nextValue = Math.max(1, Math.floor(row.adjustment.get_value()));
            onChange(nextValue);
        });

        return row;
    };

    // ========================================================================
    // Core Overrides View
    // ========================================================================

    const refreshers = [];
    const refreshAll = () => {
        refreshers.forEach((refreshFn) => {
            try {
                refreshFn();
            } catch {
                // Keep preferences resilient if one row fails.
            }
        });
    };

    const advancedOverridesRow = new Adw.ActionRow({
        title: _('Advanced Section Overrides'),
        subtitle: _('Open section-level overrides.'),
        activatable: true,
    });
    advancedOverridesRow.add_suffix(
        new Gtk.Image({
            icon_name: 'go-next-symbolic',
            valign: Gtk.Align.CENTER,
        }),
    );
    group.add(advancedOverridesRow);

    const advancedNav = createNavigationPage({
        title: _('Advanced Section Overrides'),
        tag: 'recently-used-advanced-overrides',
    });

    const advancedGroup = new Adw.PreferencesGroup({
        title: _('Definitions'),
        description: _('Choose a section to edit its override definition.'),
    });
    advancedNav.content.add(advancedGroup);

    advancedOverridesRow.connect('activated', () => {
        presentSubpage(advancedOverridesRow, advancedNav.page);
    });

    if (!hasSchemaKey(advancedOverridesKey)) {
        advancedGroup.add(
            new Adw.ActionRow({
                title: _('Advanced Section Overrides'),
                subtitle: _('Unavailable until the extension schema is updated.'),
            }),
        );
        return;
    }

    // ========================================================================
    // Detail Page Generator
    // ========================================================================

    const createSectionDetailPage = (descriptor) => {
        const isGridSection = descriptor.layoutFamily === 'grid';
        const isFixedLayoutSection = descriptor.layoutFamily === 'grid' || descriptor.layoutFamily === 'list';
        let isSyncing = false;
        const isSyncingRef = {
            get: () => isSyncing,
            set: (value) => {
                isSyncing = Boolean(value);
            },
        };

        const detailNav = createNavigationPage({
            title: _(descriptor.title),
            tag: `recently-used-advanced-overrides-${descriptor.id}`,
        });

        const detailGroup = new Adw.PreferencesGroup({
            title: _(descriptor.title),
            description: _('Customize this definition without changing global defaults.'),
        });
        detailNav.content.add(detailGroup);

        const sectionEnabledRow = new Adw.SwitchRow({
            title: _('Enable Custom Overrides'),
            subtitle: _('When disabled, this definition uses global policy.'),
        });
        detailGroup.add(sectionEnabledRow);
        sectionEnabledRow.connect('notify::active', () => {
            if (isSyncingRef.get()) {
                return;
            }

            updateSectionEntry(descriptor.id, (currentEntry) => ({
                enabled: sectionEnabledRow.get_active(),
                policy: currentEntry.policy && typeof currentEntry.policy === 'object' && !Array.isArray(currentEntry.policy) ? { ...currentEntry.policy } : {},
            }));
            refreshAll();
        });

        const patchSectionPolicy = (patch) => {
            const normalizedPatch = isFixedLayoutSection
                ? {
                      customDisplayByView: false,
                      customVisibleByView: false,
                      customWindowByView: false,
                      ...patch,
                  }
                : patch;

            updateSectionEntry(descriptor.id, (currentEntry) => {
                const basePolicy = currentEntry.policy && typeof currentEntry.policy === 'object' && !Array.isArray(currentEntry.policy) ? { ...currentEntry.policy } : {};
                return {
                    enabled: currentEntry.enabled === true,
                    policy: {
                        ...basePolicy,
                        ...normalizedPatch,
                    },
                };
            });

            refreshAll();
        };

        const globalLimitPolicyRow = createOverrideComboRow({
            container: detailGroup,
            title: _('Global Limit Policy'),
            subtitle: _('Used when custom limit policy by context is disabled.'),
            options: policyModeOptions,
            onSelect: (value) => patchSectionPolicy({ defaultLimitMode: value }),
            isSyncingRef,
        });

        const limitPolicyByContextExpander = new Adw.ExpanderRow({
            title: _('Customize Limit Policy by Context'),
            subtitle: _('Configure browse and search limit policy independently.'),
            show_enable_switch: true,
        });
        addRowToContainer(detailGroup, limitPolicyByContextExpander);
        watchForDisabledExpansion(limitPolicyByContextExpander, isSyncingRef);
        limitPolicyByContextExpander.connect('notify::enable-expansion', () => {
            if (isSyncingRef.get()) {
                return;
            }

            patchSectionPolicy({ customLimitByContext: limitPolicyByContextExpander.enable_expansion });
        });

        const browsePolicyRow = createOverrideComboRow({
            container: limitPolicyByContextExpander,
            title: _('Browse Policy'),
            subtitle: _('Policy applied while browsing (non-search).'),
            options: policyModeOptions,
            onSelect: (value) => patchSectionPolicy({ historyLimitMode: value }),
            isSyncingRef,
        });

        const searchPolicyRow = createOverrideComboRow({
            container: limitPolicyByContextExpander,
            title: _('Search Policy'),
            subtitle: _('Policy applied only when search is enabled.'),
            options: policyModeOptions,
            onSelect: (value) => patchSectionPolicy({ searchLimitMode: value }),
            isSyncingRef,
        });

        const globalDisplayModeRow = createOverrideComboRow({
            container: detailGroup,
            title: _('Global Display Mode'),
            subtitle: _('Used when custom display mode by view is disabled.'),
            options: displayModeOptions,
            onSelect: (value) => patchSectionPolicy({ displayMode: value }),
            isSyncingRef,
        });

        const displayByViewExpander = new Adw.ExpanderRow({
            title: _('Customize Display Mode by View'),
            subtitle: _('Configure list and grid display mode independently.'),
            show_enable_switch: true,
        });
        addRowToContainer(detailGroup, displayByViewExpander);
        watchForDisabledExpansion(displayByViewExpander, isSyncingRef);
        displayByViewExpander.connect('notify::enable-expansion', () => {
            if (isSyncingRef.get()) {
                return;
            }

            patchSectionPolicy({ customDisplayByView: displayByViewExpander.enable_expansion });
        });

        const listDisplayModeRow = createOverrideComboRow({
            container: displayByViewExpander,
            title: _('List Display Mode'),
            subtitle: _('Display mode for list view.'),
            options: displayModeOptions,
            onSelect: (value) => patchSectionPolicy({ listDisplayMode: value }),
            isSyncingRef,
        });

        const gridDisplayModeRow = createOverrideComboRow({
            container: displayByViewExpander,
            title: _('Grid Display Mode'),
            subtitle: _('Display mode for grid view.'),
            options: displayModeOptions,
            onSelect: (value) => patchSectionPolicy({ gridDisplayMode: value }),
            isSyncingRef,
        });

        const globalVisibleItemsRow = createOverrideSpinRow({
            container: detailGroup,
            schemaKey: policyKeys.GLOBAL_VISIBLE_ITEMS,
            title: _('Global Visible Items'),
            subtitle: isGridSection ? _('Global item cap for grid when custom visible-items by view is disabled.') : _('Global item cap for list when custom visible-items by view is disabled.'),
            onChange: (value) => patchSectionPolicy({ globalVisibleItems: value }),
            isSyncingRef,
        });

        const visibleItemsByViewExpander = new Adw.ExpanderRow({
            title: _('Customize Visible Items by View'),
            subtitle: _('Configure list and grid item caps independently.'),
            show_enable_switch: true,
        });
        addRowToContainer(detailGroup, visibleItemsByViewExpander);
        watchForDisabledExpansion(visibleItemsByViewExpander, isSyncingRef);
        visibleItemsByViewExpander.connect('notify::enable-expansion', () => {
            if (isSyncingRef.get()) {
                return;
            }

            patchSectionPolicy({ customVisibleByView: visibleItemsByViewExpander.enable_expansion });
        });

        const listVisibleItemsRow = createOverrideSpinRow({
            container: visibleItemsByViewExpander,
            schemaKey: policyKeys.LIST_VISIBLE_ITEMS,
            title: _('List Visible Items'),
            subtitle: _('Item cap for list view.'),
            onChange: (value) => patchSectionPolicy({ listVisibleItems: value }),
            isSyncingRef,
        });

        const gridVisibleItemsRow = createOverrideSpinRow({
            container: visibleItemsByViewExpander,
            schemaKey: policyKeys.GRID_VISIBLE_ITEMS,
            title: _('Grid Visible Items'),
            subtitle: _('Item cap for grid view.'),
            onChange: (value) => patchSectionPolicy({ gridVisibleItems: value }),
            isSyncingRef,
        });

        const globalWindowRowsRow = createOverrideSpinRow({
            container: detailGroup,
            schemaKey: policyKeys.GLOBAL_WINDOW_ROWS,
            title: _('Global Window Rows'),
            subtitle: isGridSection ? _('Global row limit for grid when custom window limits by view is disabled.') : _('Global row limit for list when custom window limits by view is disabled.'),
            onChange: (value) => patchSectionPolicy({ globalWindowRows: value }),
            isSyncingRef,
        });

        const windowByViewExpander = new Adw.ExpanderRow({
            title: _('Customize Window Limits by View'),
            subtitle: _('Configure list and grid window rows and grid columns independently.'),
            show_enable_switch: true,
        });
        addRowToContainer(detailGroup, windowByViewExpander);
        watchForDisabledExpansion(windowByViewExpander, isSyncingRef);
        windowByViewExpander.connect('notify::enable-expansion', () => {
            if (isSyncingRef.get()) {
                return;
            }

            patchSectionPolicy({ customWindowByView: windowByViewExpander.enable_expansion });
        });

        const listWindowRowsRow = createOverrideSpinRow({
            container: windowByViewExpander,
            schemaKey: policyKeys.LIST_WINDOW_ROWS,
            title: _('List Window Rows'),
            subtitle: _('Row limit for list view window.'),
            onChange: (value) => patchSectionPolicy({ listWindowRows: value }),
            isSyncingRef,
        });

        const gridWindowRowsRow = createOverrideSpinRow({
            container: windowByViewExpander,
            schemaKey: policyKeys.GRID_WINDOW_ROWS,
            title: _('Grid Window Rows'),
            subtitle: _('Row limit for grid view window.'),
            onChange: (value) => patchSectionPolicy({ gridWindowRows: value }),
            isSyncingRef,
        });

        const gridWindowColumnsRow = createOverrideSpinRow({
            container: windowByViewExpander,
            schemaKey: policyKeys.GRID_WINDOW_COLUMNS,
            title: _('Grid Window Columns'),
            subtitle: _('Column value for grid view window.'),
            onChange: (value) => patchSectionPolicy({ gridWindowColumns: value }),
            isSyncingRef,
        });

        const unlimitedSafetyCapRow = createOverrideSpinRow({
            container: detailGroup,
            schemaKey: policyKeys.UNLIMITED_SAFETY_CAP,
            title: _('Unlimited Safety Cap'),
            subtitle: _('Hard cap for unlimited mode to protect shell responsiveness.'),
            onChange: (value) => patchSectionPolicy({ unlimitedSafetyCap: value }),
            isSyncingRef,
        });

        if (isGridSection) {
            listDisplayModeRow.visible = false;
            listVisibleItemsRow.visible = false;
            listWindowRowsRow.visible = false;
        } else {
            gridDisplayModeRow.visible = false;
            gridVisibleItemsRow.visible = false;
            gridWindowRowsRow.visible = false;
            gridWindowColumnsRow.visible = false;
        }

        if (isFixedLayoutSection) {
            displayByViewExpander.visible = false;
            visibleItemsByViewExpander.visible = false;
            windowByViewExpander.visible = false;
        }

        const needsFixedLayoutPolicyReset = (policy) => {
            return Boolean(isFixedLayoutSection && (policy.customDisplayByView || policy.customVisibleByView || policy.customWindowByView));
        };

        const syncControlValues = (policy, enabled) => {
            setSwitchActive(sectionEnabledRow, enabled);

            setComboSelected(globalLimitPolicyRow, policyModeOptions, policy.defaultLimitMode);
            syncExpanderEnabledState(limitPolicyByContextExpander, policy.customLimitByContext);
            setComboSelected(browsePolicyRow, policyModeOptions, policy.historyLimitMode);
            setComboSelected(searchPolicyRow, policyModeOptions, policy.searchLimitMode);

            setComboSelected(globalDisplayModeRow, displayModeOptions, policy.displayMode);
            syncExpanderEnabledState(displayByViewExpander, policy.customDisplayByView);
            setComboSelected(listDisplayModeRow, displayModeOptions, policy.listDisplayMode);
            setComboSelected(gridDisplayModeRow, displayModeOptions, policy.gridDisplayMode);

            globalVisibleItemsRow.adjustment.set_value(policy.globalVisibleItems);
            syncExpanderEnabledState(visibleItemsByViewExpander, policy.customVisibleByView);
            listVisibleItemsRow.adjustment.set_value(policy.listVisibleItems);
            gridVisibleItemsRow.adjustment.set_value(policy.gridVisibleItems);

            globalWindowRowsRow.adjustment.set_value(policy.globalWindowRows);
            syncExpanderEnabledState(windowByViewExpander, policy.customWindowByView);
            listWindowRowsRow.adjustment.set_value(policy.listWindowRows);
            gridWindowRowsRow.adjustment.set_value(policy.gridWindowRows);
            gridWindowColumnsRow.adjustment.set_value(policy.gridWindowColumns);

            unlimitedSafetyCapRow.adjustment.set_value(policy.unlimitedSafetyCap);
        };

        const applyLimitSensitivity = (policy, enabled, searchEnabled) => {
            const customLimitByContextEnabled = Boolean(policy.customLimitByContext);
            globalLimitPolicyRow.sensitive = enabled && !customLimitByContextEnabled;
            limitPolicyByContextExpander.sensitive = enabled;
            browsePolicyRow.sensitive = enabled && customLimitByContextEnabled;
            searchPolicyRow.sensitive = enabled && customLimitByContextEnabled && searchEnabled;
        };

        const applyDisplaySensitivity = (policy, enabled) => {
            const customDisplayByViewEnabled = Boolean(policy.customDisplayByView);
            globalDisplayModeRow.sensitive = enabled && (isFixedLayoutSection || !customDisplayByViewEnabled);
            displayByViewExpander.sensitive = enabled;
            listDisplayModeRow.sensitive = enabled && customDisplayByViewEnabled;
            gridDisplayModeRow.sensitive = enabled && customDisplayByViewEnabled;
        };

        const applyVisibleItemSensitivity = (policy, enabled) => {
            const customVisibleByViewEnabled = Boolean(policy.customVisibleByView);
            globalVisibleItemsRow.sensitive = enabled && (isFixedLayoutSection || !customVisibleByViewEnabled);
            visibleItemsByViewExpander.sensitive = enabled;
            listVisibleItemsRow.sensitive = enabled && customVisibleByViewEnabled;
            gridVisibleItemsRow.sensitive = enabled && customVisibleByViewEnabled;
        };

        const applyWindowSensitivity = (policy, enabled) => {
            const customWindowByViewEnabled = Boolean(policy.customWindowByView);
            globalWindowRowsRow.sensitive = enabled && (isFixedLayoutSection || !customWindowByViewEnabled);
            windowByViewExpander.sensitive = enabled;
            listWindowRowsRow.sensitive = enabled && customWindowByViewEnabled;
            gridWindowRowsRow.sensitive = enabled && customWindowByViewEnabled;
            gridWindowColumnsRow.sensitive = enabled && customWindowByViewEnabled;
        };

        const refresh = () => {
            const state = readSectionState(descriptor.id);
            const policy = state.policy;
            const enabled = state.enabled;
            const searchEnabled = settings.get_boolean(policyKeys.ENABLE_RECENTLY_USED_SEARCH);

            if (needsFixedLayoutPolicyReset(policy)) {
                patchSectionPolicy({});
                return;
            }

            isSyncingRef.set(true);
            try {
                syncControlValues(policy, enabled);
            } finally {
                isSyncingRef.set(false);
            }

            applyLimitSensitivity(policy, enabled, searchEnabled);
            applyDisplaySensitivity(policy, enabled);
            applyVisibleItemSensitivity(policy, enabled);
            applyWindowSensitivity(policy, enabled);
            unlimitedSafetyCapRow.sensitive = enabled;
        };

        return {
            page: detailNav.page,
            refresh,
        };
    };

    sectionDescriptors.forEach((descriptor) => {
        const definitionRow = new Adw.ActionRow({
            title: _(descriptor.title),
            subtitle: getSectionSubtitle(descriptor, false),
            activatable: true,
        });
        definitionRow.add_suffix(
            new Gtk.Image({
                icon_name: 'go-next-symbolic',
                valign: Gtk.Align.CENTER,
            }),
        );
        advancedGroup.add(definitionRow);

        const detail = createSectionDetailPage(descriptor);
        definitionRow.connect('activated', () => {
            presentSubpage(definitionRow, detail.page);
        });

        refreshers.push(() => {
            const state = readSectionState(descriptor.id);
            definitionRow.subtitle = getSectionSubtitle(descriptor, state.enabled);
        });
        refreshers.push(detail.refresh);
    });

    const advancedWatchKeys = new Set(RecentlyUsedPolicySettingKeys);
    advancedWatchKeys.add(advancedOverridesKey);

    advancedWatchKeys.forEach((key) => {
        try {
            signalIds.push(settings.connect(`changed::${key}`, refreshAll));
        } catch {
            // Ignore missing keys to keep preferences resilient.
        }
    });

    refreshAll();
}
