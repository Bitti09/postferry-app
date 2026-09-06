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

	// Take control of open pages immediately on install/update — without
	// this, the first page load after registration has no controller and
	// media caching must wait for a reload.
	event.waitUntil(
		(async () => {
			await deleteOldCaches();
			await sw.clients.claim();
		})()
	);
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
				const mediaCache = await caches.open(MEDIA_CACHE);
				const cached = await mediaCache.match(targetUrl);
				if (cached) return cached;

				// Range requests (video seeking) can't be satisfied from a full
				// cached body — stream them through the proxy, uncached.
				// Videos: serve from OPFS (byte-accurate Range support), stream
				// misses to disk. Range requests never hit Cache Storage.
				const rangeHeader = event.request.headers.get('range');
				if (isVideoUrl(targetUrl)) {
					const opfsHit = await serveVideoFromOpfs(targetUrl, rangeHeader);
					if (opfsHit) return opfsHit;
					try {
						const upstream = rangeHeader
							? { response: await fetch(event.request), status: null as number | null }
							: await fetchMediaWithFallback(targetUrl, event.request);
						const res = upstream.response;
						if (res && res.ok && !rangeHeader) {
							// Persist the whole video to OPFS, respond from disk so the
							// client sees a stable non-streaming body.
							const stored = await writeVideoToOpfs(targetUrl, res.clone());
							broadcastToClients({ type: 'MEDIA_CACHED', url: targetUrl, mimeType: res.headers.get('content-type') || 'video/mp4' });
							if (stored) {
								const fromDisk = await serveVideoFromOpfs(targetUrl, null);
								if (fromDisk) return fromDisk;
							}
						}
						if (res) return res;
					} catch {
						return new Response('', { status: 504, statusText: 'Offline' });
					}
					return new Response('', { status: 504, statusText: 'Offline' });
				}

				// Range requests for non-video content can't be satisfied from a
				// full cached body — stream them through the proxy, uncached.
				if (rangeHeader) {
					try {
						return await fetch(event.request);
					} catch {
						return new Response('', { status: 504, statusText: 'Offline' });
					}
				}

				// Cache miss: fetch the CDN URL directly (Tumblr media hosts send
				// ACAO: *, so this is a readable cors response) and persist it, so
				// everything viewed once is offline. Proxy only as fallback.
				const { response: res, status } = await fetchMediaWithFallback(targetUrl, event.request);
				if (res && res.ok) {
					const type = res.headers.get('content-type') || '';
					await mediaCache.put(targetUrl, res.clone());
					broadcastToClients({ type: 'MEDIA_CACHED', url: targetUrl, mimeType: type });
					return res;
				}
				// Propagate the real upstream status (404/403/…) — a dead asset
				// must not masquerade as "Offline".
				if (res) return res;
				return new Response('', {
					status: status ?? 504,
					statusText: status ? String(status) : 'Offline'
				});
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
// ─── Tumblr media URL canonicalization ──────────────────────────────────────
const MEDIA_CACHE = 'tmblr-media';

/**
 * Parse a Tumblr CDN media URL into a size-independent identity + dimensions.
 * Handles both real shapes:
 *   https://64.media.tumblr.com/<a>/<hash>/s1280x1920/<b>.jpg   (segment form)
 *   https://64.media.tumblr.com/.../tumblr_<hash>_1280.jpg      (legacy suffix)
 * Returns null for URLs with no size encoding (avatars, embeds).
 */
function parseTumblrMediaUrl(url: string) {
	const clean = url.split('#')[0].split('?')[0];
	const seg = clean.match(/^(.*\/)s(\d+)x(\d+)[a-zA-Z0-9_]*(\/[^/]+)\.([a-zA-Z0-9]+)$/);
	if (seg) {
		return {
			base: `${seg[1]}${seg[4]}.${seg[5]}`,
			width: parseInt(seg[2], 10),
			height: parseInt(seg[3], 10),
			area: parseInt(seg[2], 10) * parseInt(seg[3], 10),
			ext: seg[5]
		};
	}
	const suffix = clean.match(/^(.*?_)(\d+)\.([a-zA-Z0-9]+)$/);
	if (suffix) {
		const width = parseInt(suffix[2], 10);
		return {
			base: `${suffix[1]}${suffix[3]}`,
			width,
			height: 0,
			area: width,
			ext: suffix[3]
		};
	}
	return null;
}

