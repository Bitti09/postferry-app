import { browser } from '$app/environment';

// Request persistent storage permission for the origin
if (browser && navigator.storage && navigator.storage.persist) {
	navigator.storage.persist().then(granted => {
		console.log(`[Storage] Origin persistence granted: ${granted}`);
	});
}

// ─── Custom Bucket-Aware IDB Wrapper ───────────────────────────────────────

async function getDB(bucketName: string, dbName: string, storeName: string): Promise<IDBDatabase> {
	return new Promise(async (resolve, reject) => {
		try {
			let idbFactory = window.indexedDB;
			if ('storageBuckets' in navigator) {
				const nav = navigator as any;
				// App state should be persistent/strict, Media cache can be relaxed and evicted if needed
				const options = bucketName === 'tumblr-app-state' 
					? { persisted: true, durability: 'strict' } 
					: { persisted: false, durability: 'relaxed' };
				const bucket = await nav.storageBuckets.open(bucketName, options);
				idbFactory = bucket.indexedDB;
			}
			
			// If falling back to global IDB, we use the original names to preserve data
			const req = idbFactory.open(dbName, 1);
			req.onupgradeneeded = () => {
				req.result.createObjectStore(storeName);
			};
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		} catch (e) {
			reject(e);
		}
	});
}

function withStore(type: IDBTransactionMode, bucketName: string, dbName: string, storeName: string, callback: (store: IDBObjectStore) => IDBRequest | void): Promise<any> {
	return getDB(bucketName, dbName, storeName).then(db => {
		return new Promise((resolve, reject) => {
			const transaction = db.transaction(storeName, type);
			transaction.oncomplete = () => db.close();
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error);
			const request = callback(transaction.objectStore(storeName));
			if (request) {
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			} else {
				resolve(undefined);
			}
		});
	});
}

async function getStore(key: IDBValidKey, b: string, d: string, s: string): Promise<any> {
	return withStore('readonly', b, d, s, store => store.get(key));
}

async function setStore(key: IDBValidKey, value: any, b: string, d: string, s: string): Promise<void> {
	return withStore('readwrite', b, d, s, store => { store.put(value, key); });
}

async function clearStore(b: string, d: string, s: string): Promise<void> {
	return withStore('readwrite', b, d, s, store => { store.clear(); });
}

async function entriesStore(b: string, d: string, s: string): Promise<any[]> {
	return withStore('readonly', b, d, s, store => store.getAll()).then(values => {
		return withStore('readonly', b, d, s, store => store.getAllKeys()).then(keys => {
			return keys.map((key: any, i: number) => [key, values[i]]);
		});
	});
}

// ─── Store Configurations ───────────────────────────────────────────────────

const APP_BUCKET = 'tumblr-app-state';
const APP_DB = 'keyval-store';
const APP_STORE = 'keyval';
const POSTS_KEY = 'tumblr_cached_posts';

const MEDIA_BUCKET = 'tumblr-media-cache';
const MEDIA_DB = 'tumblr-media-blobs';
const MEDIA_STORE = 'blobs';

// ─── Migration ──────────────────────────────────────────────────────────────

