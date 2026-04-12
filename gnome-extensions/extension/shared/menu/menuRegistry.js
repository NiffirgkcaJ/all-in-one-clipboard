import { getMenuOrder } from './menuOrder.js';

const menuRegistry = new Map();
const menuOrderRegistry = [];
let initializeMenuRegistryPromise = null;

// ========================================================================
// Internal Loaders
// ========================================================================

/**
 * Loads a section definition module and returns the configured export.
 *
 * @param {object} orderEntry Order entry with module metadata.
 * @returns {Promise<object|null>} Section definition or null.
 */
async function loadMenuDefinition(orderEntry) {
    const sectionId = orderEntry?.id;
    const modulePath = orderEntry?.modulePath;
    const exportName = orderEntry?.exportName;

    if (!modulePath || !exportName) {
        return null;
    }

    try {
        const module = await import(modulePath);
        return module?.[exportName] || null;
    } catch (e) {
        const message = e?.message ?? String(e);
        console.error(`[AIO-Clipboard] Failed to load main menu definition '${sectionId}': ${message}`);
        return null;
    }
}

// ========================================================================
// Registration
// ========================================================================

/**
 * Registers a single section definition by ID.
 *
 * @param {object} sectionDefinition Section definition object.
 */
export function registerMenuSection(sectionDefinition) {
    if (!sectionDefinition?.id) {
        return;
    }

    menuRegistry.set(sectionDefinition.id, sectionDefinition);
}

/**
 * Registers multiple section definitions.
 *
 * @param {Array<object>} sectionDefinitions Section definitions to register.
 */
export function registerMenuSections(sectionDefinitions = []) {
    sectionDefinitions.forEach((sectionDefinition) => {
        registerMenuSection(sectionDefinition);
    });
}

/**
 * Sets the section order used for registry initialization.
 *
 * @param {Array<object>} sectionEntries Ordered section entries.
 */
export function registerMenuOrder(sectionEntries = []) {
    initializeMenuRegistryPromise = null;
    menuOrderRegistry.length = 0;

    sectionEntries.forEach((entry) => {
        if (!entry || typeof entry !== 'object') {
            return;
        }

        const hasValidId = typeof entry.id === 'string' && entry.id.length > 0;
        const hasValidModulePath = typeof entry.modulePath === 'string' && entry.modulePath.length > 0;
        const hasValidExportName = typeof entry.exportName === 'string' && entry.exportName.length > 0;

        if (!hasValidId || !hasValidModulePath || !hasValidExportName) {
            const sectionId = hasValidId ? entry.id : '<unknown>';
            console.warn(`[AIO-Clipboard] Ignoring invalid menu order entry '${sectionId}'. Required fields: id, modulePath, exportName.`);
            return;
        }

        menuOrderRegistry.push({ ...entry });
    });
}

/**
 * Initializes the registry and loads all ordered section definitions.
 *
 * @returns {Promise<void>} Resolves when initialization completes.
 */
export async function initializeMenuRegistry() {
    if (initializeMenuRegistryPromise) {
        return initializeMenuRegistryPromise;
    }

    initializeMenuRegistryPromise = (async () => {
        registerMenuOrder(getMenuOrder());
        menuRegistry.clear();

        if (menuOrderRegistry.length === 0) {
            console.warn('[AIO-Clipboard] Menu registry initialized without any registered order entries.');
            return;
        }

        const sectionDefinitions = await Promise.all(
            menuOrderRegistry.map(async (orderEntry) => {
                const sectionDefinition = await loadMenuDefinition(orderEntry);
                if (!sectionDefinition) {
                    return null;
                }

                return {
                    ...sectionDefinition,
                    ...orderEntry,
                    id: sectionDefinition.id,
                };
            }),
        );
        registerMenuSections(sectionDefinitions.filter(Boolean));
    })();

    return initializeMenuRegistryPromise;
}

// ========================================================================
// Queries
// ========================================================================

/**
 * Returns a section definition by ID.
 *
 * @param {string} sectionId Section ID.
 * @returns {object|null} Section definition or null.
 */
export function getMenuSectionById(sectionId) {
    return menuRegistry.get(sectionId) || null;
}

/**
 * Returns ordered section definitions that are currently available.
 *
 * @returns {Array<object>} Ordered section definitions.
 */
export function getMenuOrderedSections() {
    return menuOrderRegistry.map((entry) => getMenuSectionById(entry.id)).filter(Boolean);
}

/**
 * Returns a section definition by resolving its localized title.
 *
 * @param {string} translatedName Localized name.
 * @returns {object|null} Section definition or null.
 */
export function getMenuSectionByLocalizedName(translatedName) {
    const sections = getMenuOrderedSections();
    return sections.find((s) => s.name() === translatedName) || null;
}
