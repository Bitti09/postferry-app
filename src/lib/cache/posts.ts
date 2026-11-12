import { browser } from '$app/env';
import { dedupeNotes, noteKey } from '#lib/notes';
import type { FeedPost, TumblrNote, TumblrPost } from '#lib/types';
import type { PostFilter } from '#lib/types';
import { matchesFilter } from '#lib/postFilter';
import { postId as canonicalPostId } from 'postferry';
import Dexie from 'dexie';
import { db, type CachedPostEntry, type NoteTotals } from './newDb';

export type { CachedPostEntry, NoteTotals };

function anyTrue(values: Record<string, boolean> | undefined): boolean {
	if (!values) return false;
	for (const value of Object.values(values)) if (value) return true;
	return false;
}

function union(...groups: ReadonlyArray<ReadonlyArray<string> | undefined>): string[] {
	return [...new Set(groups.flatMap((group) => group ?? []))].filter(Boolean);
}

/**
 * Unique insertion timestamp. Multiple posts written in one transaction would
 * otherwise share `Date.now()`, and keyset pagination over the `cachedAt`
 * index would skip the rows that share the cursor value.
 */
let cachedAtFloor = 0;
function allocateCachedAt(): number {
	cachedAtFloor = Math.max(Date.now(), cachedAtFloor + 1);
	return cachedAtFloor;
}

function stripFeedMeta(post: FeedPost): TumblrPost {
	const {
		likedBy: _likedBy,
		rebloggedBy: _rebloggedBy,
		seenBy: _seenBy,
		sources: _sources,
		likedAt: _likedAt,
		...rest
	} = post;
	return rest as TumblrPost;
}

export function freshEntry(post: TumblrPost, cachedFromBlog: string): CachedPostEntry {
	const now = allocateCachedAt();
	return {
		id: canonicalPostId(post),
		post,
		cachedAt: now,
		updatedAt: now,
		cachedFromBlog,
		sources: [cachedFromBlog].filter(Boolean),
		likedBy: {},
		rebloggedBy: {},
		sortTimestamp: post.liked_timestamp || now
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
		id: canonicalPostId(post),
		post: { ...post, liked: anyTrue(likedBy), reblogged: anyTrue(rebloggedBy) },
		cachedAt: existing?.cachedAt ?? allocateCachedAt(),
		updatedAt: Date.now(),
		cachedFromBlog: accountBlogName || existing?.cachedFromBlog || post.blog_name,
		sources: union(existing?.sources, [accountBlogName || post.blog_name]),
		likedBy,
		rebloggedBy,
		notes: existing?.notes,
		noteTotals: existing?.noteTotals,
		sortTimestamp: post.liked_timestamp || existing?.sortTimestamp || Date.now()
	};
}

export async function getCachedPostById(postId: number | string): Promise<CachedPostEntry | null> {
	if (!browser) return null;
	const result = await db.posts.get(String(postId));
	return result || null;
}

export interface PostsPageRequest {
	limit: number;
	before?: { cachedAt: number; id: string; sortTimestamp?: number };
	blog?: string;
	filter?: PostFilter;
	sourceFilter?: 'all' | 'faves' | 'blogs';
}

export interface PostsPage {
	entries: CachedPostEntry[];
	total: number;
	nextCursor: { cachedAt: number; id: string; sortTimestamp?: number } | null;
}

/** Faves are authoritative through `likedBy`; legacy rows fall back to `post.liked`. */
function isFave(entry: CachedPostEntry): boolean {
	if (entry.likedBy && Object.keys(entry.likedBy).length > 0) {
		return Object.values(entry.likedBy).some(Boolean);
	}
	return entry.post.liked === true;
}

