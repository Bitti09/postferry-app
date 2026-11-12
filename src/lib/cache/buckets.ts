import { browser } from '$app/env';

interface StorageBucket {
	indexedDB: IDBFactory;
	caches: CacheStorage;
}
interface StorageBucketManager {
	open(name: string, options?: {
		persisted?: boolean;
		durability?: 'relaxed' | 'strict';
	}): Promise<StorageBucket>;
	delete(name: string): Promise<void>;
	keys(): Promise<string[]>;
}

declare global {
	interface Navigator {
		storageBuckets?: StorageBucketManager;
	}
}

/**
 * The Dexie database (posts, note index, accounts/tokens, settings, media
 * index) lives in one persistent bucket. Media blobs live in OPFS
 * (`#lib/mediaFiles`), not in Cache Storage, and OPFS is origin-scoped because
 * the API has no bucket variant; `navigator.storage.persist()` covers it.
 */
export const OFFLINE_BUCKET = 'offline-data';

let bucketReady: Promise<StorageBucket | null> | null = null;

async function openBucket(): Promise<StorageBucket | null> {
	if (!browser || !navigator.storageBuckets) return null;
	try {
		return await navigator.storageBuckets.open(OFFLINE_BUCKET, {
			persisted: true,
			durability: 'strict'
		});
	} catch (e) {
		console.warn('[storage] offline bucket unavailable; using origin IDB', e);
		return null;
	}
}

export function getOfflineBucket(): Promise<StorageBucket | null> {
	if (!browser) return Promise.resolve(null);
	if (!bucketReady) bucketReady = openBucket();
	return bucketReady;
}

/** Bucket-scoped IDBFactory for Dexie, or null when buckets are unavailable. */
export async function getOfflineBucketIdb(): Promise<IDBFactory | null> {
	const bucket = await getOfflineBucket();
	return bucket ? bucket.indexedDB : null;
}

/** Origin-wide storage estimate (IndexedDB, OPFS). */
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
