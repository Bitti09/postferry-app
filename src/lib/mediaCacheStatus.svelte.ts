import { browser } from '$app/environment';

const CACHE_NAME = 'tmblr-media';

/**
 * Reactive registry of every media URL currently present in the `tmblr-media`
 * offline cache. Single source of truth for cache-status UI (PostCard badges,
 * feed pre-checks) so pages no longer rebuild per-page Set/array copies.
 *
 * Svelte 5 deeply proxies this Set: reading `has(url)` inside a `$derived` or
 * `$effect` tracks only that specific entry, so one URL being cached only
 * invalidates the components actually looking at it — not every visible card.
 * NOTE: must stay a `.svelte.ts` file — runes are invalid in plain `.ts`.
 */
export const cachedMediaUrls: Set<string> = $state(new Set());

let initStarted = false;

/**
 * Warm the registry from the Cache API on first use. Streams `cache.keys()`
 * so a 20k-entry cache is enumerated without buffering the whole list.
 * Idempotent — safe to call from every page.
 */
export function initMediaCacheStatus(): void {
	if (!browser || initStarted) return;
	initStarted = true;
	void (async () => {
		try {
			const cache = await caches.open(CACHE_NAME);
			// lib.dom.d.ts types keys() as Promise<Request[]>, but the runtime
			// returns a ReadableStream per spec — stream it to avoid buffering.
			const keys = (cache.keys() as unknown as Promise<ReadableStream<Request>>);
			for await (const request of await keys) {
				cachedMediaUrls.add(request.url);
			}
		} catch (e) {
			console.warn('[mediaCacheStatus] init failed', e);
		}
	})();
}

/** Drop all known URLs (call after the media cache is wiped). */
export function resetMediaCacheStatus(): void {
	cachedMediaUrls.clear();
}

/** Remove a single URL from the registry (call after evicting it). */
export function dropCachedUrl(url: string): void {
	cachedMediaUrls.delete(url);
}