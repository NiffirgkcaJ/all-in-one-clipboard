import { RecentlyUsedOrder } from '../definitions/recentlyUsedOrder.js';

const recentlyUsedRegistry = new Map();
const recentlyUsedOrderRegistry = [];
let initializeRecentlyUsedRegistryPromise = null;

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

/**
 * Registers a single section definition by id.
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
 * @param {Array<string|object>} sectionIds Ordered section ids or entries.
 */
export function registerRecentlyUsedOrder(sectionIds = []) {
    initializeRecentlyUsedRegistryPromise = null;
    recentlyUsedOrderRegistry.length = 0;

    sectionIds.forEach((entry) => {
        if (typeof entry === 'string' && entry.length > 0) {
            recentlyUsedOrderRegistry.push({ id: entry });
            return;
        }

        if (entry?.id && typeof entry.id === 'string') {
            recentlyUsedOrderRegistry.push(entry);
        }
    });
}

/**
 * Returns a section definition by id.
 *
 * @param {string} sectionId Section id.
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
