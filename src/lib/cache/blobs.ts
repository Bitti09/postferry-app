import { browser } from '$app/env';
import type { TumblrPost } from '#lib/types';
import { db, mediaAssetBase } from './newDb';
import {
	readMediaFile,
	deleteMediaFile,
	listMediaFiles
} from '#lib/mediaFiles';
import { cachedMediaUrls, dropCachedUrl } from '../mediaCacheStatus.svelte.ts';

export interface BlobPostMeta {
	id: string;
	blogName: string;
	timestamp: number;
	summary: string;
	type: TumblrPost['type'];
	tags: string[];
}

export interface SlimMediaMeta {
	postId: string;
	blogName: string;
	timestamp: number;
	post?: TumblrPost;
	postMeta?: BlobPostMeta;
}

export interface MediaRef { url: string; type: string; size: number }

/** Record a media URL in the index once its file is on disk. */
export async function indexStoredMedia(
	url: string,
	postId: string,
	type: string,
	size: number
): Promise<void> {
	await db.mediaUrls.put({
		url,
		postId,
		type,
		cachedAt: Date.now(),
		size,
		base: mediaAssetBase(url)
	});
}

export async function isMediaCached(url: string): Promise<boolean> {
	if (!browser || !url) return false;
	if (cachedMediaUrls.has(url)) return true;
	return (await readMediaFile(url)) !== null;
}

export async function bulkIsMediaCached(urls: ReadonlyArray<string>): Promise<Set<string>> {
	const cached = new Set<string>();
	if (!browser || urls.length === 0) return cached;
	const unique = [...new Set(urls.filter(Boolean))];

	for (const url of unique) {
		if (cachedMediaUrls.has(url)) cached.add(url);
	}

	const unknown = unique.filter((url) => !cached.has(url));
	if (unknown.length === 0) return cached;

	// OPFS stat per unknown URL; chunk so a 10k-url page load does not open
	// 10k directory handles at once.
	const CHUNK = 64;
	for (let i = 0; i < unknown.length; i += CHUNK) {
		const chunk = unknown.slice(i, i + CHUNK);
		await Promise.all(chunk.map(async (url) => {
			if (await readMediaFile(url)) {
				cached.add(url);
				cachedMediaUrls.add(url);
			}
		}));
	}

	return cached;
}

export async function getMediaForPost(postId: string | number): Promise<MediaRef[]> {
	if (!browser) return [];
	const key = String(postId);
	if (!key) return [];
	const rows = await db.mediaUrls.where('postId').equals(key).toArray();

	const out: MediaRef[] = [];
	for (const row of rows) {
		const file = await readMediaFile(row.url);
		if (file) out.push({ url: row.url, type: row.type, size: file.size });
	}
	return out;
}

export async function clearMediaForPost(postId: string | number): Promise<number> {
	if (!browser) return 0;
	const key = String(postId);
	if (!key) return 0;
	const rows = await db.mediaUrls.where('postId').equals(key).toArray();
	if (rows.length === 0) return 0;

	for (const row of rows) {
		await deleteMediaFile(row.url);
		dropCachedUrl(row.url);
	}
	await db.mediaUrls.bulkDelete(rows.map((row) => row.url));
	return rows.length;
}

export async function gcOrphanBlobs(validPostIds: ReadonlySet<string>): Promise<{ deletedBlobs: number; deletedIndex: number }> {
	if (!browser) return { deletedBlobs: 0, deletedIndex: 0 };

	const orphans: string[] = [];
	await db.mediaUrls.each((row) => {
		// postId '0' marks media migrated from Cache Storage whose post could not
		// be identified; keep it until LRU eviction rather than deleting blind.
		if (row.postId === '0') return;
		if (!validPostIds.has(row.postId)) orphans.push(row.url);
	});

	let deletedBlobs = 0;
	for (const url of orphans) {
		if (await deleteMediaFile(url)) deletedBlobs++;
		dropCachedUrl(url);
	}

	await db.mediaUrls.bulkDelete(orphans);
	return { deletedBlobs, deletedIndex: orphans.length };
}

export async function getMediaCacheStats(): Promise<{ count: number; estimatedMb: number }> {
	if (!browser) return { count: 0, estimatedMb: 0 };

	const files = await listMediaFiles();
	const bytes = files.reduce((sum, file) => sum + file.size, 0);
	return {
		count: files.length,
		estimatedMb: Math.round((bytes / 1024 / 1024) * 10) / 10
	};
}

export { clearMediaCache } from './clear';
