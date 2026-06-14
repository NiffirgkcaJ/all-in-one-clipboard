const SEARCH_HANDOFF_TTL_MS = 10000;

let _providersById = null;
let _providerIdByTab = null;
let _subscribers = null;
let _pendingHandoff = null;

/**
 * Normalizes a value for use as a lookup key.
 *
 * @param {string} value Raw value.
 * @returns {string} Normalized key.
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
 * Returns the provider registry, creating it on first use.
 *
 * @returns {Map<string, object>} Search providers keyed by normalized provider id.
 */
function getProvidersById() {
    if (!_providersById) {
        _providersById = new Map();
    }
    return _providersById;
}

/**
 * Returns the tab-to-provider registry, creating it on first use.
 *
 * @returns {Map<string, string>} Provider ids keyed by normalized tab name.
 */
function getProviderIdByTab() {
    if (!_providerIdByTab) {
        _providerIdByTab = new Map();
    }
    return _providerIdByTab;
}

/**
 * Returns the Search Hub subscriber set, creating it on first use.
 *
 * @returns {Set<Function>} Registered Search Hub listeners.
 */
function getSubscribers() {
    if (!_subscribers) {
        _subscribers = new Set();
    }
    return _subscribers;
}

/**
 * Notifies subscribers of Search Hub events.
 *
 * @param {string} event Event name.
 * @param {object} payload Event payload.
 */
function notifySearchHubSubscribers(event, payload) {
    getSubscribers().forEach((listener) => {
        try {
            listener({ event, payload });
        } catch {
            // No action needed for subscriber errors.
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
 * Checks whether a handoff is expired based on its timestamp.
 *
 * @param {object} handoff Handoff object.
 * @returns {boolean} True if the handoff is expired.
 */
function isHandoffExpired(handoff) {
    return !handoff || typeof handoff.expiresAt !== 'number' || Date.now() > handoff.expiresAt;
}

/**
 * Retrieves the current valid handoff if available.
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
    return tabKey ? getProviderIdByTab().get(tabKey) || null : null;
}

/**
 * Resolves a provider by its ID.
 *
 * @param {string} providerId Provider ID.
 * @returns {object|null} Provider descriptor or null if not found.
 */
function resolveProvider(providerId) {
    const normalizedProviderId = normalizeLookupKey(providerId);
    return normalizedProviderId ? getProvidersById().get(normalizedProviderId) || null : null;
}

/**
 * Subscribes to Search Hub lifecycle events.
 *
 * @param {Function} listener Event callback.
 * @returns {Function} Unsubscribe function.
 */
export function subscribeSearchHub(listener) {
    if (!listener) {
        return () => {};
    }

    getSubscribers().add(listener);

    return () => {
        getSubscribers().delete(listener);
    };
}

/**
 * Registers or updates a search provider.
 *
 * @param {object} provider Provider descriptor.
 * @param {string} provider.id Unique provider ID.
 * @param {Array<string>} [provider.targetTabs] Supported main tab names.
 * @param {Function} [provider.search] Optional async search function.
 * @param {Function} [provider.applyToTab] Optional handoff application hook.
 * @param {Function} [provider.clearOnTab] Optional search clear hook.
 * @returns {boolean} True if registration succeeded.
 */
export function registerSearchProvider(provider) {
    const providerId = normalizeLookupKey(provider?.id);
    if (!providerId) {
        return false;
    }

    const targetTabs = Array.isArray(provider?.targetTabs) ? provider.targetTabs.filter((tabName) => typeof tabName === 'string' && tabName.trim().length > 0) : [];

    getProvidersById().set(providerId, {
        id: providerId,
        targetTabs,
        search: provider?.search || null,
        applyToTab: provider?.applyToTab || null,
        clearOnTab: provider?.clearOnTab || null,
    });

    targetTabs.forEach((tabName) => {
        const tabKey = normalizeLookupKey(tabName);
        if (tabKey) {
            getProviderIdByTab().set(tabKey, providerId);
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
    const providersById = getProvidersById();
    if (!normalizedProviderId || !providersById.has(normalizedProviderId)) {
        return;
    }

    providersById.delete(normalizedProviderId);

    for (const [tabKey, mappedProviderId] of getProviderIdByTab().entries()) {
        if (mappedProviderId === normalizedProviderId) {
            getProviderIdByTab().delete(tabKey);
        }
    }

    notifySearchHubSubscribers('provider-unregistered', {
        providerId: normalizedProviderId,
    });
}

/**
 * Executes a search through a registered provider.
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

    if (!provider?.search || !normalizedQuery) {
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
 * Queues a one-shot query handoff for a target tab.
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
 * Applies and consumes a pending handoff for a target tab.
 *
 * @param {object} params Apply context.
 * @param {string} params.targetTab Target tab name.
 * @param {object} params.tabActor Target tab actor.
 * @returns {Promise<boolean>} True if the search was applied.
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
    if (provider?.applyToTab) {
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

    if (!applied && tabActor?.applyExternalSearch) {
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
 * Clears active search state on a tab using its provider.
 *
 * @param {object} params Clear context.
 * @param {string} params.targetTab Target tab name.
 * @param {object} params.tabActor Target tab actor.
 * @returns {Promise<boolean>} True if the clear action executed.
 */
export async function clearSearchOnTab({ targetTab, tabActor } = {}) {
    const resolvedProviderId = resolveProviderIdByTab(targetTab);
    const provider = resolveProvider(resolvedProviderId);

    if (provider?.clearOnTab) {
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

    if (tabActor?.clearExternalSearch) {
        try {
            return Boolean(await tabActor.clearExternalSearch());
        } catch {
            return false;
        }
    }

    return false;
}

/**
 * Clears all search hub state during extension shutdown.
 *
 * @returns {void}
 */
export function resetSearchHub() {
    _providersById?.clear();
    _providerIdByTab?.clear();
    _subscribers?.clear();
    _pendingHandoff = null;
    _providersById = null;
    _providerIdByTab = null;
    _subscribers = null;
}
