import { browser } from '$app/environment';
import type { TumblrPost, TumblrNote } from '$lib/types';
import type { PostFilter } from '$lib/types';
import { matchesFilter } from '$lib/postFilter';
import Dexie from 'dexie';
import { db, type CachedPostEntry, type NoteTotals } from './newDb';

export type { CachedPostEntry, NoteTotals };

export function freshEntry(post: TumblrPost, cachedFromBlog: string): CachedPostEntry {
	return {
		id: Number(post.id),
		post,
		cachedAt: Date.now(),
		cachedFromBlog,
		likedBy: {},
		rebloggedBy: {},
		sortTimestamp: post.liked_timestamp || Date.now()
	};
}

export function buildEntryFromApi(
	post: TumblrPost,
	accountBlogName: string,
	liked: boolean,
	reblogged: boolean,
	existing?: CachedPostEntry | null
): CachedPostEntry {
	const likedBy: Record<string, boolean> = { ...(existing?.likedBy ?? {}) };
	const rebloggedBy: Record<string, boolean> = { ...(existing?.rebloggedBy ?? {}) };
	if (accountBlogName) {
		likedBy[accountBlogName] = liked;
		rebloggedBy[accountBlogName] = reblogged;
	}
	return {
		id: Number(post.id),
		post,
		cachedAt: Date.now(),
		cachedFromBlog: accountBlogName || existing?.cachedFromBlog || post.blog_name,
		likedBy,
		rebloggedBy,
		notes: existing?.notes,
		noteTotals: existing?.noteTotals
	};
}

export async function getCachedPostById(postId: number | string): Promise<CachedPostEntry | null> {
	if (!browser) return null;
	const result = await db.posts.get(Number(postId));
	return result || null;
}

export interface PostsPageRequest {
	limit: number;
	before?: { cachedAt: number; id: number; sortTimestamp?: number }; // KeysetCursor equivalent
	blog?: string;
	filter?: PostFilter;
	sourceFilter?: 'all' | 'faves' | 'blogs';
}

export interface PostsPage {
	entries: CachedPostEntry[];
	total: number;
	nextCursor: { cachedAt: number; id: number; sortTimestamp?: number } | null;
}

export async function getCachedPostsPage(opts: PostsPageRequest): Promise<PostsPage> {
	if (!browser) return { entries: [], total: 0, nextCursor: null };
	const limit = Math.max(0, opts.limit);
	
	let collection = db.posts.orderBy('cachedAt').reverse();
	if (opts.sourceFilter === 'faves') {
		collection = db.posts.orderBy('sortTimestamp').reverse();
	}

	if (opts.blog) {
		collection = db.posts.where('[cachedFromBlog+cachedAt]')
			.between([opts.blog, Dexie.minKey], [opts.blog, Dexie.maxKey])
			.reverse();
	}
	
	const total = await (opts.blog ? db.posts.where('cachedFromBlog').equals(opts.blog).count() : db.posts.count());
	
	if (limit === 0) {
		return { entries: [], total, nextCursor: null };
	}

	let query = collection;
	if (opts.before) {
		if (opts.blog) {
			query = db.posts.where('[cachedFromBlog+cachedAt]')
				.between([opts.blog, Dexie.minKey], [opts.blog, opts.before.cachedAt], false, false) // exclusive upper bound
				.reverse();
		} else if (opts.sourceFilter === 'faves') {
			query = db.posts.where('sortTimestamp').below(opts.before.sortTimestamp ?? opts.before.cachedAt).reverse();
		} else {
			query = db.posts.where('cachedAt').below(opts.before.cachedAt).reverse();
		}
	}

	const rawEntries = await query.toArray();
	const entries: CachedPostEntry[] = [];
	
	for (const row of rawEntries) {
		if (opts.filter && opts.filter !== 'all' && !matchesFilter(row.post, opts.filter)) continue;
		
		if (opts.sourceFilter && opts.sourceFilter !== 'all') {
			const isFave = (row.likedBy && Object.values(row.likedBy).includes(true)) || row.post.liked === true;
			if (opts.sourceFilter === 'faves' && !isFave) continue;
			if (opts.sourceFilter === 'blogs' && isFave) continue;
		}

		entries.push(row);
		if (entries.length >= limit) break;
	}

	const nextCursor = entries.length === limit && entries.length > 0
		? { 
			cachedAt: entries[entries.length - 1].cachedAt, 
			id: entries[entries.length - 1].id,
			sortTimestamp: entries[entries.length - 1].sortTimestamp 
		  }
		: null;

	return { entries, total, nextCursor };
}

export interface BulkSetOpts {
	likedBy?: Record<string, Record<string, boolean>>;
	rebloggedBy?: Record<string, Record<string, boolean>>;
	accountBlogName?: string;
}

