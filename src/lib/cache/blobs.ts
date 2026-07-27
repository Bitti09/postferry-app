import { browser } from '$app/environment';
import type { TumblrPost } from '$lib/types';
import { db } from './newDb';

export interface BlobPostMeta {
	id: number;
	blogName: string;
	timestamp: number;
	summary: string;
	type: TumblrPost['type'];
	tags: string[];
}

export interface SlimMediaMeta {
	postId: number;
	blogName: string;
	timestamp: number;
	post?: TumblrPost;
	postMeta?: BlobPostMeta;
}

export interface MediaRef { url: string; type: string; size: number }

const CACHE_NAME = 'tmblr-media';

async function getMediaCache(): Promise<Cache | null> {
	if (!browser || !window.caches) return null;
	return await caches.open(CACHE_NAME);
}

export async function isMediaCached(url: string): Promise<boolean> {
	if (!browser || !url) return false;
	const cache = await getMediaCache();
	if (!cache) return false;
	const match = await cache.match(url);
	return !!match;
}

export async function bulkIsMediaCached(urls: ReadonlyArray<string>): Promise<Set<string>> {
	const cached = new Set<string>();
	if (!browser || urls.length === 0) return cached;
	const unique = [...new Set(urls.filter(Boolean))];
	const cache = await getMediaCache();
	if (!cache) return cached;
	
	// Cache API doesn't have bulk match, so we Promise.all over all keys
	await Promise.all(unique.map(async (url) => {
		if (await cache.match(url)) {
			cached.add(url);
		}
	}));
	
	return cached;
}

export async function getMediaForPost(postId: number): Promise<MediaRef[]> {
	if (!browser || !Number.isFinite(postId)) return [];
	const mediaUrls = await db.mediaUrls.where('postId').equals(postId).toArray();
	
	const cache = await getMediaCache();
	if (!cache) return [];
	
	const out: MediaRef[] = [];
	for (const m of mediaUrls) {
		const match = await cache.match(m.url);
		if (match) {
			const sizeStr = match.headers.get('content-length');
			const size = sizeStr ? parseInt(sizeStr, 10) : 0;
			out.push({ url: m.url, type: m.type, size });
		}
	}
	return out;
}

export async function clearMediaForPost(postId: number): Promise<number> {
	if (!browser || !Number.isFinite(postId)) return 0;
	const mediaUrls = await db.mediaUrls.where('postId').equals(postId).toArray();
	if (mediaUrls.length === 0) return 0;
	
	const cache = await getMediaCache();
	if (cache) {
		for (const m of mediaUrls) {
			await cache.delete(m.url);
		}
	}
	await db.mediaUrls.bulkDelete(mediaUrls.map(m => m.url));
	return mediaUrls.length;
}

export async function gcOrphanBlobs(validPostIds: ReadonlySet<number>): Promise<{ deletedBlobs: number; deletedIndex: number }> {
	if (!browser) return { deletedBlobs: 0, deletedIndex: 0 };
	
	const orphans: string[] = [];
	await db.mediaUrls.each((m) => {
		if (!validPostIds.has(m.postId)) orphans.push(m.url);
	});
	
	let deletedBlobs = 0;
	const cache = await getMediaCache();
	if (cache) {
		for (const url of orphans) {
			if (await cache.delete(url)) deletedBlobs++;
		}
	}
	
	await db.mediaUrls.bulkDelete(orphans);
	return { deletedBlobs, deletedIndex: orphans.length };
}

export async function getMediaCacheStats(): Promise<{ count: number; estimatedMb: number }> {
	if (!browser) return { count: 0, estimatedMb: 0 };
	
	const cache = await getMediaCache();
	if (!cache) return { count: 0, estimatedMb: 0 };
	
	const keys = await cache.keys();
	let estimatedMb = 0;
	if (navigator.storage && navigator.storage.estimate) {
		const est = await navigator.storage.estimate();
		estimatedMb = Math.round(((est.usage || 0) / 1024 / 1024) * 10) / 10;
	}
	
	return { count: keys.length, estimatedMb };
}

export { clearMediaCache } from './clear';
