// ─── cacheUtils ─────────────────────────────────────────────────────────────
// Bulk cache orchestrator. Used by Dashboard / Likes / Search / Blog pages
// when the user clicks "Cache Visible". Streams post → URL mapping through
// `bulkIsMediaCached` for the existence check, then `requestMediaDownload`
// per URL. Concurrency is bounded by the download queue in
// `$lib/stores/downloads` (CONCURRENCY in-flight fetches, FIFO for the rest).

import { bulkIsMediaCached, type SlimMediaMeta } from '$lib/cache/blobs';
import { requestMediaDownload } from '$lib/stores/downloads';
import { scheduleMediaMaintenance } from '$lib/cache/eviction';
import { getAllMediaUrls } from '$lib/mediaUrls';
import type { TumblrPost } from '$lib/types';

export interface CacheProgress { done: number; total: number }

/**
 * Download all media URLs from a list of posts, skipping already-cached
 * items. Atomically writes the post metadata alongside each blob so the
 * offline post-detail view can find its media without re-extracting URLs.
 */
export async function cacheAllVisible(
	posts: TumblrPost[],
	onProgress?: (progress: CacheProgress) => void,
	priority: 'visible' | 'prefetch' | 'bulk' = 'bulk'
): Promise<void> {
	if (posts.length === 0) {
		onProgress?.({ done: 0, total: 0 });
		return;
	}

	const urlMeta = new Map<string, SlimMediaMeta>();
	for (const post of posts) {
		// Posts arrive as Svelte $state proxies from component props; snapshot
		// to plain data — IDB structured clone rejects proxies, and this object
		// is written to IDB when the download completes.
		const plainPost: TumblrPost = $state.snapshot(post);
		const meta: SlimMediaMeta = {
			postId: plainPost.id,
			blogName: plainPost.blog_name,
			timestamp: plainPost.timestamp,
			post: plainPost,
			postMeta: {
				id: plainPost.id,
				blogName: plainPost.blog_name,
				timestamp: plainPost.timestamp,
				summary: plainPost.summary ?? '',
				type: plainPost.type,
				tags: plainPost.tags ?? []
			}
		};
		for (const url of getAllMediaUrls(plainPost)) {
			if (!urlMeta.has(url)) urlMeta.set(url, meta);
		}
	}

	const urls = [...urlMeta.keys()];
	if (urls.length === 0) {
		onProgress?.({ done: 0, total: 0 });
		return;
	}

	const cachedSet = await bulkIsMediaCached(urls);
	const toDownload = urls.filter((u) => !cachedSet.has(u));
	if (toDownload.length === 0) {
		onProgress?.({ done: 0, total: 0 });
		return;
	}

	const items = toDownload.map((url) => ({ url, meta: urlMeta.get(url)! }));
	for (const item of items) {
		requestMediaDownload(item.url, item.meta, priority);
	}

	// A bulk cache may push the cache past its caps — run eviction shortly
	// after, debounced so repeated clicks coalesce into one pass.
	scheduleMediaMaintenance(30_000);

	onProgress?.({ done: toDownload.length, total: toDownload.length });
}