/**
 * Fetch media with direct-CDN first (readable cors response thanks to ACAO:*),
 * falling back to the same-origin Node proxy for hosts/content that fails.
 * `rangeRequest` is the original page request when Range streaming is needed.
 */
async function fetchMediaWithFallback(
	targetUrl: string,
	rangeRequest?: Request
): Promise<{ response: Response | null; status: number | null }> {
	if (!rangeRequest) {
		try {
			const direct = await fetch(targetUrl, { credentials: 'omit' });
			if (direct.ok) return { response: direct, status: null };
			// Direct fetch got a definitive upstream answer (404/403/…):
			// surface it instead of trying the proxy, which would just get
			// the same status and double the traffic.
			return { response: direct, status: direct.status };
		} catch {
			// network failure — fall through to proxy
		}
	}
	try {
		const proxied = await fetch(rangeRequest ?? `/api/media/proxy?url=${encodeURIComponent(targetUrl)}`);
		return proxied.ok
			? { response: proxied, status: null }
			: { response: proxied, status: proxied.status };
	} catch {
		return { response: null, status: null };
	}
}

async function broadcastToClients(msg: Record<string, unknown>): Promise<void> {
	const allClients = await sw.clients.matchAll();
	for (const client of allClients) {
		client.postMessage(msg);
	}
}

// ─── OPFS video storage ─────────────────────────────────────────────────────
// Videos go to the Origin Private File System instead of Cache Storage:
// streaming writes, cheap size reads, and byte-accurate Range serving.
// createSyncAccessHandle is service-worker-only, which is where all writes
// happen anyway.

