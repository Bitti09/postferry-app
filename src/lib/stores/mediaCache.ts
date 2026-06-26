import { browser } from '$app/environment';
import type { TumblrPost } from '$lib/types';
import { getDB, withStore, getStore, setStore } from './db';

const MEDIA_BUCKET = 'tumblr-media-cache';
const MEDIA_DB = 'tumblr-media-blobs';
const MEDIA_STORE = 'blobs';

const inFlight = new Map<string, Promise<{ url: string; type: string } | null>>();
const memoryCache = new Map<string, MediaCacheEntry>();

interface MediaCacheEntry {
	blob: Blob;
	type: string;
	url: string; // object URL
	revoked: boolean;
}

export interface CachedBlobResult {
	url: string;
	type: string;
}

function bucket() {
	return { bucketName: MEDIA_BUCKET, dbName: MEDIA_DB, storeName: MEDIA_STORE };
}

/**
 * Returns a blob: Object URL if the media is already cached locally.
 * Returns null if not yet cached. Each result must eventually be revoked.
 */
export async function getCachedBlobUrl(url: string): Promise<CachedBlobResult | null> {
	if (!browser) return null;
	if (!url) return null;

	const mem = memoryCache.get(url);
	if (mem && !mem.revoked) {
		return { url: mem.url, type: mem.type };
	}

	try {
		const item: any = await getStore(url, MEDIA_BUCKET, MEDIA_DB, MEDIA_STORE);
		if (!item) return null;

		const blob = item.blob || item;
		const objectUrl = URL.createObjectURL(blob);
		memoryCache.set(url, { blob, type: blob.type, url: objectUrl, revoked: false });
		return { url: objectUrl, type: blob.type };
	} catch {
		return null;
	}
}

/**
 * Returns true if the media is cached. Cheap: checks memory first, then IDB.
 */
export async function isMediaCached(url: string): Promise<boolean> {
	if (!browser) return false;
	if (!url) return false;
	if (memoryCache.has(url)) return true;

	try {
		const existing = await getStore(url, MEDIA_BUCKET, MEDIA_DB, MEDIA_STORE);
		return !!existing;
	} catch {
		return false;
	}
}

/**
 * Downloads a media URL and saves it as a Blob in IndexedDB.
 * Deduplicates concurrent fetches for the same URL.
 */
export async function downloadAndCacheMedia(
	url: string,
	meta?: { timestamp: number; post?: TumblrPost }
): Promise<CachedBlobResult | null> {
	if (!browser) return null;
	if (!url) return null;

	const existing = memoryCache.get(url);
	if (existing && !existing.revoked) {
		return { url: existing.url, type: existing.type };
	}

	if (inFlight.has(url)) {
		return inFlight.get(url)!;
	}

	const promise = fetchAndStore(url, meta);
	inFlight.set(url, promise);
	return promise;
}

async function fetchAndStore(
	url: string,
	meta?: { timestamp: number; post?: TumblrPost }
): Promise<CachedBlobResult | null> {
	try {
		const cleanMeta = meta ? JSON.parse(JSON.stringify(meta)) : undefined;

		const cached = await getStore(url, MEDIA_BUCKET, MEDIA_DB, MEDIA_STORE);
		if (cached) {
			const blob = cached.blob || cached;
			const objectUrl = URL.createObjectURL(blob);
			memoryCache.set(url, { blob, type: blob.type, url: objectUrl, revoked: false });
			return { url: objectUrl, type: blob.type };
		}

		const proxyUrl = `/api/media/proxy?url=${encodeURIComponent(url)}`;
		const res = await fetch(proxyUrl);

		if (!res.ok) {
			if (res.status === 403 || res.status === 404) {
				return null;
			}
			const fallback = await fetch(url);
			if (!fallback.ok) {
				return null;
			}
			const blob = await fallback.blob();
			const dataToStore = cleanMeta ? { blob, ...cleanMeta } : blob;
			await setStore(url, dataToStore, MEDIA_BUCKET, MEDIA_DB, MEDIA_STORE);
			const objectUrl = URL.createObjectURL(blob);
			memoryCache.set(url, { blob, type: blob.type, url: objectUrl, revoked: false });
			return { url: objectUrl, type: blob.type };
		}

		const blob = await res.blob();
		const dataToStore = cleanMeta ? { blob, ...cleanMeta } : blob;
		await setStore(url, dataToStore, MEDIA_BUCKET, MEDIA_DB, MEDIA_STORE);
		const objectUrl = URL.createObjectURL(blob);
		memoryCache.set(url, { blob, type: blob.type, url: objectUrl, revoked: false });
		return { url: objectUrl, type: blob.type };
	} catch (e) {
		console.error('Failed to cache media:', url, e);
		return null;
	} finally {
		inFlight.delete(url);
	}
}

