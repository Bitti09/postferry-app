import { extractMedia, bestSourceFor } from './mediaUrls';
import { cachedMediaUrls } from './mediaCacheStatus.svelte';
import { requestMediaDownload, type DownloadPriority } from '$lib/stores/downloads';
import type { TumblrPost } from '$lib/types';

const MEDIA_CACHE = 'tmblr-media';

const extFromTypeOrUrl = (mimeType: string, url: string): string => {
	const fromType = mimeType.split('/')[1]?.split(';')[0];
	if (fromType && fromType !== 'jpeg') return fromType;
	if (fromType === 'jpeg') return 'jpg';
	const fromUrl = url.match(/\.([a-zA-Z0-9]+)(?:\?|#)?$/);
	return fromUrl?.[1] ?? 'jpg';
};

const sanitize = (s: string): string =>
	s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
const delay = (ms: number): Promise<void> => {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, ms);
	return promise;
};

function waitForCached(url: string, timeoutMs = 120_000): Promise<boolean> {
	if (cachedMediaUrls.has(url)) return Promise.resolve(true);
	const { promise, resolve } = Promise.withResolvers<boolean>();
	const timer = setTimeout(() => {
		cleanup();
		resolve(false);
	}, timeoutMs);
	const onCached = (e: Event) => {
		const detail = (e as CustomEvent).detail;
		if (detail.url === url) {
			cleanup();
			resolve(true);
		}
	};
	const onError = (e: Event) => {
		const detail = (e as CustomEvent).detail;
		if (detail.url === url) {
			cleanup();
			resolve(false);
		}
	};
	function cleanup() {
		clearTimeout(timer);
		window.removeEventListener('tmblr-media-cached', onCached);
		window.removeEventListener('tmblr-media-error', onError);
	}
	window.addEventListener('tmblr-media-cached', onCached);
	window.addEventListener('tmblr-media-error', onError);
	return promise;
}

/** Read a cached blob for url, or null when absent. */
async function readCachedBlob(url: string): Promise<Blob | null> {
	if (!('caches' in window)) return null;
	const cache = await caches.open(MEDIA_CACHE);
	const hit = await cache.match(url);
	return hit ? hit.blob() : null;
}

/**
 * Trigger a browser "save as" for a blob under a descriptive filename.
 */
function saveBlob(blob: Blob, filename: string): void {
	const objectUrl = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = objectUrl;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	// Revoke on the next turn — Chrome truncates downloads revoked synchronously.
	setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
}

/**
 * Download the highest-resolution rendition of `displayUrl` (the URL the UI
 * shows, which may be a small grid variant) to the user's disk.
 *
 * Resolution order:
 *  1. Resolve the true best source from the extraction's variant table.
 *  2. If the best source is already in the offline cache → save it.
 *  3. Else request it through the download queue at top priority and wait.
 *  4. Read the blob from the cache and trigger the browser save dialog.
 */
export async function downloadHighestRes(
	displayUrl: string,
	post: TumblrPost,
	extraction = extractMedia(post)
): Promise<void> {
	const best = bestSourceFor(displayUrl, extraction);
	// Third-party provider embeds have no direct media URL to save.
	if (!best.url || (!best.url.startsWith('http') && !best.url.startsWith('/'))) return;

	if (!cachedMediaUrls.has(best.url)) {
		requestMediaDownload(
			best.url,
			{ postId: post.id, blogName: post.blog_name, timestamp: post.timestamp, post },
			'download' satisfies DownloadPriority
		);
		const ok = await waitForCached(best.url);
		if (!ok) throw new Error(`Could not fetch media: ${best.url}`);
	}

	const blob = (await readCachedBlob(best.url)) ?? (await (await fetch(best.url)).blob());
	const ext = extFromTypeOrUrl(blob.type, best.url);
	const filename = `${sanitize(post.blog_name)}_${post.id}${ext ? `.${ext}` : ''}`;
	saveBlob(blob, filename);
}

/**
 * Download every media item of a post, sequentially (browsers coalesce
 * multiple programmatic downloads behind a single permission prompt).
 */
export async function downloadAllPostMedia(post: TumblrPost): Promise<void> {
	const extraction = extractMedia(post);
	for (const url of extraction.urls) {
		await downloadHighestRes(url, post, extraction);
		// Spacing avoids some browsers dropping all but the last download.
		await delay(300);
	}
}
