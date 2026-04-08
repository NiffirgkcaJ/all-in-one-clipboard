import { RecentlyUsedOrder } from '../definitions/recentlyUsedOrder.js';

const recentlyUsedRegistry = new Map();
const recentlyUsedOrderRegistry = [];
let initializeRecentlyUsedRegistryPromise = null;

// ========================================================================
// Internal Loaders
// ========================================================================

/**
 * Loads a section definition module and returns the configured export.
 *
 * @param {object} orderEntry Order entry with module metadata.
 * @returns {Promise<object|null>} Section definition or null.
 */
async function loadSectionDefinition(orderEntry) {
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
        console.error(`[AIO-Clipboard] Failed to load section definition '${sectionId}': ${message}`);
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
export function registerRecentlyUsedSection(sectionDefinition) {
    if (!sectionDefinition?.id) {
        return;
    }

    recentlyUsedRegistry.set(sectionDefinition.id, sectionDefinition);
}

/**
 * Registers multiple section definitions.
 *
 * @param {Array<object>} sectionDefinitions Section definitions to register.
 */
export function registerRecentlyUsedSections(sectionDefinitions = []) {
    sectionDefinitions.forEach((sectionDefinition) => {
        registerRecentlyUsedSection(sectionDefinition);
    });
}

/**
 * Initializes the registry and loads all ordered section definitions.
 *
 * @returns {Promise<void>} Resolves when initialization completes.
 */
export async function initializeRecentlyUsedRegistry() {
    if (initializeRecentlyUsedRegistryPromise) {
        return initializeRecentlyUsedRegistryPromise;
    }

    initializeRecentlyUsedRegistryPromise = (async () => {
        registerRecentlyUsedOrder(RecentlyUsedOrder);
        recentlyUsedRegistry.clear();

        if (recentlyUsedOrderRegistry.length === 0) {
            console.warn('[AIO-Clipboard] Recently Used registry initialized without any registered order entries.');
            return;
        }

        const sectionDefinitions = await Promise.all(
            recentlyUsedOrderRegistry.map(async (orderEntry) => {
                const sectionDefinition = await loadSectionDefinition(orderEntry);
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
        registerRecentlyUsedSections(sectionDefinitions.filter(Boolean));
    })();

    return initializeRecentlyUsedRegistryPromise;
}

/**
 * Sets the section order used for registry initialization.
 *
 * @param {Array<object>} sectionEntries Ordered section entries.
 */
export function registerRecentlyUsedOrder(sectionEntries = []) {
    initializeRecentlyUsedRegistryPromise = null;
    recentlyUsedOrderRegistry.length = 0;

    sectionEntries.forEach((entry) => {
        if (typeof entry === 'string') {
            console.warn(`[AIO-Clipboard] Ignoring Recently Used order string entry '${entry}'. Expected object with id/modulePath/exportName.`);
            return;
        }

        if (!entry || typeof entry !== 'object') {
            return;
        }

        const hasValidId = typeof entry.id === 'string' && entry.id.length > 0;
        const hasValidModulePath = typeof entry.modulePath === 'string' && entry.modulePath.length > 0;
        const hasValidExportName = typeof entry.exportName === 'string' && entry.exportName.length > 0;

        if (!hasValidId || !hasValidModulePath || !hasValidExportName) {
            const sectionId = hasValidId ? entry.id : '<unknown>';
            console.warn(`[AIO-Clipboard] Ignoring invalid Recently Used order entry '${sectionId}'. Required fields: id, modulePath, exportName.`);
            return;
        }

        recentlyUsedOrderRegistry.push({ ...entry });
    });
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
export function getRecentlyUsedSectionById(sectionId) {
    return recentlyUsedRegistry.get(sectionId) || null;
}

/**
 * Returns the currently registered section order.
 *
 * @returns {Array<string>} Ordered section ids.
 */
export function getRecentlyUsedSectionOrder() {
    return recentlyUsedOrderRegistry.map((entry) => entry.id);
}

/**
 * Returns ordered section definitions that are currently available.
 *
 * @returns {Array<object>} Ordered section definitions.
 */
export function getRecentlyUsedOrderedSections() {
    return recentlyUsedOrderRegistry.map((entry) => getRecentlyUsedSectionById(entry.id)).filter(Boolean);
}