const VIDEO_URL_RE = /\.(mp4|webm)(?:[?#]|$)/i;

function videoFileName(url: string): string {
	const parsed = parseTumblrMediaUrl(url);
	const identity = parsed ? parsed.base : url;
	// File names: lowercase alphanumeric + underscores only.
	const safe = identity.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
	return `v_${safe}`.slice(0, 240);
}

async function videoFileHandle(url: string, create: boolean): Promise<FileSystemFileHandle | null> {
	if (!self.navigator.storage?.getDirectory) return null;
	try {
		const root = await self.navigator.storage.getDirectory();
		return await root.getFileHandle(videoFileName(url), { create });
	} catch {
		return null;
	}
}

async function writeVideoToOpfs(url: string, response: Response): Promise<boolean> {
	const handle = await videoFileHandle(url, true);
	if (!handle || !response.body) return false;
	// createSyncAccessHandle is the fast path but is not exposed on
	// FileSystemFileHandle in every runtime (user hit "not a function").
	// createWritable streams the response body to OPFS everywhere the
	// bucket/OPFS APIs exist — same durability, slightly slower.
	if (typeof handle.createSyncAccessHandle === 'function') {
		const access = await handle.createSyncAccessHandle();
		try {
			const buffer = await response.arrayBuffer();
			access.truncate(0);
			access.write(buffer, { at: 0 });
			access.flush();
		} finally {
			access.close();
		}
		return true;
	}
	try {
		const writable = await handle.createWritable();
		await response.body.pipeTo(writable);
		return true;
	} catch (e) {
		console.error('[SW] OPFS write failed', e);
		return false;
	}
}

/**
 * Serve a video from OPFS. Honors Range requests with 206 slicing; a request
 * without Range gets the whole file as 200.
 */
async function serveVideoFromOpfs(url: string, rangeHeader: string | null): Promise<Response | null> {
	const handle = await videoFileHandle(url, false);
	if (!handle) return null;
	let file: File;
	try {
		file = await handle.getFile();
	} catch {
		return null;
	}
	if (file.size === 0) return null;

	const contentType = url.toLowerCase().endsWith('.webm') ? 'video/webm' : 'video/mp4';
	const range = parseRangeHeader(rangeHeader, file.size);
	if (range) {
		const slice = file.slice(range.start, range.end + 1);
		return new Response(slice, {
			status: 206,
			headers: {
				'Content-Type': contentType,
				'Content-Length': String(range.end - range.start + 1),
				'Content-Range': `bytes ${range.start}-${range.end}/${file.size}`,
				'Accept-Ranges': 'bytes'
			}
		});
	}
	return new Response(file, {
		status: 200,
		headers: {
			'Content-Type': contentType,
			'Content-Length': String(file.size),
			'Accept-Ranges': 'bytes'
		}
	});
}

function parseRangeHeader(header: string | null, size: number): { start: number; end: number } | null {
	if (!header) return null;
	const match = header.match(/^bytes=(\d*)-(\d*)$/);
	if (!match) return null;
	const [, rawStart, rawEnd] = match;
	let start: number;
	let end: number;
	if (rawStart === '') {
		// suffix range: last N bytes
		const n = parseInt(rawEnd, 10);
		if (!Number.isFinite(n) || n <= 0) return null;
		start = Math.max(0, size - n);
		end = size - 1;
	} else {
		start = parseInt(rawStart, 10);
		end = rawEnd === '' ? size - 1 : Math.min(parseInt(rawEnd, 10), size - 1);
	}
	if (!Number.isFinite(start) || start > end || start >= size) return null;
	return { start, end };
}

async function deleteVideoFromOpfs(urls: string[]): Promise<void> {
	if (!self.navigator.storage?.getDirectory) return;
	try {
		const root = await self.navigator.storage.getDirectory();
		for (const url of urls) {
			try {
				await root.removeEntry(videoFileName(url));
			} catch {
				// already gone
			}
		}
	} catch {
		// OPFS unavailable
	}
}

function isVideoUrl(url: string): boolean {
	return VIDEO_URL_RE.test(url);
}

sw.addEventListener('message', (event) => {
	const data = event.data as { type?: string; url?: string } | null;
	if (!data || data.type !== 'CACHE_MEDIA' || !data.url) return;
	const targetUrl = data.url;

	event.waitUntil(
		(async () => {
			try {
				const mediaCache = await caches.open(MEDIA_CACHE);
				const existing = await mediaCache.match(targetUrl);
				if (existing) {
					const type = existing.headers.get('content-type') || '';
					await broadcastToClients({ type: 'MEDIA_CACHED', url: targetUrl, mimeType: type });
					return;
				}

				// Upgrade handling: ask the page to resolve lower-res renditions of
				// the same asset from the IDB index (O(index) instead of an O(keys)
				// scan over a 20k-entry cache). The page replies with DROP_MEDIA.
				const parsedTarget = parseTumblrMediaUrl(targetUrl);
				if (parsedTarget && parsedTarget.area > 0) {
					await broadcastToClients({
						type: 'RESOLVE_UPGRADE',
						url: targetUrl,
						base: parsedTarget.base,
						ext: parsedTarget.ext,
						area: parsedTarget.area
					});
				}

				const { response, status } = await fetchMediaWithFallback(targetUrl);
				if (response && response.ok) {
					const type = response.headers.get('content-type') || '';
					if (isVideoUrl(targetUrl)) {
						const stored = await writeVideoToOpfs(targetUrl, response);
						if (stored) {
							await broadcastToClients({ type: 'MEDIA_CACHED', url: targetUrl, mimeType: type });
						} else {
							// OPFS unavailable: fall back to Cache Storage.
							await mediaCache.put(targetUrl, response.clone());
							await broadcastToClients({ type: 'MEDIA_CACHED', url: targetUrl, mimeType: type });
						}
					} else {
						await mediaCache.put(targetUrl, response.clone());
						await broadcastToClients({ type: 'MEDIA_CACHED', url: targetUrl, mimeType: type });
					}
				} else {
					await broadcastToClients({
						type: 'MEDIA_CACHE_ERROR',
						url: targetUrl,
						error: status ? `HTTP ${status}` : 'unreachable'
					});
				}
			} catch (err) {
				await broadcastToClients({ type: 'MEDIA_CACHE_ERROR', url: targetUrl, error: String(err) });
			}
		})()
	);
});

// Page-driven eviction of superseded lower-res renditions.
sw.addEventListener('message', (event) => {
	const data = event.data as { type?: string; urls?: string[] } | null;
	if (!data || data.type !== 'DROP_MEDIA' || !Array.isArray(data.urls)) return;
	event.waitUntil(
		(async () => {
			const mediaCache = await caches.open(MEDIA_CACHE);
			const urls = data.urls ?? [];
			for (const url of urls) {
				await mediaCache.delete(url);
				if (isVideoUrl(url)) await deleteVideoFromOpfs([url]);
			}
		})()
	);
});
