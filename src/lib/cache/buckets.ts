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
 *
 * Only names under the `postferry` namespace are used. A startup sweep deletes
 * legacy buckets, databases, Cache Storage entries and localStorage flags left
 * by older names so nothing stale remains.
 */
export const OFFLINE_BUCKET = 'postferry-data';
const DB_NAME = 'postferry-cache';

const LEGACY_BUCKETS = new Set(['offline-data', 'app-data', 'media-cache']);
const LEGACY_DBS = new Set([
	'app-data',
	'media-cache',
	'offline-data',
	'tmblr-cache',
	'tmblr-cache-new',
	'tumblr-cache',
	'tumblr-cache-new'
]);
const LEGACY_LOCAL_KEYS = new Set([
	'cache-to-opfs-migrated-v1',
	'offline-bucket-db-migrated-v1'
]);

let bucketReady: Promise<StorageBucket | null> | null = null;
let namespaceReady: Promise<void> | null = null;

function isLegacyName(name: string): boolean {
	return /tmblr|tumblr/i.test(name) || LEGACY_DBS.has(name) || LEGACY_BUCKETS.has(name);
}

function deleteDatabase(name: string): Promise<void> {
	return new Promise((resolve) => {
		try {
			const request = indexedDB.deleteDatabase(name);
			request.onsuccess = () => resolve();
			request.onerror = () => resolve();
			request.onblocked = () => resolve();
		} catch {
			resolve();
		}
	});
}

/**
 * Remove every non-postferry leftover before opening the current bucket.
 * This intentionally discards data under older names; there is no migration.
 */
async function enforceStorageNamespace(): Promise<void> {
	if (!browser) return;

	// Legacy storage buckets (and the databases/caches inside them).
	const manager = navigator.storageBuckets;
	if (manager) {
		try {
			for (const name of await manager.keys()) {
				if (name !== OFFLINE_BUCKET) await manager.delete(name).catch(() => {});
			}
		} catch {
			// Bucket API unavailable; continue with origin cleanup.
		}
	}

	// Legacy origin databases. Keep the current postferry database.
	try {
		const databases = await indexedDB.databases?.();
		for (const entry of databases ?? []) {
			const name = entry.name;
			if (!name || name === DB_NAME) continue;
			if (isLegacyName(name)) await deleteDatabase(name);
		}
	} catch {
		// indexedDB.databases() is not available everywhere.
	}
	for (const name of LEGACY_DBS) await deleteDatabase(name);

	// Cache Storage is no longer used by the app. Keep only postferry-prefixed
	// caches for future use and remove everything else.
	try {
		for (const name of await caches.keys()) {
			if (!name.startsWith('postferry')) await caches.delete(name);
		}
	} catch {
		// Cache API unavailable.
	}

	// Old migration flags and any old-name localStorage keys.
	try {
		for (const key of Object.keys(localStorage)) {
			if (LEGACY_LOCAL_KEYS.has(key) || isLegacyName(key)) {
				localStorage.removeItem(key);
			}
		}
	} catch {
		// localStorage unavailable.
	}
}

async function ensureNamespace(): Promise<void> {
	if (!namespaceReady) namespaceReady = enforceStorageNamespace();
	await namespaceReady;
}

async function openBucket(): Promise<StorageBucket | null> {
	await ensureNamespace();
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