export async function getCachedPostsPage(opts: PostsPageRequest): Promise<PostsPage> {
	if (!browser) return { entries: [], total: 0, nextCursor: null };
	const limit = Math.max(0, opts.limit);

	let collection = db.posts.orderBy('cachedAt').reverse();
	if (opts.sourceFilter === 'faves') {
		collection = db.posts.orderBy('sortTimestamp').reverse();
	}

	if (opts.blog) {
		collection = db.posts
			.where('[cachedFromBlog+cachedAt]')
			.between([opts.blog, Dexie.minKey], [opts.blog, Dexie.maxKey])
			.reverse();
	}

	const total = await (opts.blog
		? db.posts.where('cachedFromBlog').equals(opts.blog).count()
		: db.posts.count());

	if (limit === 0) {
		return { entries: [], total, nextCursor: null };
	}

	let query = collection;
	if (opts.before) {
		if (opts.blog) {
			query = db.posts
				.where('[cachedFromBlog+cachedAt]')
				.between([opts.blog, Dexie.minKey], [opts.blog, opts.before.cachedAt], false, false)
				.reverse();
		} else if (opts.sourceFilter === 'faves') {
			query = db.posts
				.where('sortTimestamp')
				.below(opts.before.sortTimestamp ?? opts.before.cachedAt)
				.reverse();
		} else {
			query = db.posts.where('cachedAt').below(opts.before.cachedAt).reverse();
		}
	}

	const rawEntries = await query.toArray();
	const entries: CachedPostEntry[] = [];

	for (const row of rawEntries) {
		if (opts.filter && opts.filter !== 'all' && !matchesFilter(row.post, opts.filter)) continue;

		if (opts.sourceFilter && opts.sourceFilter !== 'all') {
			const isFavourite = isFave(row);
			if (opts.sourceFilter === 'faves' && !isFavourite) continue;
			if (opts.sourceFilter === 'blogs' && isFavourite) continue;
		}

		entries.push(row);
		if (entries.length >= limit) break;
	}

	const nextCursor =
		entries.length === limit && entries.length > 0
			? {
					cachedAt: entries[entries.length - 1]!.cachedAt,
					id: entries[entries.length - 1]!.id,
					sortTimestamp: entries[entries.length - 1]!.sortTimestamp
				}
			: null;

	return { entries, total, nextCursor };
}

export interface BulkSetOpts {
	likedBy?: Record<string, Record<string, boolean>>;
	rebloggedBy?: Record<string, Record<string, boolean>>;
	accountBlogName?: string;
}

/**
 * Upsert posts and merge their multi-account state.
 *
 * `cachedAt` is first-seen and never rewritten, so keyset pagination over the
 * cached library cannot skip or repeat rows when a post is refreshed.
 * `updatedAt` records the latest write instead.
 */
export async function bulkSetPosts(posts: FeedPost[], opts: BulkSetOpts = {}): Promise<void> {
	if (!browser || posts.length === 0) return;
	const valid = posts.filter((post) => post && (post.id_string || Number.isFinite(post.id)));
	if (valid.length === 0) return;

	await db.transaction('rw', db.posts, async () => {
		const now = Date.now();
		const keys = valid.map((post) => canonicalPostId(post));
		const existingArr = await db.posts.bulkGet(keys);
		const toPut: CachedPostEntry[] = [];

		for (let i = 0; i < valid.length; i++) {
			const incoming = valid[i]!;
			const id = canonicalPostId(incoming);
			const prior = existingArr[i];
			const basePost = stripFeedMeta(incoming);

			const likedBy: Record<string, boolean> = { ...(prior?.likedBy ?? {}) };
			const rebloggedBy: Record<string, boolean> = { ...(prior?.rebloggedBy ?? {}) };

			// Per-account metadata from the server-side merge.
			for (const [blog, value] of Object.entries(incoming.likedBy ?? {})) {
				likedBy[blog] = value;
			}
			for (const [blog, value] of Object.entries(incoming.rebloggedBy ?? {})) {
				rebloggedBy[blog] = value;
			}

			// Legacy batch form used by the accounts "cache favs" path.
			const likeUpdate = opts.likedBy?.[id];
			if (likeUpdate) {
				for (const [blog, value] of Object.entries(likeUpdate)) {
					if (value) likedBy[blog] = true;
					else delete likedBy[blog];
				}
			}
			const reblogUpdate = opts.rebloggedBy?.[id];
			if (reblogUpdate) {
				for (const [blog, value] of Object.entries(reblogUpdate)) {
					if (value) rebloggedBy[blog] = true;
					else delete rebloggedBy[blog];
				}
			}

			const likedAtCandidates = [
				prior?.post.liked_timestamp,
				basePost.liked_timestamp,
				incoming.likedAt
			].filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
			const likedAt = likedAtCandidates.length > 0 ? Math.max(...likedAtCandidates) : undefined;

			const sources = union(
				prior?.sources,
				incoming.sources,
				incoming.seenBy,
				[basePost.blog_name, opts.accountBlogName, prior?.cachedFromBlog].filter(
					(value): value is string => !!value
				)
			);

			const sortTimestamp = likedAt ?? prior?.sortTimestamp ?? now;

			const entry: CachedPostEntry = {
				...(prior ?? {}),
				id,
				post: {
					...basePost,
					liked: anyTrue(likedBy) || (Object.keys(likedBy).length === 0 && basePost.liked === true),
					reblogged:
						anyTrue(rebloggedBy) ||
						(Object.keys(rebloggedBy).length === 0 && basePost.reblogged === true),
					...(likedAt !== undefined ? { liked_timestamp: likedAt } : {})
				},
				cachedAt: prior?.cachedAt ?? allocateCachedAt(),
				updatedAt: now,
				cachedFromBlog: prior?.cachedFromBlog || basePost.blog_name || opts.accountBlogName || '',
				sources,
				likedBy,
				rebloggedBy,
				notes: prior?.notes,
				noteTotals: prior?.noteTotals,
				sortTimestamp
			};
			toPut.push(entry);
		}

		await db.posts.bulkPut(JSON.parse(JSON.stringify(toPut)));
	});
}

