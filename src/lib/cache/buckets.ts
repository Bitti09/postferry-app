import { browser } from '$app/environment';
import { mediaAssetBase } from '$lib/cache/newDb';

/**
 * Storage bucket layout (Chromium 122+; graceful fallback elsewhere):
 *  - app-data    persisted + strict — Dexie DB (accounts, tokens, post index).
 *                The irreplaceable data; survives eviction pressure.
 *  - media-cache best-effort + relaxed — the `tmblr-media` Cache Storage.
 *                Re-fetchable blobs; the designated sacrifice zone.
 *
 * On browsers without Storage Buckets everything uses the default origin
 * storage exactly as before, plus a best-effort navigator.storage.persist().
 */

// Minimal ambient types for the Storage Buckets API (not in bundled lib.dom).
interface StorageBucketManager {
	open(name: string, options?: {
		persisted?: boolean;
		durability?: 'relaxed' | 'strict';
		expires?: number;
		quota?: number;
	}): Promise<StorageBucket>;
	delete(name: string): Promise<void>;
	keys(): Promise<string[]>;
}
interface StorageBucket {
	indexedDB: IDBFactory;
	caches: CacheStorage;
}

declare global {
	interface Navigator {
		storageBuckets?: StorageBucketManager;
	}
}

export const APP_BUCKET = 'app-data';
export const MEDIA_BUCKET = 'media-cache';

let bucketsReady: Promise<{ app: StorageBucket | null; media: StorageBucket | null }> | null = null;

export function bucketsSupported(): boolean {
	return browser && typeof navigator !== 'undefined' && !!navigator.storageBuckets;
}

async function openBuckets(): Promise<{ app: StorageBucket | null; media: StorageBucket | null }> {
	if (!bucketsSupported()) return { app: null, media: null };
	try {
		const mgr = navigator.storageBuckets!;
		const [app, media] = await Promise.all([
			mgr.open(APP_BUCKET, { persisted: true, durability: 'strict' }),
			mgr.open(MEDIA_BUCKET, { persisted: false, durability: 'relaxed' })
		]);
		return { app, media };
	} catch (e) {
		console.warn('[buckets] open failed, falling back to origin storage', e);
		return { app: null, media: null };
	}
}

export async function getBuckets(): Promise<{ app: StorageBucket | null; media: StorageBucket | null }> {
	if (!browser) return { app: null, media: null };
	if (!bucketsReady) bucketsReady = openBuckets();
	return bucketsReady;
}

/** CacheStorage scoped to the media bucket, or null on fallback browsers. */
export async function getMediaBucketCacheStorage(): Promise<CacheStorage | null> {
	const { media } = await getBuckets();
	return media ? media.caches : null;
}

/** IDBFactory scoped to the app bucket, or null on fallback browsers. */
export async function getAppBucketIdb(): Promise<IDBFactory | null> {
	const { app } = await getBuckets();
	return app ? app.indexedDB : null;
}

const MIGRATION_FLAG = 'buckets-migrated-v1';

/**
 * One-time migration into buckets. Runs at most once per install (flag in
 * localStorage; per-entry copy is content-addressed by URL so an interrupted
 * run resumes cleanly on the next start).
 */
export async function migrateIntoBuckets(): Promise<{ mediaCopied: number }> {
	if (!bucketsSupported()) return { mediaCopied: 0 };
	if (localStorage.getItem(MIGRATION_FLAG)) return { mediaCopied: 0 };

	const { media } = await getBuckets();
	if (!media) return { mediaCopied: 0 };

	let copied = 0;
	try {
		const source = await caches.open('tmblr-media');
		const dest = await media.caches.open('tmblr-media');
		const keys = await source.keys();
		for (const request of keys) {
			const hit = await source.match(request);
			if (!hit) continue;
			// Bucket-scoped dest is a distinct namespace; copy only entries that
			// are not already present (interrupted-run resume).
			if (!(await dest.match(request.url))) {
				await dest.put(request.url, hit.clone());
			}
			copied++;
		}
		localStorage.setItem(MIGRATION_FLAG, '1');
	} catch (e) {
		console.warn('[buckets] media migration failed; will retry next launch', e);
	}
	return { mediaCopied: copied };
}

/**
 * Resolve the Cache handle for `tmblr-media`, preferring the media bucket.
 * This is the single entry point the cache layer should use.
 */
export async function openMediaCache(): Promise<Cache | null> {
	if (!browser) return null;
	const bucketStorage = await getMediaBucketCacheStorage();
	if (bucketStorage) return bucketStorage.open('tmblr-media');
	if (typeof caches === 'undefined') return null;
	return caches.open('tmblr-media');
}

/**
 * Storage estimate scoped as well as possible: per-bucket numbers when
 * buckets are supported, origin-wide otherwise.
 */
export async function getStorageBreakdown(): Promise<{
	usageBytes: number;
	quotaBytes: number;
	persisted: boolean;
}> {
	if (!browser || !navigator.storage?.estimate) {
		return { usageBytes: 0, quotaBytes: 0, persisted: false };
	}
	const est = await navigator.storage.estimate();
	let persisted = false;
	try {
		persisted = (await navigator.storage.persisted?.()) ?? false;
	} catch {
		// persisted() unsupported
	}
	return {
		usageBytes: est.usage ?? 0,
		quotaBytes: est.quota ?? 0,
		persisted
	};
}
