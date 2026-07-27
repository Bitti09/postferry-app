/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';
import { precacheAndRoute } from 'workbox-precaching';

// Disable Workbox dev logs
// @ts-expect-error - injected global
self.__WB_DISABLE_DEV_LOGS = true;

// Required by @vite-pwa/sveltekit's injectManifest strategy
// @ts-expect-error - workbox injects this at build time
precacheAndRoute(self.__WB_MANIFEST);

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `cache-${version}`;

const ASSETS = [
	...build, // the app itself
	...files  // everything in `static`
];

sw.addEventListener('install', (event) => {
	// Create a new cache and add all files to it
	async function addFilesToCache() {
		const cache = await caches.open(CACHE);
		await cache.addAll(ASSETS);
	}

	event.waitUntil(addFilesToCache());
});

sw.addEventListener('activate', (event) => {
	// Remove previous cached data from disk
	async function deleteOldCaches() {
		for (const key of await caches.keys()) {
			if (key !== CACHE && key !== 'tmblr-media') await caches.delete(key);
		}
	}

	event.waitUntil(deleteOldCaches());
});

sw.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') return;

	const url = new URL(event.request.url);
	// Only handle http and https requests (ignore chrome-extension, data, etc)
	if (!url.protocol.startsWith('http')) return;

	// Cross-origin: pass straight through. Do NOT call event.respondWith —
	// letting the browser handle the request avoids CORS/Response-coercion bugs
	// and avoids polluting the SW cache with opaque or partially-trusted responses.
	if (url.origin !== self.location.origin) return;

	async function respond() {
		const cache = await caches.open(CACHE);

		// `build`/`files` can always be served from the cache
		if (ASSETS.includes(url.pathname)) {
			const cachedResponse = await cache.match(url.pathname);
			if (cachedResponse) return cachedResponse;
		}
		// Handle media proxy by checking the offline media cache directly!
		if (url.pathname.startsWith('/api/media/proxy')) {
			const targetUrl = url.searchParams.get('url');
			if (targetUrl) {
				const mediaCache = await caches.open('tmblr-media');
				const cached = await mediaCache.match(targetUrl);
				if (cached) return cached;
				
				try {
					return await fetch(event.request);
				} catch {
					return new Response('', { status: 504, statusText: 'Offline' });
				}
			}
		}

		// API responses are stored separately in IndexedDB (see `$lib/stores/db`).
		// The SW has no TTL/invalidation story for them, so don't cache them here —
		// just go straight to the network and let the offline UI handle the miss.
		if (url.pathname.startsWith('/api/')) {
			try {
				return await fetch(event.request);
			} catch {
				return new Response('', { status: 504, statusText: 'Offline' });
			}
		}

		// for everything else, try the network first, but
		// fall back to the cache if we're offline
		try {
			const response = await fetch(event.request);

			if (response.status === 200) {
				cache.put(event.request, response.clone());
			}

			return response;
		} catch {
			// fallback to cache if offline!
			const cachedResponse = await cache.match(event.request);
			if (cachedResponse) return cachedResponse;
			
			// if navigation request, fallback to root page
			if (event.request.mode === 'navigate') {
				const navFallback = await cache.match('/');
				if (navFallback) return navFallback;
			}

			// Cache miss + network failure: return a synthetic 504 rather than undefined
			// (cache.match() can return undefined, which would throw "Failed to convert value to 'Response'").
			return new Response('', { status: 504, statusText: 'Offline' });
		}
	}

	event.respondWith(respond() as Promise<Response>);
});
// Helper to parse Tumblr media URLs into a base identity and a size
function parseTumblrMediaUrl(url: string) {
	// Matches patterns like: .../tumblr_hash_1280.jpg
	// We want to capture the base URL without the size suffix, the size integer, and the extension
	const match = url.match(/^(.*?_)(?:(\d+)|([a-zA-Z0-9]+))\.([a-zA-Z0-9]+)$/);
	if (!match) return null;
	
	return {
		base: match[1], // e.g. "https://.../tumblr_hash_"
		size: parseInt(match[2] || '0', 10), // e.g. 1280
		ext: match[4]
	};
}

sw.addEventListener('message', (event) => {
	if (event.data && event.data.type === 'CACHE_MEDIA') {
		const targetUrl = event.data.url;
		if (!targetUrl) return;

		event.waitUntil(
			(async () => {
				const broadcast = async (msg: any) => {
					const allClients = await sw.clients.matchAll();
					for (const client of allClients) {
						client.postMessage(msg);
					}
				};

				try {
					const mediaCache = await caches.open('tmblr-media');
					const existing = await mediaCache.match(targetUrl);
					if (existing) {
						const type = existing.headers.get('content-type') || '';
						await broadcast({ type: 'MEDIA_CACHED', url: targetUrl, mimeType: type });
						return;
					}

					const parsedTarget = parseTumblrMediaUrl(targetUrl);
					if (parsedTarget && parsedTarget.size > 0) {
						// Scan existing cache keys to find lower-quality versions of the same asset
						const keys = await mediaCache.keys();
						for (const request of keys) {
							const cachedUrl = request.url;
							const parsedCached = parseTumblrMediaUrl(cachedUrl);
							
							if (parsedCached && 
								parsedCached.base === parsedTarget.base && 
								parsedCached.ext === parsedTarget.ext && 
								parsedCached.size < parsedTarget.size) {
								console.log(`[SW] Upgrading cache: removing lower quality ${cachedUrl} in favor of ${targetUrl}`);
								await mediaCache.delete(request);
							}
						}
					}

					let response = await fetch(`/api/media/proxy?url=${encodeURIComponent(targetUrl)}`);
					if (!response.ok) {
						response = await fetch(targetUrl);
					}

					if (response.ok) {
						const type = response.headers.get('content-type') || '';
						await mediaCache.put(targetUrl, response.clone());
						await broadcast({ type: 'MEDIA_CACHED', url: targetUrl, mimeType: type });
					} else {
						await broadcast({ type: 'MEDIA_CACHE_ERROR', url: targetUrl, error: `Status ${response.status}` });
					}
				} catch (err) {
					await broadcast({ type: 'MEDIA_CACHE_ERROR', url: targetUrl, error: String(err) });
				}
			})()
		);
	}
});
