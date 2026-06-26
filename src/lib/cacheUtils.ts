import { downloadAndCacheMedia, bulkIsMediaCached } from '$lib/stores/db';
// NOTE: db.ts's downloadAndCacheMedia is used here. mediaCache.ts has an alternative
// with an inFlight dedup Map and memory cache layer. Consider switching imports to
// mediaCache.ts if you want in-flight deduplication and object URL caching.
import { getAllMediaUrls } from '$lib/mediaUrls';
import type { TumblrPost } from '$lib/types';

export interface CacheProgress {
	done: number;
	total: number;
}

/**
 * Download all media URLs from a list of posts, skipping already-cached items.
 * Call onProgress to update UI with download progress.
 */
export async function cacheAllVisible(
	posts: TumblrPost[],
	onProgress?: (progress: CacheProgress) => void
): Promise<void> {
	const urlMeta = new Map<string, { timestamp: number; post: TumblrPost }>();
	for (const post of posts) {
		const meta = { timestamp: post.timestamp, post };
		for (const url of getAllMediaUrls(post)) {
			if (!urlMeta.has(url)) urlMeta.set(url, meta);
		}
	}

	const urls = Array.from(urlMeta.keys());
	if (urls.length === 0) return;

	const cachedSet = await bulkIsMediaCached(urls);
	const toDownload = urls.filter((u) => !cachedSet.has(u));
	if (toDownload.length === 0) {
		onProgress?.({ done: 0, total: 0 });
		return;
	}

	let done = 0;
	onProgress?.({ done: 0, total: toDownload.length });

	const BATCH = 4;
	for (let i = 0; i < toDownload.length; i += BATCH) {
		const batch = toDownload.slice(i, i + BATCH);
		await Promise.all(
			batch.map(async (url) => {
				await downloadAndCacheMedia(url, urlMeta.get(url));
				done++;
				onProgress?.({ done, total: toDownload.length });
			})
		);
	}
}
