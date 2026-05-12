import { get, set, del, createStore, entries, clear } from 'idb-keyval';
import { browser } from '$app/environment';

const POSTS_KEY = 'tumblr_cached_posts';

// Separate IndexedDB store dedicated to raw media blobs
const mediaStore = createStore('tumblr-media-blobs', 'blobs');

// ─── Post Metadata ───────────────────────────────────────────────────────────

export async function getCachedPosts(): Promise<any[]> {
	if (!browser) return [];
	try {
		return (await get(POSTS_KEY)) || [];
	} catch (e) {
		console.error('Failed to get cached posts', e);
		return [];
	}
}

export async function addPostsToCache(newPosts: any[]) {
	if (!browser || newPosts.length === 0) return;
	try {
		const existingPosts = await getCachedPosts();
		const map = new Map();
		for (const p of existingPosts) map.set(p.id, p);
		for (const p of newPosts) map.set(p.id, p);
		const merged = Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp);
		await set(POSTS_KEY, merged);
	} catch (e) {
		console.error('Failed to set cached posts', e);
	}
}

export async function removePostFromCache(postId: string | number) {
	if (!browser) return;
	try {
		const existingPosts = await getCachedPosts();
		const filtered = existingPosts.filter(p => String(p.id) !== String(postId));
		await set(POSTS_KEY, filtered);
	} catch (e) {
		console.error('Failed to remove post from cache', e);
	}
}

export async function clearCache() {
	if (!browser) return;
	await set(POSTS_KEY, []);
	await clear(mediaStore);
}

// ─── Blob / Offline Media Cache ───────────────────────────────────────────────

/**
 * Returns a blob: Object URL if the media is already cached locally.
 * Returns null if not yet cached.
 */
export async function getCachedBlobUrl(url: string): Promise<{ url: string, type: string } | null> {
	if (!browser) return null;
	try {
		const blob: Blob | undefined = await get(url, mediaStore);
		if (blob) return { url: URL.createObjectURL(blob), type: blob.type };
		return null;
	} catch {
		return null;
	}
}

/**
 * Downloads a media URL and saves it as a Blob in IndexedDB.
 * Returns the local Object URL on success, null on failure.
 */
export async function downloadAndCacheMedia(url: string): Promise<{ url: string, type: string, errorStatus?: number } | null> {
	if (!browser) return null;
	try {
		// Already cached?
		const existing: Blob | undefined = await get(url, mediaStore);
		if (existing) return { url: URL.createObjectURL(existing), type: existing.type };

		// Use our server-side proxy to avoid 403 Forbidden/CORS issues
		const proxyUrl = `/api/media/proxy?url=${encodeURIComponent(url)}`;
		const res = await fetch(proxyUrl);
		
		if (!res.ok) {
			// If it's a 403 or 404, we want to report that back
			if (res.status === 403 || res.status === 404) {
				return { url: '', type: '', errorStatus: res.status };
			}

			// Fallback to direct fetch just in case it's a non-Tumblr URL that doesn't need proxying
			try {
				const fallback = await fetch(url);
				if (!fallback.ok) {
					if (fallback.status === 403 || fallback.status === 404) {
						return { url: '', type: '', errorStatus: fallback.status };
					}
					return null;
				}
				
				const blob = await fallback.blob();
				await set(url, blob, mediaStore);
				return { url: URL.createObjectURL(blob), type: blob.type };
			} catch {
				return null;
			}
		}

		const blob = await res.blob();
		await set(url, blob, mediaStore);
		return { url: URL.createObjectURL(blob), type: blob.type };
	} catch (e) {
		console.error('Failed to cache media:', url, e);
		return null;
	}
}

/**
 * How many blobs are currently stored in the media cache.
 */
export async function getMediaCacheStats(): Promise<{ count: number; estimatedMb: number }> {
	if (!browser) return { count: 0, estimatedMb: 0 };
	try {
		const all = await entries<string, Blob>(mediaStore);
		const totalBytes = all.reduce((acc, [, blob]) => acc + blob.size, 0);
		return { count: all.length, estimatedMb: Math.round(totalBytes / 1024 / 1024 * 10) / 10 };
	} catch {
		return { count: 0, estimatedMb: 0 };
	}
}

// ─── Shared Media Extraction ────────────────────────────────────────────────

export function extractUrlsFromBlocks(blocks: any[]): { urls: string[], primary: string } {
	const urls: string[] = [];
	let primary = '';

	for (const block of blocks || []) {
		if (block.type === 'image') {
			const url = block.media?.[0]?.url || block.url;
			if (url) {
				urls.push(url);
				if (!primary) primary = url;
			}
		} else if (block.type === 'video') {
			const vidUrl = block.media?.[0]?.url || block.url;
			const posterUrl = block.poster?.[0]?.url || block.thumbnail_url;
			if (vidUrl) urls.push(vidUrl);
			if (posterUrl) urls.push(posterUrl);
			if (!primary && posterUrl) primary = posterUrl;
			else if (!primary && vidUrl) primary = vidUrl;
		}
	}
	return { urls, primary };
}

export function getAllMediaUrls(post: any): string[] {
	const urls = new Set<string>();
	
	if (post.content) {
		extractUrlsFromBlocks(post.content).urls.forEach(u => urls.add(u));
	}
	if (post.trail) {
		post.trail.forEach((item: any) => {
			extractUrlsFromBlocks(item.content).urls.forEach(u => urls.add(u));
		});
	}

	if (post.type === 'photo' && post.photos) {
		post.photos.forEach((p: any) => {
			if (p.alt_sizes?.[0]?.url) urls.add(p.alt_sizes[0].url);
		});
	} else if (post.type === 'video') {
		if (post.video_url) urls.add(post.video_url);
		if (post.thumbnail_url) urls.add(post.thumbnail_url);
	}

	if (post.body) {
		// Extract images from legacy text posts with HTML body
		const imgRegex = /<img[^>]+src="([^">]+)"/g;
		let match;
		while ((match = imgRegex.exec(post.body)) !== null) {
			if (match[1]) urls.add(match[1]);
		}
		// Extract videos from legacy text posts with HTML body (if any)
		const videoRegex = /<video[^>]*><source[^>]+src="([^">]+)"/g;
		let vidMatch;
		while ((vidMatch = videoRegex.exec(post.body)) !== null) {
			if (vidMatch[1]) urls.add(vidMatch[1]);
		}
	}

	return Array.from(urls).filter(Boolean);
}

export function getPrimaryMediaUrl(post: any): string {
	// NPF primary
	let primary = '';
	if (post.content) primary = extractUrlsFromBlocks(post.content).primary;
	if (!primary && post.trail) {
		for (const item of post.trail) {
			primary = extractUrlsFromBlocks(item.content).primary;
			if (primary) break;
		}
	}
	if (primary) return primary;

	// Legacy primary
	if (post.type === 'photo' && post.photos?.length > 0) return post.photos[0].alt_sizes[0]?.url || '';
	if (post.type === 'video') return post.thumbnail_url || post.video_url || '';
	if (post.body) {
		const match = post.body.match(/<img[^>]+src="([^">]+)"/);
		if (match) return match[1];
	}
	return '';
}

export async function isMediaCached(url: string): Promise<boolean> {
	if (!browser) return false;
	try {
		const existing = await get(url, mediaStore);
		return !!existing;
	} catch {
		return false;
	}
}