/**
 * Revoke an object URL returned by this module.
 * Call when the consuming component is destroyed or swaps media.
 */
export function revokeBlobUrl(url: string) {
	const entry = memoryCache.get(url);
	if (entry) {
		URL.revokeObjectURL(entry.url);
		entry.revoked = true;
		memoryCache.delete(url);
	}
}

/**
 * Returns all blobs currently stored in the media cache as object URLs.
 */
export async function getAllCachedMedia(): Promise<
	{ originalUrl: string; url: string; type: string; timestamp?: number; post?: any }[]
> {
	if (!browser) return [];
	try {
		const { entriesStore } = await import('./db');
		const all = await entriesStore(MEDIA_BUCKET, MEDIA_DB, MEDIA_STORE);
		return all.map(([key, item]: [IDBValidKey, any]) => {
			const blob = item.blob || item;
			return {
				originalUrl: key as string,
				url: URL.createObjectURL(blob),
				type: blob.type,
				timestamp: item.timestamp,
				post: item.post
			};
		});
	} catch (e) {
		console.error('Failed to get all cached media:', e);
		return [];
	}
}

/**
 * Clear all media from the cache and revoke any live object URLs.
 */
export async function clearMediaCache() {
	if (!browser) return;
	for (const [url, entry] of memoryCache) {
		URL.revokeObjectURL(entry.url);
		entry.revoked = true;
	}
	memoryCache.clear();

	const db = await getDB(MEDIA_BUCKET, MEDIA_DB, MEDIA_STORE);
	const tx = db.transaction(MEDIA_STORE, 'readwrite');
	tx.objectStore(MEDIA_STORE).clear();
	return new Promise<void>((resolve, reject) => {
		tx.oncomplete = () => {
			db.close();
			resolve();
		};
		tx.onerror = () => reject(tx.error);
	});
}

export async function getMediaCacheStats(): Promise<{ count: number; estimatedMb: number }> {
	if (!browser) return { count: 0, estimatedMb: 0 };
	try {
		if ('storageBuckets' in navigator) {
			const nav = navigator as any;
			const bucket = await nav.storageBuckets.open(MEDIA_BUCKET, { persisted: false, durability: 'relaxed' });
			const estimate = await bucket.estimate();
			const { entriesStore } = await import('./db');
			const all = await entriesStore(MEDIA_BUCKET, MEDIA_DB, MEDIA_STORE);
			return {
				count: all.length,
				estimatedMb: Math.round((estimate.usage || 0) / 1024 / 1024 * 10) / 10
			};
		}

		const { entriesStore } = await import('./db');
		const all = await entriesStore(MEDIA_BUCKET, MEDIA_DB, MEDIA_STORE);
		const totalBytes = all.reduce((acc, [, item]) => {
			const blob = item.blob || item;
			return acc + (blob.size || 0);
		}, 0);
		return { count: all.length, estimatedMb: Math.round(totalBytes / 1024 / 1024 * 10) / 10 };
	} catch {
		return { count: 0, estimatedMb: 0 };
	}
}
