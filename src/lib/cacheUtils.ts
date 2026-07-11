import { downloadAndCacheMedia, bulkIsMediaCached } from '$lib/stores/mediaCache';
import { getAllMediaUrls } from '$lib/mediaUrls';
import type { TumblrPost } from '$lib/types';

export interface CacheProgress {
	done: number;
	total: number;
}

interface UrlMeta {
	timestamp: number;
	post: TumblrPost;
}

/**
 * Download all media URLs from a list of posts, skipping already-cached items.
 * Call onProgress to update UI with download progress.
 */
export async function cacheAllVisible(
	posts: TumblrPost[],
	onProgress?: (progress: CacheProgress) => void
): Promise<void> {
	// Collect unique URLs with their metadata (first post wins for tie-breaking)
	const urlMeta = new Map<string, UrlMeta>();
	for (const post of posts) {
		const meta: UrlMeta = { timestamp: post.timestamp, post };
		for (const url of getAllMediaUrls(post)) {
			if (!urlMeta.has(url)) urlMeta.set(url, meta);
		}
	}

	const urls = [...urlMeta.keys()];
	if (!urls.length) {
		onProgress?.({ done: 0, total: 0 });
		return;
	}

	// Check which URLs are already cached
	const cachedSet = await bulkIsMediaCached(urls);
	const toDownload = urls.filter((u) => !cachedSet.has(u));

	if (!toDownload.length) {
		onProgress?.({ done: 0, total: 0 });
		return;
	}

	// Download in controlled batches with progress throttling
	const BATCH_SIZE = 4;
	const PROGRESS_THROTTLE_MS = 50;
	let done = 0;
	let lastProgressTime = 0;

	const reportProgress = (force = false) => {
		const now = Date.now();
		if (force || now - lastProgressTime >= PROGRESS_THROTTLE_MS) {
			onProgress?.({ done, total: toDownload.length });
			lastProgressTime = now;
		}
	};

	reportProgress();

	for (let i = 0; i < toDownload.length; i += BATCH_SIZE) {
		const batch = toDownload.slice(i, i + BATCH_SIZE);
		await Promise.all(
			batch.map(async (url) => {
				await downloadAndCacheMedia(url, urlMeta.get(url));
				done++;
				reportProgress();
			})
		);
	}

	reportProgress(true); // Final progress update
}