async function migrateOldData() {
	if (!browser || !('storageBuckets' in navigator)) return;
	
	try {
		const migrated = localStorage.getItem('tumblr_buckets_migrated');
		if (migrated === 'true') return;

		console.log('[Storage Migration] Starting migration from global IDB to Storage Buckets...');
		
		const dbs = await window.indexedDB.databases();

		// 1. Migrate App State (Posts)
		if (dbs.some(db => db.name === APP_DB)) {
			const oldAppDb = await new Promise<IDBDatabase>((resolve, reject) => {
				const req = window.indexedDB.open(APP_DB);
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => reject(req.error);
			});
			
			if (oldAppDb.objectStoreNames.contains(APP_STORE)) {
				const posts = await new Promise<any>((resolve, reject) => {
					const tx = oldAppDb.transaction(APP_STORE, 'readonly');
					const req = tx.objectStore(APP_STORE).get(POSTS_KEY);
					req.onsuccess = () => resolve(req.result);
					req.onerror = () => reject(req.error);
				});
				if (posts && Array.isArray(posts) && posts.length > 0) {
					console.log(`[Storage Migration] Found ${posts.length} cached posts in legacy DB. Moving...`);
					await setStore(POSTS_KEY, posts, APP_BUCKET, APP_DB, APP_STORE);
				}
			}
			oldAppDb.close();
			window.indexedDB.deleteDatabase(APP_DB);
		}

		// 2. Migrate Media Blobs
		if (dbs.some(db => db.name === MEDIA_DB)) {
			const oldMediaDb = await new Promise<IDBDatabase>((resolve, reject) => {
				const req = window.indexedDB.open(MEDIA_DB);
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => reject(req.error);
			});

			if (oldMediaDb.objectStoreNames.contains(MEDIA_STORE)) {
				const blobs = await new Promise<any[]>((resolve, reject) => {
					const tx = oldMediaDb.transaction(MEDIA_STORE, 'readonly');
					const req = tx.objectStore(MEDIA_STORE).getAll();
					req.onsuccess = () => resolve(req.result);
					req.onerror = () => reject(req.error);
				});
				
				const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
					const tx = oldMediaDb.transaction(MEDIA_STORE, 'readonly');
					const req = tx.objectStore(MEDIA_STORE).getAllKeys();
					req.onsuccess = () => resolve(req.result);
					req.onerror = () => reject(req.error);
				});

				if (blobs && keys && blobs.length > 0) {
					console.log(`[Storage Migration] Found ${blobs.length} media blobs in legacy DB. Moving...`);
					for (let i = 0; i < blobs.length; i++) {
						await setStore(keys[i], blobs[i], MEDIA_BUCKET, MEDIA_DB, MEDIA_STORE);
					}
				}
			}
			oldMediaDb.close();
			window.indexedDB.deleteDatabase(MEDIA_DB);
		}

		console.log('[Storage Migration] Migration complete! Legacy DBs deleted.');
		localStorage.setItem('tumblr_buckets_migrated', 'true');
	} catch (e) {
		console.error('[Storage Migration] Failed during migration:', e);
	}
}

// Kick off migration immediately
migrateOldData();

// ─── Post Metadata ───────────────────────────────────────────────────────────

export async function getCachedPosts(): Promise<any[]> {
	if (!browser) return [];
	try {
		return (await getStore(POSTS_KEY, APP_BUCKET, APP_DB, APP_STORE)) || [];
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
		await setStore(POSTS_KEY, merged, APP_BUCKET, APP_DB, APP_STORE);
	} catch (e) {
		console.error('Failed to set cached posts', e);
	}
}

export async function removePostFromCache(postId: string | number) {
	if (!browser) return;
	try {
		const existingPosts = await getCachedPosts();
		const filtered = existingPosts.filter(p => String(p.id) !== String(postId));
		await setStore(POSTS_KEY, filtered, APP_BUCKET, APP_DB, APP_STORE);
	} catch (e) {
		console.error('Failed to remove post from cache', e);
	}
}

export async function clearCache() {
	if (!browser) return;
	await setStore(POSTS_KEY, [], APP_BUCKET, APP_DB, APP_STORE);
	await clearStore(MEDIA_BUCKET, MEDIA_DB, MEDIA_STORE);
}

// ─── Blob / Offline Media Cache ───────────────────────────────────────────────

/**
 * Returns a blob: Object URL if the media is already cached locally.
 * Returns null if not yet cached.
 */
export async function getCachedBlobUrl(url: string): Promise<{ url: string, type: string } | null> {
	if (!browser) return null;
	try {
		const blob: Blob | undefined = await getStore(url, MEDIA_BUCKET, MEDIA_DB, MEDIA_STORE);
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
		const existing: Blob | undefined = await getStore(url, MEDIA_BUCKET, MEDIA_DB, MEDIA_STORE);
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
				await setStore(url, blob, MEDIA_BUCKET, MEDIA_DB, MEDIA_STORE);
				return { url: URL.createObjectURL(blob), type: blob.type };
			} catch {
				return null;
			}
		}

		const blob = await res.blob();
		await setStore(url, blob, MEDIA_BUCKET, MEDIA_DB, MEDIA_STORE);
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
		// If Storage Buckets API is available, we can get exact quota!
		if ('storageBuckets' in navigator) {
			const nav = navigator as any;
			const bucket = await nav.storageBuckets.open(MEDIA_BUCKET, { persisted: false, durability: 'relaxed' });
			const estimate = await bucket.estimate();
			// We still need the count from IDB
			const all = await entriesStore(MEDIA_BUCKET, MEDIA_DB, MEDIA_STORE);
			return { 
				count: all.length, 
				estimatedMb: Math.round((estimate.usage || 0) / 1024 / 1024 * 10) / 10 
			};
		}

		// Fallback for browsers without Storage Buckets
		const all = await entriesStore(MEDIA_BUCKET, MEDIA_DB, MEDIA_STORE);
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
		const existing = await getStore(url, MEDIA_BUCKET, MEDIA_DB, MEDIA_STORE);
		return !!existing;
	} catch {
		return false;
	}
}
