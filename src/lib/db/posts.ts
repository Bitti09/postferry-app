// ─── Post Metadata Persistence ───────────────────────────────────────────────
// Stores deduplicated post metadata (not blobs). Typed against TumblrPost.

import { isBrowser, getStore, setStore, clearStore, type BucketConfig } from './idb';
import type { TumblrPost } from '$lib/types';

const APP_BUCKET: BucketConfig = {
	bucketName: 'tumblr-app-state',
	dbName: 'keyval-store',
	storeName: 'keyval'
};

const POSTS_KEY = 'tumblr_cached_posts';

export async function loadCachedPosts(): Promise<TumblrPost[]> {
	if (!isBrowser()) return [];
	try {
		const raw = await getStore<unknown>(APP_BUCKET, POSTS_KEY);
		if (!raw || !Array.isArray(raw)) return [];
		return raw.filter(isValidPost);
	} catch {
		return [];
	}
}

export async function mergePostsIntoCache(newPosts: TumblrPost[]): Promise<void> {
	if (!isBrowser() || newPosts.length === 0) return;
	const existing = await loadCachedPosts();
	const map = new Map<number, TumblrPost>();
	for (const p of existing) map.set(p.id, p);
	for (const p of newPosts) map.set(p.id, p);
	const merged = Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp);
	try {
		await setStore(APP_BUCKET, POSTS_KEY, merged);
	} catch (e) {
		console.error('Failed to persist posts:', e);
	}
}

export async function removePostFromCache(postId: string | number): Promise<void> {
	if (!isBrowser()) return;
	const existing = await loadCachedPosts();
	const filtered = existing.filter((p) => String(p.id) !== String(postId));
	try {
		await setStore(APP_BUCKET, POSTS_KEY, filtered);
	} catch (e) {
		console.error('Failed to remove post:', e);
	}
}

export async function clearPostCache(): Promise<void> {
	if (!isBrowser()) return;
	try {
		await setStore(APP_BUCKET, POSTS_KEY, []);
	} catch (e) {
		console.error('Failed to clear post cache:', e);
	}
}

function isValidPost(item: unknown): item is TumblrPost {
	if (!item || typeof item !== 'object') return false;
	const p = item as Record<string, unknown>;
	return typeof p.id === 'number' && typeof p.blog_name === 'string' && typeof p.timestamp === 'number';
}
