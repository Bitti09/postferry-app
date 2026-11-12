import { browser } from '$app/env';
import { db } from './cache/newDb';

/**
 * Reactive registry of every media URL currently present on disk (OPFS),
 * indexed by the `mediaUrls` table. Single source of truth for cache-status UI
 * (PostCard badges, feed pre-checks) so pages no longer rebuild Set copies.
 *
 * Svelte 5 deeply proxies this Set: reading `has(url)` inside a `$derived` or
 * `$effect` tracks only that specific entry, so one URL being cached only
 * invalidates the components actually looking at it — not every visible card.
 * NOTE: must stay a `.svelte.ts` file — runes are invalid in plain `.ts`.
 */
export const cachedMediaUrls: Set<string> = $state(new Set());

let initStarted = false;

/** Warm the registry from the media index on first use. */
export function initMediaCacheStatus(): void {
	if (!browser || initStarted) return;
	initStarted = true;
	void (async () => {
		try {
			const urls = await db.mediaUrls.toCollection().primaryKeys();
			for (const url of urls) cachedMediaUrls.add(String(url));
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