export async function removeCachedPost(postId: number | string): Promise<void> {
	if (!browser) return;
	await db.posts.delete(String(postId));
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
	const keys = [...new Set(ids.map(String))].filter(Boolean);
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
	const key = String(postId);
	await db.transaction('rw', db.posts, async () => {
		const existing = (await db.posts.get(key)) || null;
		const next = updater(existing);
		if (next === null || next === undefined) {
			await db.posts.delete(key);
		} else {
			await db.posts.put(
				JSON.parse(
					JSON.stringify({
						...next,
						id: key,
						cachedAt: existing?.cachedAt ?? next.cachedAt ?? allocateCachedAt(),
						updatedAt: Date.now()
					})
				)
			);
		}
	});
}

export interface UnreferencedPostSummary {
	id: string;
	blogName: string;
	timestamp?: number;
	cachedAt: number;
	summary?: string;
	type?: string;
	tags?: string[];
}

export async function findUnreferencedPosts(
	followedBlogs: ReadonlySet<string>,
	accountBlogs: ReadonlySet<string>
): Promise<UnreferencedPostSummary[]> {
	if (!browser) return [];
	const keep = new Set<string>([...followedBlogs, ...accountBlogs]);
	const out: UnreferencedPostSummary[] = [];
	await db.posts.each((entry) => {
		const sources = entry.sources?.length ? entry.sources : [entry.cachedFromBlog];
		if (sources.some((source) => keep.has(source))) return;
		out.push({
			id: entry.id,
			blogName: entry.cachedFromBlog,
			timestamp: entry.post?.timestamp,
			cachedAt: entry.cachedAt,
			summary: entry.post?.summary,
			type: entry.post?.type,
			tags: entry.post?.tags
		});
	});
	return out;
}

export async function putCachedPostEntry(
	postId: number | string,
	entry: CachedPostEntry
): Promise<void> {
	if (!browser) return;
	const key = String(postId);
	const existing = await db.posts.get(key);
	const cleaned: CachedPostEntry = {
		...entry,
		id: key,
		cachedAt: existing?.cachedAt ?? entry.cachedAt ?? allocateCachedAt(),
		updatedAt: Date.now(),
		sources: union(existing?.sources, entry.sources, [entry.cachedFromBlog])
	};
	await db.posts.put(JSON.parse(JSON.stringify(cleaned)));
}

export async function mergeNotes(
	postId: number | string,
	newNotes: TumblrNote[]
): Promise<TumblrNote[]> {
	if (!browser) return [];
	const key = String(postId);
	let merged: TumblrNote[] = [];
	await db.transaction('rw', db.posts, async () => {
		const existing = await db.posts.get(key);
		const priorNotes = Array.isArray(existing?.notes) ? existing.notes : [];
		merged = dedupeNotes([...priorNotes, ...(newNotes ?? [])]);

		const base: CachedPostEntry = existing
			? {
					...existing,
					notes: merged,
					updatedAt: Date.now()
				}
			: {
					id: key,
					post: {
						id: Number(key),
						id_string: key,
						blog_name: '',
						timestamp: 0,
						summary: '',
						type: 'text',
						content: []
					} as TumblrPost,
					cachedAt: allocateCachedAt(),
					updatedAt: Date.now(),
					cachedFromBlog: '',
					sources: [],
					likedBy: {},
					rebloggedBy: {},
					notes: merged
				};
		await db.posts.put(JSON.parse(JSON.stringify(base)));
	});
	return merged;
}

export async function loadNotes(postId: number | string): Promise<TumblrNote[]> {
	if (!browser) return [];
	const entry = await getCachedPostById(postId);
	return Array.isArray(entry?.notes) ? entry.notes : [];
}

export async function clearNotesForPost(postId: number | string): Promise<void> {
	if (!browser) return;
	await mergePostMeta(postId, (entry) => {
		if (!entry) return null;
		return { ...entry, notes: [] };
	});
}

export { noteKey };

export async function clearPostCache(): Promise<void> {
	return clearAllPosts();
}
