/**
 * Cloudflare Worker — All-in-One Clipboard API Proxy
 *
 * A route-based, multi-provider proxy that injects secret API keys
 * when the client does not provide one.
 *
 * Routes: /<provider>/<endpoint>...
 *   e.g. /example/search?q=foo  →  https://api.example.com/v1/search?q=foo&key=SECRET
 */

const PROVIDERS = {
    klipy: {
        base: 'https://api.klipy.com/v2',
        secretName: 'KLIPY_API_KEY',
        keyParam: 'key',
    },
};

// Per-IP rate limiting in-memory, which resets on cold start
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 60;
const ipRequestLog = new Map();

/**
 * Check whether an IP has exceeded the rate limit.
 * @param {string} ip
 * @returns {boolean} true if the request should be blocked
 */
function isRateLimited(ip) {
    const now = Date.now();
    let entry = ipRequestLog.get(ip);

    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        entry = { windowStart: now, count: 1 };
        ipRequestLog.set(ip, entry);
        return false;
    }

    entry.count++;
    return entry.count > RATE_LIMIT_MAX_REQUESTS;
}

export default {
    async fetch(request, env) {
        // Only allow GET requests
        if (request.method !== 'GET') {
            return new Response('Method Not Allowed', { status: 405 });
        }

        // Rate limit by client IP
        const clientIp = request.headers.get('cf-connecting-ip') || 'unknown';
        if (isRateLimited(clientIp)) {
            return new Response('Too Many Requests', { status: 429 });
        }

        const url = new URL(request.url);
        const pathParts = url.pathname.split('/').filter(Boolean);

        // Require at least a provider segment
        if (pathParts.length === 0) {
            return new Response(JSON.stringify({ error: 'Provider not specified' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        // Resolve provider from first path segment
        const providerName = pathParts[0];
        const provider = PROVIDERS[providerName];

        if (!provider) {
            return new Response(JSON.stringify({ error: `Unknown provider: ${providerName}` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        // Build upstream URL: strip the provider prefix from the path
        const upstreamPath = '/' + pathParts.slice(1).join('/');
        const targetUrl = new URL(provider.base + upstreamPath);

        // Copy query parameters from the incoming request
        url.searchParams.forEach((value, key) => {
            targetUrl.searchParams.append(key, value);
        });

        // Inject the secret API key when the client did not supply one
        if (!targetUrl.searchParams.has(provider.keyParam)) {
            const secretKey = env[provider.secretName];
            if (!secretKey) {
                return new Response(JSON.stringify({ error: 'Server configuration error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
            }
            targetUrl.searchParams.append(provider.keyParam, secretKey);
        }

        // Forward the request to the upstream API
        const response = await fetch(targetUrl.toString());

        // Return a sanitized response with controlled headers
        return new Response(response.body, {
            status: response.status,
            headers: {
                'Content-Type': response.headers.get('Content-Type') || 'application/json',
                'Cache-Control': 'public, max-age=300',
            },
        });
    },
};