export async function bulkSetPosts(
	posts: TumblrPost[],
	opts: BulkSetOpts = {}
): Promise<void> {
	if (!browser || posts.length === 0) return;
	const valid = posts.filter((p) => Number.isFinite(p?.id));
	if (valid.length === 0) return;

	await db.transaction('rw', db.posts, async () => {
		const now = Date.now();
		const keys = valid.map((p) => Number(p.id));
		const existingArr = await db.posts.bulkGet(keys);
		const toPut: CachedPostEntry[] = [];

		for (let i = 0; i < valid.length; i++) {
			const post = valid[i];
			const id = Number(post.id);
			const prior = existingArr[i];

			const likedBy: Record<string, boolean> = { ...(prior?.likedBy ?? {}) };
			const rebloggedBy: Record<string, boolean> = { ...(prior?.rebloggedBy ?? {}) };
			
			const likeUpdate = opts.likedBy?.[id];
			if (likeUpdate) {
				for (const [blog, val] of Object.entries(likeUpdate)) {
					if (val) likedBy[blog] = true;
					else delete likedBy[blog];
				}
			}
			
			const reblogUpdate = opts.rebloggedBy?.[id];
			if (reblogUpdate) {
				for (const [blog, val] of Object.entries(reblogUpdate)) {
					if (val) rebloggedBy[blog] = true;
					else delete rebloggedBy[blog];
				}
			}

			if (opts.accountBlogName) {
				likedBy[opts.accountBlogName] = likedBy[opts.accountBlogName] ?? false;
				rebloggedBy[opts.accountBlogName] = rebloggedBy[opts.accountBlogName] ?? false;
			}
			
			const entry: CachedPostEntry = prior
				? {
						...prior,
						post,
						cachedAt: now,
						cachedFromBlog: prior.cachedFromBlog || post.blog_name || opts.accountBlogName || '',
						likedBy,
						rebloggedBy,
						sortTimestamp: post.liked_timestamp || prior.sortTimestamp || now
					}
				: {
						id,
						post,
						cachedAt: now,
						cachedFromBlog: post.blog_name || opts.accountBlogName || '',
						likedBy,
						rebloggedBy,
						sortTimestamp: post.liked_timestamp || now
					};
			toPut.push(entry);
		}
		await db.posts.bulkPut(JSON.parse(JSON.stringify(toPut)));
	});
}

export async function removeCachedPost(postId: number | string): Promise<void> {
	if (!browser) return;
	await db.posts.delete(Number(postId));
}

export async function clearPostsForBlog(blog: string): Promise<number> {
	if (!browser) return 0;
	return await db.transaction('rw', db.posts, async () => {
		const keys = await db.posts.where('cachedFromBlog').equals(blog).primaryKeys();
		await db.posts.bulkDelete(keys);
		return keys.length;
	});
}

export async function clearPosts(ids: ReadonlyArray<number | string>): Promise<number> {
	if (!browser || ids.length === 0) return 0;
	const keys = [...new Set(ids.map(Number))].filter(Number.isFinite);
	if (keys.length === 0) return 0;
	await db.posts.bulkDelete(keys);
	return keys.length;
}

export async function clearAllPosts(): Promise<void> {
	if (!browser) return;
	await db.posts.clear();
}

export async function mergePostMeta(
	postId: number | string,
	updater: (entry: CachedPostEntry | null) => CachedPostEntry | null
): Promise<void> {
	if (!browser) return;
	const key = Number(postId);
	await db.transaction('rw', db.posts, async () => {
		const existing = await db.posts.get(key) || null;
		const next = updater(existing);
		if (next === null || next === undefined) {
			await db.posts.delete(key);
		} else {
			await db.posts.put(JSON.parse(JSON.stringify({ ...next, cachedAt: Date.now() })));
		}
	});
}

export async function findUnreferencedPosts(
	followedBlogs: ReadonlySet<string>,
	accountBlogs: ReadonlySet<string>
): Promise<CachedPostEntry[]> {
	if (!browser) return [];
	const keep = new Set<string>([...followedBlogs, ...accountBlogs]);
	const out: CachedPostEntry[] = [];
	await db.posts.each((post) => {
		if (!keep.has(post.cachedFromBlog)) {
			out.push(post);
		}
	});
	return out;
}

export async function putCachedPostEntry(postId: number | string, entry: CachedPostEntry): Promise<void> {
	if (!browser) return;
	const cleaned: CachedPostEntry = {
		...entry,
		id: Number(postId),
		cachedAt: Date.now()
	};
	await db.posts.put(JSON.parse(JSON.stringify(cleaned)));
}

function noteDedupKey(n: TumblrNote): string {
	return `${n.blog_name}_${n.timestamp}_${n.type}`;
}

export async function mergeNotes(
	postId: number | string,
	newNotes: TumblrNote[]
): Promise<TumblrNote[]> {
	if (!browser) return [];
	const numeric = Number(postId);
	let merged: TumblrNote[] = [];
	await db.transaction('rw', db.posts, async () => {
		const existing = await db.posts.get(numeric);
		const priorNotes = Array.isArray(existing?.notes) ? existing!.notes! : [];
		const seen = new Set<string>(priorNotes.map(noteDedupKey));
		merged = [...priorNotes];
		for (const n of newNotes ?? []) {
			if (!n) continue;
			const k = noteDedupKey(n);
			if (seen.has(k)) continue;
			seen.add(k);
			merged.push(n);
		}
		
		const base: CachedPostEntry = existing
			? { ...existing, notes: merged }
			: {
					id: numeric,
					post: { id: numeric } as TumblrPost,
					cachedAt: Date.now(),
					cachedFromBlog: '',
					likedBy: {},
					notes: merged
				};
		await db.posts.put(JSON.parse(JSON.stringify(base)));
	});
	return merged;
}

export async function loadNotes(postId: number | string): Promise<TumblrNote[]> {
	if (!browser) return [];
	const entry = await getCachedPostById(postId);
	return Array.isArray(entry?.notes) ? entry!.notes! : [];
}

export async function clearNotesForPost(postId: number | string): Promise<void> {
	if (!browser) return;
	await mergePostMeta(postId, (entry) => {
		if (!entry) return null;
		return { ...entry, notes: [] };
	});
}

export async function clearPostCache(): Promise<void> {
	return clearAllPosts();
}