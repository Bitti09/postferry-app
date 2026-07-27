// ─── Blobs Cache ────────────────────────────────────────────────────────────

import { browser } from '$app/environment';
import { STORES, openCacheDB, idbGet, idbTx, idbWalk, idbCount } from './db';
import type { TumblrPost } from '$lib/types';
import type { CachedPostEntry } from './posts';
import { freshEntry as postsFreshEntry } from './posts';

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

export interface StoredBlob {
	blob: Blob;
	type: string;
	postId: number;
	postMeta: BlobPostMeta;
	size: number;
	cachedAt: number;
}

export interface BlobsIndexEntry {
	bestUrl: string;
	type: string;
	postId: number;
}

export interface CachedBlobResult { url: string; type: string }
export interface MediaRef { url: string; type: string; size: number }

const RES_REGEX = /_(\d+)\.(?:jpe?g|png|gif|webp|mp4|webm|mov)/i;
const AVATAR_REGEX = /\/avatar\/(\d+)/;
const DOWNLOAD_CONCURRENCY = 6;
const LOOKUP_BATCH_SIZE = 128;
const WRITE_BATCH_SIZE = 24;

export function getMediaId(url: string): string {
	const hashMatch = url.match(/\/([a-f0-9]{32})\//);
	if (hashMatch) return hashMatch[1];
	const fnMatch = url.match(/(tumblr_[a-zA-Z0-9]+)/);
	return fnMatch?.[1] ?? url;
}

export function getResolutionScore(url: string): number {
	const match = url.match(RES_REGEX);
	if (match) return parseInt(match[1], 10);
	const avatarMatch = url.match(AVATAR_REGEX);
	return avatarMatch ? parseInt(avatarMatch[1], 10) : 0;
}

interface MemoryEntry { blob: Blob; type: string; objectUrl: string; revoked: boolean }
const memoryCache = new Map<string, MemoryEntry>();
const inFlight = new Map<string, Promise<CachedBlobResult | null>>();

function rememberBlob(url: string, blob: Blob): string {
	const existing = memoryCache.get(url);
	if (existing && !existing.revoked) return existing.objectUrl;
	const objectUrl = URL.createObjectURL(blob);
	memoryCache.set(url, { blob, type: blob.type, objectUrl, revoked: false });
	return objectUrl;
}

export function revokeBlobUrl(url: string): void {
	const entry = memoryCache.get(url);
	if (!entry || entry.revoked) return;
	URL.revokeObjectURL(entry.objectUrl);
	entry.revoked = true;
	memoryCache.delete(url);
}

export function revokeAllBlobUrls(): void {
	for (const entry of memoryCache.values()) URL.revokeObjectURL(entry.objectUrl);
	memoryCache.clear();
}

async function directGet(url: string): Promise<StoredBlob | undefined> {
	return idbGet<StoredBlob>(STORES.blobs, url);
}

async function indexGet(url: string): Promise<BlobsIndexEntry | undefined> {
	return idbGet<BlobsIndexEntry>(STORES.blobsIndex, getMediaId(url));
}

export async function isMediaCached(url: string): Promise<boolean> {
	if (!browser || !url) return false;
	if (memoryCache.get(url)?.revoked === false) return true;
	const best = await indexGet(url);
	return !!best && getResolutionScore(best.bestUrl) >= getResolutionScore(url);
}

export async function bulkIsMediaCached(urls: ReadonlyArray<string>): Promise<Set<string>> {
	const cached = new Set<string>();
	if (!browser || urls.length === 0) return cached;
	const unique = [...new Set(urls.filter(Boolean))];
	for (let i = 0; i < unique.length; i += LOOKUP_BATCH_SIZE) {
		const batch = unique.slice(i, i + LOOKUP_BATCH_SIZE);
		const found = await Promise.all(batch.map(async (url) => ({ url, entry: await indexGet(url) })));
		for (const { url, entry } of found) {
			if (memoryCache.get(url)?.revoked === false || (entry && getResolutionScore(entry.bestUrl) >= getResolutionScore(url))) cached.add(url);
		}
	}
	return cached;
}

export async function getCachedBlobUrl(url: string): Promise<CachedBlobResult | null> {
	if (!browser || !url) return null;
	const mem = memoryCache.get(url);
	if (mem && !mem.revoked) return { url: mem.objectUrl, type: mem.type };
	const best = await indexGet(url);
	if (best && getResolutionScore(best.bestUrl) >= getResolutionScore(url)) {
		const stored = await directGet(best.bestUrl);
		if (stored?.blob) return { url: rememberBlob(url, stored.blob), type: stored.type };
	}
	const stored = await directGet(url);
	return stored?.blob ? { url: rememberBlob(url, stored.blob), type: stored.type } : null;
}
export async function getMediaForPost(postId: number): Promise<MediaRef[]> {
	if (!browser || !Number.isFinite(postId)) return [];
	const keys = await blobKeysForPost(postId);
	const out: MediaRef[] = [];
	for (let i = 0; i < keys.length; i += LOOKUP_BATCH_SIZE) {
		const rows = await Promise.all(keys.slice(i, i + LOOKUP_BATCH_SIZE).map(async (key) => ({ key, row: await directGet(String(key)) })));
		for (const { key, row } of rows) {
			if (row?.blob) out.push({ url: String(key), type: row.type, size: row.blob.size });
		}
	}
	return out;
}

async function blobKeysForPost(postId: number): Promise<IDBValidKey[]> {
	const db = await openCacheDB();
	return new Promise<IDBValidKey[]>((resolve, reject) => {
		const tx = db.transaction(STORES.blobs, 'readonly');
		const req = tx.objectStore(STORES.blobs).index('byPost').getAllKeys(IDBKeyRange.only(postId));
		req.onsuccess = () => resolve(req.result ?? []);
		tx.onerror = () => reject(tx.error ?? new Error('blobKeysForPost failed'));
	});
}

export async function clearMediaForPost(postId: number): Promise<number> {
	if (!browser || !Number.isFinite(postId)) return 0;
	const keys = await blobKeysForPost(postId);
	if (keys.length === 0) return 0;
	await idbTx(keys.flatMap((key) => [
		{ store: STORES.blobs, op: 'delete' as const, key },
		{ store: STORES.blobsIndex, op: 'delete' as const, key: getMediaId(String(key)) }
	]));
	return keys.length;
}

export async function gcOrphanBlobs(validPostIds: ReadonlySet<number>): Promise<{ deletedBlobs: number; deletedIndex: number }> {
	if (!browser) return { deletedBlobs: 0, deletedIndex: 0 };
	const orphans: Array<{ url: string; mediaId: string }> = [];
	await idbWalk<StoredBlob>(STORES.blobs, (row, key) => {
		if (!validPostIds.has(row.postId)) orphans.push({ url: String(key), mediaId: getMediaId(String(key)) });
	});
	for (let i = 0; i < orphans.length; i += WRITE_BATCH_SIZE) {
		await idbTx(orphans.slice(i, i + WRITE_BATCH_SIZE).flatMap(({ url, mediaId }) => [
			{ store: STORES.blobs, op: 'delete' as const, key: url },
			{ store: STORES.blobsIndex, op: 'delete' as const, key: mediaId }
		]));
	}
	return { deletedBlobs: orphans.length, deletedIndex: orphans.length };
}

export async function getMediaCacheStats(): Promise<{ count: number; estimatedMb: number }> {
	if (!browser) return { count: 0, estimatedMb: 0 };
	const count = await idbCount(STORES.blobs);
	let totalBytes = 0;
	await idbWalk<StoredBlob>(STORES.blobs, (row) => { totalBytes += row.blob?.size ?? 0; });
	return { count, estimatedMb: Math.round((totalBytes / 1024 / 1024) * 10) / 10 };
}

function postMeta(meta: SlimMediaMeta): BlobPostMeta {
	if (meta.post) return {
		id: meta.post.id,
		blogName: meta.post.blog_name,
		timestamp: meta.post.timestamp,
		summary: meta.post.summary ?? '',
		type: meta.post.type,
		tags: meta.post.tags ?? []
	};
	if (meta.postMeta) return meta.postMeta;
	return { id: meta.postId, blogName: meta.blogName, timestamp: meta.timestamp, summary: '', type: 'text', tags: [] };
}

function mergePost(existing: CachedPostEntry | undefined, post: TumblrPost, blogName: string): CachedPostEntry {
	if (!existing) return postsFreshEntry(post, blogName);
	return { ...existing, post, cachedAt: Date.now(), cachedFromBlog: existing.cachedFromBlog || blogName };
}

async function fetchBlob(url: string): Promise<Blob | null> {
	try {
		const proxy = await fetch(`/api/media/proxy?url=${encodeURIComponent(url)}`);
		if (proxy.ok) return await proxy.blob();
		if (proxy.status === 403 || proxy.status === 404) return null;
		const fallback = await fetch(url);
		return fallback.ok ? await fallback.blob() : null;
	} catch (error) {
		console.error('Failed to cache media:', url, error);
		return null;
	}
}

async function storeFetchedBatch(items: Array<{ url: string; blob: Blob; meta: SlimMediaMeta }>): Promise<void> {
	const ops: Parameters<typeof idbTx>[0][number][] = [];
	for (const { url, blob, meta } of items) {
		const mediaId = getMediaId(url);
		const existingIndex = await idbGet<BlobsIndexEntry>(STORES.blobsIndex, mediaId);
		const useExisting = existingIndex && getResolutionScore(existingIndex.bestUrl) >= getResolutionScore(url);
		const stored: StoredBlob = { blob, type: blob.type, postId: meta.postId, postMeta: postMeta(meta), size: blob.size, cachedAt: Date.now() };
		ops.push({ store: STORES.blobs, op: 'put', key: url, value: stored });
		ops.push({ store: STORES.blobsIndex, op: 'put', key: mediaId, value: useExisting ? existingIndex : { bestUrl: url, type: blob.type, postId: meta.postId } });
		if (meta.post) {
			const existing = await idbGet<CachedPostEntry>(STORES.posts, meta.post.id);
			ops.push({ store: STORES.posts, op: 'put', key: meta.post.id, value: mergePost(existing, meta.post, meta.blogName) });
		}
	}
	await idbTx(ops);
}

export async function downloadAndCacheMedia(url: string, meta?: SlimMediaMeta): Promise<CachedBlobResult | null> {
	if (!browser || !url || !meta) return null;
	const cached = await getCachedBlobUrl(url);
	if (cached) return cached;
	if (inFlight.has(url)) return inFlight.get(url)!;
	const promise = (async () => {
		const blob = await fetchBlob(url);
		if (!blob) return null;
		await storeFetchedBatch([{ url, blob, meta }]);
		return { url: rememberBlob(url, blob), type: blob.type };
	})();
	inFlight.set(url, promise);
	try { return await promise; } finally { inFlight.delete(url); }
}

export async function bulkCacheMedia(items: ReadonlyArray<{ url: string; meta: SlimMediaMeta }>): Promise<void> {
	if (!browser || items.length === 0) return;
	const unique = [...new Map(items.filter((item) => item.url && item.meta).map((item) => [item.url, item])).values()];
	const cached = await bulkIsMediaCached(unique.map((item) => item.url));
	const pending = unique.filter((item) => !cached.has(item.url));
	for (let i = 0; i < pending.length; i += WRITE_BATCH_SIZE) {
		const chunk = pending.slice(i, i + WRITE_BATCH_SIZE);
		const fetched: Array<{ url: string; blob: Blob; meta: SlimMediaMeta }> = [];
		for (let j = 0; j < chunk.length; j += DOWNLOAD_CONCURRENCY) {
			const wave = chunk.slice(j, j + DOWNLOAD_CONCURRENCY);
			const results = await Promise.all(wave.map(async (item) => ({ ...item, blob: await fetchBlob(item.url) })));
			for (const result of results) if (result.blob) fetched.push({ url: result.url, blob: result.blob, meta: result.meta });
		}
		if (fetched.length) await storeFetchedBatch(fetched);
	}
}
export { clearMediaCache } from './clear';
