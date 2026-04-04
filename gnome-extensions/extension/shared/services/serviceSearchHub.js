const SEARCH_HANDOFF_TTL_MS = 10000;

const _providersById = new Map();
const _providerIdByTab = new Map();
const _subscribers = new Set();
let _pendingHandoff = null;

/**
 * Shared Search Hub service for cross-tab search provider registration and query handoff.
 *
 * This service allows features to register search providers that can be targeted to specific tabs in the Search UI.
 * It also enables queuing one-shot search handoffs that can be consumed by the target tab, facilitating cross-tab search continuity.
 */
function normalizeLookupKey(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Normalizes a search query by trimming whitespace.
 *
 * @param {string} value Raw query string.
 * @returns {string} Normalized query.
 */
function normalizeQuery(value) {
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * Notifies subscribers of Search Hub events.
 *
 * @param {string} event Event name.
 * @param {object} payload Event payload.
 */
function notifySearchHubSubscribers(event, payload) {
    _subscribers.forEach((listener) => {
        try {
            listener?.({ event, payload });
        } catch {
            // Ignore subscriber errors so one listener cannot break the hub.
        }
    });
}

/**
 * Clears the pending search handoff and notifies subscribers.
 *
 * @param {string} reason Reason for clearing the handoff.
 */
function clearSearchHandoffInternal(reason = 'cleared') {
    if (!_pendingHandoff) {
        return;
    }

    const previousHandoff = _pendingHandoff;
    _pendingHandoff = null;
    notifySearchHubSubscribers('search-handoff-cleared', {
        reason,
        handoff: previousHandoff,
    });
}

/**
 * Checks whether a handoff is expired based on its expiresAt timestamp.
 *
 * @param {object} handoff Handoff object.
 * @returns {boolean} True when the handoff is expired.
 */
function isHandoffExpired(handoff) {
    return !handoff || typeof handoff.expiresAt !== 'number' || Date.now() > handoff.expiresAt;
}

/**
 * Retrieves the current valid handoff if available, otherwise returns null.
 *
 * @returns {object|null} Valid handoff or null.
 */
function getValidHandoff() {
    if (!_pendingHandoff) {
        return null;
    }

    if (isHandoffExpired(_pendingHandoff)) {
        clearSearchHandoffInternal('expired');
        return null;
    }

    return _pendingHandoff;
}

/**
 * Resolves the provider ID associated with a given tab name.
 *
 * @param {string} tabName Tab name.
 * @returns {string|null} Provider ID or null if not found.
 */
function resolveProviderIdByTab(tabName) {
    const tabKey = normalizeLookupKey(tabName);
    return tabKey ? _providerIdByTab.get(tabKey) || null : null;
}

/**
 * Resolves a provider by its ID.
 *
 * @param {string} providerId Provider ID.
 * @returns {object|null} Provider descriptor or null if not found.
 */
function resolveProvider(providerId) {
    const normalizedProviderId = normalizeLookupKey(providerId);
    return normalizedProviderId ? _providersById.get(normalizedProviderId) || null : null;
}

/**
 * Subscribes to Search Hub lifecycle events.
 *
 * @param {Function} listener Event callback.
 * @returns {Function} Unsubscribe function.
 */
export function subscribeSearchHub(listener) {
    if (typeof listener !== 'function') {
        return () => {};
    }

    _subscribers.add(listener);

    return () => {
        _subscribers.delete(listener);
    };
}

/**
 * Registers or updates a search provider.
 *
 * @param {object} provider Provider descriptor.
 * @param {string} provider.id Unique provider ID.
 * @param {Array<string>} [provider.targetTabs] Main tab names supported by provider.
 * @param {Function} [provider.search] Optional async search function.
 * @param {Function} [provider.applyToTab] Optional tab handoff application hook.
 * @param {Function} [provider.clearOnTab] Optional tab search clear hook.
 * @returns {boolean} True when registration succeeds.
 */
export function registerSearchProvider(provider) {
    const providerId = normalizeLookupKey(provider?.id);
    if (!providerId) {
        return false;
    }

    const targetTabs = Array.isArray(provider?.targetTabs) ? provider.targetTabs.filter((tabName) => typeof tabName === 'string' && tabName.trim().length > 0) : [];

    _providersById.set(providerId, {
        id: providerId,
        targetTabs,
        search: typeof provider?.search === 'function' ? provider.search : null,
        applyToTab: typeof provider?.applyToTab === 'function' ? provider.applyToTab : null,
        clearOnTab: typeof provider?.clearOnTab === 'function' ? provider.clearOnTab : null,
    });

    targetTabs.forEach((tabName) => {
        const tabKey = normalizeLookupKey(tabName);
        if (tabKey) {
            _providerIdByTab.set(tabKey, providerId);
        }
    });

    notifySearchHubSubscribers('provider-registered', {
        providerId,
        targetTabs,
    });

    return true;
}

/**
 * Unregisters a search provider by ID.
 *
 * @param {string} providerId Provider ID.
 */
export function unregisterSearchProvider(providerId) {
    const normalizedProviderId = normalizeLookupKey(providerId);
    if (!normalizedProviderId || !_providersById.has(normalizedProviderId)) {
        return;
    }

    _providersById.delete(normalizedProviderId);

    for (const [tabKey, mappedProviderId] of _providerIdByTab.entries()) {
        if (mappedProviderId === normalizedProviderId) {
            _providerIdByTab.delete(tabKey);
        }
    }

    notifySearchHubSubscribers('provider-unregistered', {
        providerId: normalizedProviderId,
    });
}

/**
 * Executes provider search if available.
 *
 * @param {string} providerId Provider ID.
 * @param {object} params Search parameters.
 * @param {string} params.query Search query.
 * @param {object} [params.context] Optional caller context.
 * @returns {Promise<Array<object>>} Search results.
 */
export async function searchViaProvider(providerId, { query, context } = {}) {
    const provider = resolveProvider(providerId);
    const normalizedQuery = normalizeQuery(query);

    if (!provider || typeof provider.search !== 'function' || !normalizedQuery) {
        return [];
    }

    try {
        const items = await provider.search({ query: normalizedQuery, context: context || {} });
        return Array.isArray(items) ? items : [];
    } catch {
        return [];
    }
}

/**
 * Queues a one-shot query handoff to be consumed by a target tab.
 *
 * @param {object} params Handoff payload.
 * @param {string} params.targetTab Target tab name.
 * @param {string} params.query Query to apply.
 * @param {string} [params.sourceTab] Source tab identifier.
 * @param {string} [params.sourceSection] Source section identifier.
 * @param {string} [params.providerId] Optional provider hint.
 * @param {object} [params.metadata] Additional context.
 */
export function queueSearchHandoff({ targetTab, query, sourceTab = '', sourceSection = '', providerId = '', metadata = null } = {}) {
    const normalizedTargetTab = normalizeQuery(targetTab);
    const normalizedQuery = normalizeQuery(query);

    if (!normalizedTargetTab || !normalizedQuery) {
        clearSearchHandoffInternal('empty-handoff');
        return;
    }

    _pendingHandoff = {
        targetTab: normalizedTargetTab,
        targetTabKey: normalizeLookupKey(normalizedTargetTab),
        query: normalizedQuery,
        sourceTab: normalizeQuery(sourceTab),
        sourceSection: normalizeQuery(sourceSection),
        providerId: normalizeLookupKey(providerId),
        metadata,
        createdAt: Date.now(),
        expiresAt: Date.now() + SEARCH_HANDOFF_TTL_MS,
    };

    notifySearchHubSubscribers('search-handoff-queued', {
        handoff: _pendingHandoff,
    });
}

/**
 * Applies and consumes a pending handoff for a tab actor.
 *
 * @param {object} params Apply context.
 * @param {string} params.targetTab Target tab name.
 * @param {object} params.tabActor Target tab actor.
 * @returns {Promise<boolean>} True when search was applied.
 */
export async function applySearchHandoffToTab({ targetTab, tabActor } = {}) {
    const handoff = getValidHandoff();
    if (!handoff) {
        return false;
    }

    const targetTabKey = normalizeLookupKey(targetTab);
    if (!targetTabKey || targetTabKey !== handoff.targetTabKey) {
        return false;
    }

    _pendingHandoff = null;

    let provider = resolveProvider(handoff.providerId);
    if (!provider) {
        provider = resolveProvider(resolveProviderIdByTab(targetTab));
    }

    let applied = false;
    if (provider && typeof provider.applyToTab === 'function') {
        try {
            applied = Boolean(
                await provider.applyToTab({
                    query: handoff.query,
                    handoff,
                    tabActor,
                }),
            );
        } catch {
            applied = false;
        }
    }

    if (!applied && tabActor && typeof tabActor.applyExternalSearch === 'function') {
        try {
            applied = Boolean(await tabActor.applyExternalSearch(handoff.query, handoff));
        } catch {
            applied = false;
        }
    }

    notifySearchHubSubscribers('search-handoff-consumed', {
        handoff,
        applied,
    });

    return applied;
}

/**
 * Clears active search state on a tab using its provider, when available.
 *
 * @param {object} params Clear context.
 * @param {string} params.targetTab Target tab name.
 * @param {object} params.tabActor Target tab actor.
 * @returns {Promise<boolean>} True when clear action executed.
 */
export async function clearSearchOnTab({ targetTab, tabActor } = {}) {
    const resolvedProviderId = resolveProviderIdByTab(targetTab);
    const provider = resolveProvider(resolvedProviderId);

    if (provider && typeof provider.clearOnTab === 'function') {
        try {
            return Boolean(
                await provider.clearOnTab({
                    tabActor,
                    targetTab: normalizeQuery(targetTab),
                }),
            );
        } catch {
            return false;
        }
    }

    if (tabActor && typeof tabActor.clearExternalSearch === 'function') {
        try {
            return Boolean(await tabActor.clearExternalSearch());
        } catch {
            return false;
        }
    }

    return false;
}
