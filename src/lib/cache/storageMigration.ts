import { browser } from '$app/env';
import { db, mediaAssetBase } from './newDb';
import { writeMediaFile } from '#lib/mediaFiles';

const FLAG = 'cache-to-opfs-migrated-v1';

/**
 * One-time move of everything the previous build left in Cache Storage into
 * OPFS, with matching rows in the `mediaUrls` index. After this runs the app
 * uses no Cache Storage at all.
 *
 * `postId: 0` marks migrated media whose post cannot be identified from the
 * cache key; GC leaves those rows alone and LRU eviction eventually removes
 * them instead of wiping the whole library.
 */
export async function migrateLegacyCaches(): Promise<void> {
	if (!browser || localStorage.getItem(FLAG)) return;

	const sources: Cache[] = [];

	try {
		if (await caches.has('tmblr-media')) sources.push(await caches.open('tmblr-media'));
	} catch {
		// Cache API unavailable
	}

	const manager = navigator.storageBuckets;
	if (manager) {
		let names: string[] = [];
		try {
			names = await manager.keys();
		} catch {
			names = [];
		}
		for (const bucketName of ['offline-data', 'app-data', 'media-cache']) {
			if (!names.includes(bucketName)) continue;
			try {
				const bucket = await manager.open(bucketName, {
					persisted: false,
					durability: 'relaxed'
				});
				if (await bucket.caches.has('tmblr-media')) {
					sources.push(await bucket.caches.open('tmblr-media'));
				}
			} catch {
				// bucket unreadable; leave it for a later run
			}
		}
	}

	try {
		for (const cache of sources) {
			for (const request of await cache.keys()) {
				const response = await cache.match(request);
				if (!response) continue;
				const blob = await response.blob();
				const type = response.headers.get('content-type') || 'application/octet-stream';
				const stored = await writeMediaFile(
					request.url,
					new Response(blob, { headers: { 'Content-Type': type } })
				);
				if (!stored) continue;
				await db.mediaUrls.put({
					url: request.url,
					postId: '0',
					type,
					cachedAt: Date.now(),
					size: blob.size,
					base: mediaAssetBase(request.url)
				});
			}
		}

		// Nothing reads Cache Storage any more.
		for (const key of await caches.keys()) await caches.delete(key);
		if (manager) {
			for (const name of ['app-data', 'media-cache']) {
				await manager.delete(name).catch(() => {});
			}
		}
		localStorage.setItem(FLAG, '1');
	} catch (e) {
		console.warn('[storage] cache → OPFS migration failed; will retry', e);
	}
}
