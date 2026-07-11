import { browser } from '$app/environment';

// Request persistent storage permission for the origin
if (browser && navigator.storage && navigator.storage.persist) {
	navigator.storage.persist().then(granted => {
		console.log(`[Storage] Origin persistence granted: ${granted}`);
	});
}

// ─── Custom Bucket-Aware IDB Wrapper ───────────────────────────────────────

const dbCache = new Map<string, Promise<IDBDatabase>>();

export async function getDB(bucketName: string, dbName: string, storeName: string): Promise<IDBDatabase> {
	const cacheKey = `${bucketName}:${dbName}:${storeName}`;
	let dbPromise = dbCache.get(cacheKey);

	if (!dbPromise) {
		dbPromise = new Promise(async (resolve, reject) => {
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
				req.onsuccess = () => {
					const db = req.result;
					db.onclose = () => {
						dbCache.delete(cacheKey);
					};
					resolve(db);
				};
				req.onerror = () => {
					dbCache.delete(cacheKey);
					reject(req.error);
				};
			} catch (e) {
				dbCache.delete(cacheKey);
				reject(e);
			}
		});
		dbCache.set(cacheKey, dbPromise);
	}

	return dbPromise;
}

export function withStore(type: IDBTransactionMode, bucketName: string, dbName: string, storeName: string, callback: (store: IDBObjectStore) => IDBRequest | void): Promise<any> {
	return getDB(bucketName, dbName, storeName).then(db => {
		return new Promise((resolve, reject) => {
			const transaction = db.transaction(storeName, type);
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

export async function getStore(key: IDBValidKey, b: string, d: string, s: string): Promise<any> {
	return withStore('readonly', b, d, s, store => store.get(key));
}

export async function setStore(key: IDBValidKey, value: any, b: string, d: string, s: string): Promise<void> {
	return withStore('readwrite', b, d, s, store => { store.put(value, key); });
}

export async function clearStore(b: string, d: string, s: string): Promise<void> {
	return withStore('readwrite', b, d, s, store => { store.clear(); });
}

export async function countStore(b: string, d: string, s: string): Promise<number> {
	return withStore('readonly', b, d, s, store => store.count());
}

export async function keysStore(b: string, d: string, s: string): Promise<string[]> {
	return withStore('readonly', b, d, s, store => store.getAllKeys() as any);
}

export async function deleteStore(key: IDBValidKey, b: string, d: string, s: string): Promise<void> {
	return withStore('readwrite', b, d, s, store => { store.delete(key); });
}

export async function entriesStore(b: string, d: string, s: string): Promise<[IDBValidKey, any][]> {
	const db = await getDB(b, d, s);
	return new Promise((resolve, reject) => {
		const tx = db.transaction(s, 'readonly');
		const results: [IDBValidKey, any][] = [];
		tx.objectStore(s).openCursor().onsuccess = (event: any) => {
			const cursor = event.target.result;
			if (cursor) {
				results.push([cursor.key, cursor.value]);
				cursor.continue();
			}
		};
		tx.oncomplete = () => { resolve(results); };
		tx.onerror = () => reject(tx.error);
	});
}

// ─── Store Configurations ───────────────────────────────────────────────────

const APP_BUCKET = 'tumblr-app-state';
const APP_DB = 'keyval-store';
const APP_STORE = 'keyval';
const POSTS_KEY = 'tumblr_cached_posts';
const ACCOUNTS_KEY = 'tumblr_cached_accounts';

const MEDIA_BUCKET = 'tumblr-media-cache';
const MEDIA_DB = 'tumblr-media-blobs';
const MEDIA_STORE = 'blobs';

// ─── Account Settings ───────────────────────────────────────────────────────

export async function getCachedAccounts(): Promise<any[]> {
	if (!browser) return [];
	try {
		return (await getStore(ACCOUNTS_KEY, APP_BUCKET, APP_DB, APP_STORE)) || [];
	} catch (e) {
		console.error('Failed to get cached accounts', e);
		return [];
	}
}

export async function setCachedAccounts(accounts: any[]) {
	if (!browser) return;
	try {
		await setStore(ACCOUNTS_KEY, accounts, APP_BUCKET, APP_DB, APP_STORE);
	} catch (e) {
		console.error('Failed to set cached accounts', e);
	}
}

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

// Re-export helpers from mediaCache so caches page can revoke URLs.
export { clearMediaCache } from './mediaCache';

// ─── Blob / Offline Media Cache ───────────────────────────────────────────────

/**
 * Returns a blob: Object URL if the media is already cached locally.
 * Returns null if not yet cached.
 */
function getMediaId(url: string): string {
	// Look for the directory hash (32-character hex string)
	const hashMatch = url.match(/\/([a-f0-9]{32})\//);
	if (hashMatch) return hashMatch[1];
	
	// Fallback: look for the tumblr_ prefix filename
	const fnMatch = url.match(/(tumblr_[a-zA-Z0-9]+)/);
	if (fnMatch) return fnMatch[1];
	
	return url;
}

function getResolutionScore(url: string): number {
	const match = url.match(/_(\d+)\.(?:jpe?g|png|gif|webp|mp4|webm)/i);
	if (match) return parseInt(match[1], 10);
	
	const avatarMatch = url.match(/\/avatar\/(\d+)/);
	if (avatarMatch) return parseInt(avatarMatch[1], 10);
	
	return 0;
}

/**
 * Returns a blob: Object URL if the media is already cached locally.
 * Returns null if not yet cached.
 */
export async function getCachedBlobUrl(url: string): Promise<{ url: string, type: string } | null> {
	if (!browser) return null;
	try {
		const mediaId = getMediaId(url);
		const reqScore = getResolutionScore(url);
		const keys = await keysStore(MEDIA_BUCKET, MEDIA_DB, MEDIA_STORE);
		let bestKey: string | null = null;
		let bestScore = -1;

		for (const key of keys) {
			const keyStr = key as string;
			if (getMediaId(keyStr) === mediaId) {
				const score = getResolutionScore(keyStr);
				if (score > bestScore) {
					bestScore = score;
					bestKey = keyStr;
				}
			}
		}

		if (bestKey) {
			const item: any = await getStore(bestKey, MEDIA_BUCKET, MEDIA_DB, MEDIA_STORE);
			if (item) {
				const blob = item.blob || item;
				return { url: URL.createObjectURL(blob), type: blob.type };
			}
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Returns all blobs currently stored in the media cache as object URLs.
 */
export async function getAllCachedMedia(): Promise<{ originalUrl: string, url: string, type: string, timestamp?: number, post?: any }[]> {
	if (!browser) return [];
	try {
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
 * Downloads a media URL and saves it as a Blob in IndexedDB.
 * Returns the local Object URL on success, null on failure.
 */
export async function downloadAndCacheMedia(url: string, meta?: { timestamp: number, post?: any }): Promise<{ url: string, type: string, errorStatus?: number } | null> {
	if (!browser) return null;
	try {
		const mediaId = getMediaId(url);
		const reqScore = getResolutionScore(url);
		const cleanMeta = meta ? JSON.parse(JSON.stringify(meta)) : undefined;

		const keys = await keysStore(MEDIA_BUCKET, MEDIA_DB, MEDIA_STORE);
		let bestKey: string | null = null;
		let bestScore = -1;

		for (const key of keys) {
			const keyStr = key as string;
			if (getMediaId(keyStr) === mediaId) {
				const score = getResolutionScore(keyStr);
				if (score > bestScore) {
					bestScore = score;
					bestKey = keyStr;
				}
			}
		}

		if (bestKey && bestScore >= reqScore) {
			const existing: any = await getStore(bestKey, MEDIA_BUCKET, MEDIA_DB, MEDIA_STORE);
			if (existing) {
				const existingBlob = existing.blob || existing;
				const isCleanMetaLegacy = existing instanceof Blob || !existing.blob;
				if (cleanMeta && (!existing.post || isCleanMetaLegacy)) {
					const mergedMeta = isCleanMetaLegacy ? cleanMeta : { ...existing, ...cleanMeta };
					await setStore(bestKey, { blob: existingBlob, ...mergedMeta }, MEDIA_BUCKET, MEDIA_DB, MEDIA_STORE);
				}
				return { url: URL.createObjectURL(existingBlob), type: existingBlob.type };
			}
		}

		// Use our server-side proxy to avoid 403 Forbidden/CORS issues
		const proxyUrl = `/api/media/proxy?url=${encodeURIComponent(url)}`;
		const res = await fetch(proxyUrl);
		let responseToUse = res;
		
		if (!res.ok) {
			if (res.status === 403 || res.status === 404) {
				return { url: '', type: '', errorStatus: res.status };
			}
			try {
				const fallback = await fetch(url);
				if (!fallback.ok) {
					if (fallback.status === 403 || fallback.status === 404) {
						return { url: '', type: '', errorStatus: fallback.status };
					}
					return null;
				}
				responseToUse = fallback;
			} catch {
				return null;
			}
		}

		const blob = await responseToUse.blob();
		const dataToStore = cleanMeta ? { blob, ...cleanMeta } : blob;
		await setStore(url, dataToStore, MEDIA_BUCKET, MEDIA_DB, MEDIA_STORE);

		if (bestKey && bestKey !== url) {
			await deleteStore(bestKey, MEDIA_BUCKET, MEDIA_DB, MEDIA_STORE);
		}

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
			const [estimate, count] = await Promise.all([
				bucket.estimate(),
				countStore(MEDIA_BUCKET, MEDIA_DB, MEDIA_STORE)
			]);
			return { 
				count, 
				estimatedMb: Math.round((estimate.usage || 0) / 1024 / 1024 * 10) / 10 
			};
		}

		// Fallback for browsers without Storage Buckets
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

// ─── Avatar Caching ──────────────────────────────────────────────────────────

const AVATAR_BUCKET = 'tumblr-media-cache';
const AVATAR_DB = 'tumblr-avatars';
const AVATAR_STORE = 'avatars';

const inFlightAvatars = new Map<string, Promise<string>>();
const FALLBACK_AVATAR = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%234b5563"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';

export async function getCachedAvatar(blogName: string, size: number = 512): Promise<string> {
	if (!browser) return FALLBACK_AVATAR;
	
	const cacheKey = `${blogName}_${size}`;
	
	// Deduplicate concurrent requests for the exact same avatar
	if (inFlightAvatars.has(cacheKey)) {
		return inFlightAvatars.get(cacheKey)!;
	}

	const promise = (async () => {
		try {
			const keys = await keysStore(AVATAR_BUCKET, AVATAR_DB, AVATAR_STORE);
			let bestKey: string | null = null;
			let bestSize = -1;
			
			for (const key of keys) {
				const keyStr = key as string;
				if (keyStr.startsWith(`${blogName}_`)) {
					const s = parseInt(keyStr.substring(blogName.length + 1), 10);
					if (s > bestSize) {
						bestSize = s;
						bestKey = keyStr;
					}
				}
			}

			if (bestKey && bestSize >= size) {
				const cachedBlob = await getStore(bestKey, AVATAR_BUCKET, AVATAR_DB, AVATAR_STORE);
				if (cachedBlob) {
					return URL.createObjectURL(cachedBlob);
				}
			}

			// Stagger requests slightly to prevent 50 simultaneous connections tripping the DDoS limit
			await new Promise(r => setTimeout(r, Math.random() * 400));

			const fullBlogName = blogName.includes('.') ? blogName : `${blogName}.tumblr.com`;
			const response = await fetch(`https://api.tumblr.com/v2/blog/${fullBlogName}/avatar/${size}`);
			
			if (response.status === 429) {
				console.warn(`[Rate Limit] Avatar fetch for ${blogName} hit 429. Using fallback.`);
				if (bestKey) {
					const cachedBlob = await getStore(bestKey, AVATAR_BUCKET, AVATAR_DB, AVATAR_STORE);
					if (cachedBlob) return URL.createObjectURL(cachedBlob);
				}
				return FALLBACK_AVATAR;
			}
			if (!response.ok) throw new Error(`Avatar fetch failed with status ${response.status}`);
			
			const blob = await response.blob();
			await setStore(cacheKey, blob, AVATAR_BUCKET, AVATAR_DB, AVATAR_STORE);

			if (bestKey && bestKey !== cacheKey) {
				await deleteStore(bestKey, AVATAR_BUCKET, AVATAR_DB, AVATAR_STORE);
			}

			return URL.createObjectURL(blob);
		} catch (e) {
			console.error(`Failed to cache avatar for ${blogName}`, e);
			return FALLBACK_AVATAR;
		} finally {
			inFlightAvatars.delete(cacheKey);
		}
	})();

	inFlightAvatars.set(cacheKey, promise);
	return promise;
}

// Re-export the shared, memoized helpers so existing imports keep working.
// Prefer importing from '$lib/mediaUrls' directly in new code.
export {
	extractMedia,
	getAllMediaUrls,
	getPrimaryMediaUrl,
	getVideoUrls,
	getImageUrls
} from '$lib/mediaUrls';

export async function isMediaCached(url: string): Promise<boolean> {
	if (!browser) return false;
	try {
		const mediaId = getMediaId(url);
		const reqScore = getResolutionScore(url);
		const keys = await keysStore(MEDIA_BUCKET, MEDIA_DB, MEDIA_STORE);
		
		for (const key of keys) {
			const keyStr = key as string;
			if (getMediaId(keyStr) === mediaId) {
				const score = getResolutionScore(keyStr);
				if (score >= reqScore) {
					return true;
				}
			}
		}
		return false;
	} catch {
		return false;
	}
}

/**
 * Check which URLs are cached in a single IDB transaction.
 * Much faster than calling isMediaCached() once per URL when you have many.
 */
export async function bulkIsMediaCached(urls: string[]): Promise<Set<string>> {
	if (!browser || urls.length === 0) return new Set();
	try {
		const keys = await keysStore(MEDIA_BUCKET, MEDIA_DB, MEDIA_STORE);
		
		const idToScore = new Map<string, number>();
		for (const key of keys) {
			const keyStr = key as string;
			const id = getMediaId(keyStr);
			const score = getResolutionScore(keyStr);
			const existingScore = idToScore.get(id) ?? -1;
			if (score > existingScore) {
				idToScore.set(id, score);
			}
		}
		
		const found = new Set<string>();
		for (const url of urls) {
			const id = getMediaId(url);
			const reqScore = getResolutionScore(url);
			const cachedScore = idToScore.get(id);
			if (cachedScore !== undefined && cachedScore >= reqScore) {
				found.add(url);
			}
		}
		
		return found;
	} catch {
		return new Set();
	}
}

/**
 * Returns metadata for all cached media without loading blob data.
 * Use for grid/list views; fetch actual blobs on demand.
 */
export async function getAllCachedMediaMeta(): Promise<
	{ originalUrl: string; type: string; timestamp?: number; post?: any }[]
> {
	if (!browser) return [];
	try {
		const all = await entriesStore(MEDIA_BUCKET, MEDIA_DB, MEDIA_STORE);
		return all.map(([key, item]: [IDBValidKey, any]) => {
			const blob = item.blob || item;
			return {
				originalUrl: key as string,
				type: blob.type || 'unknown',
				timestamp: item.timestamp,
				post: item.post
			};
		});
	} catch (e) {
		console.error('Failed to get cached media meta:', e);
		return [];
	}
}

// ─── Blog Info Cache ───────────────────────────────────────────────────────────

export interface CachedBlogInfo {
	share_likes: boolean;
	likes?: number;
	updated?: number;
	cachedAt: number;
}

export async function getCachedBlogInfo(blogName: string): Promise<CachedBlogInfo | null> {
	if (!browser) return null;
	try {
		return await getStore(`blog_info_${blogName}`, APP_BUCKET, APP_DB, APP_STORE);
	} catch (e) {
		console.error(`Failed to get cached blog info for ${blogName}`, e);
		return null;
	}
}

export async function setCachedBlogInfo(blogName: string, info: CachedBlogInfo) {
	if (!browser) return;
	try {
		await setStore(`blog_info_${blogName}`, info, APP_BUCKET, APP_DB, APP_STORE);
	} catch (e) {
		console.error(`Failed to set cached blog info for ${blogName}`, e);
	}
}

// ─── Followed Blogs Cache ──────────────────────────────────────────────────────

export async function getCachedFollowedBlogs(): Promise<any[]> {
	if (!browser) return [];
	try {
		return (await getStore('tumblr_followed_blogs', APP_BUCKET, APP_DB, APP_STORE)) || [];
	} catch (e) {
		console.error('Failed to get cached followed blogs', e);
		return [];
	}
}

export async function setCachedFollowedBlogs(blogs: any[]) {
	if (!browser) return;
	try {
		await setStore('tumblr_followed_blogs', blogs, APP_BUCKET, APP_DB, APP_STORE);
	} catch (e) {
		console.error('Failed to set cached followed blogs', e);
	}
}
