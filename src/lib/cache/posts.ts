// ─── Posts Cache ────────────────────────────────────────────────────────────
// One IDB row per post, keyed by `post.id`. v7 layout adds compound indexes
// for newest-first keyset paging: `byCachedAt[cachedAt,id]` and
// `byBlogCachedAt[cachedFromBlog,cachedAt,id]`. All bulk writes happen in a
// single readwrite tx so a 10k-page write either lands or rolls back, with
// existing `likedBy`/`rebloggedBy`/`notes`/`noteTotals` preserved inside the
// same tx.

import { browser } from '$app/environment';
import type { TumblrPost, TumblrNote } from '$lib/types';
import {
	STORES,
	openCacheDB,
	idbGet,
	idbDelete,
	idbCount,
	idbTx,
	runCacheTx,
	idbReadKeyset,
	type KeysetCursor
} from './db';
import type { PostFilter } from '$lib/types';
import { matchesFilter } from '$lib/postFilter';

export interface NoteTotals {
	likes: number;
	reblogs: number;
	replies: number;
	complete: boolean;
}

export interface CachedPostEntry {
	post: TumblrPost;
	cachedAt: number;
	cachedFromBlog: string;
	likedBy: Record<string, boolean>;
	rebloggedBy?: Record<string, boolean>;
	notes?: TumblrNote[];
	noteTotals?: NoteTotals;
}

function isValidEntry(value: unknown): value is CachedPostEntry {
	if (!value || typeof value !== 'object') return false;
	const e = value as Partial<CachedPostEntry>;
	return (
		!!e.post &&
		typeof (e.post as Partial<TumblrPost>).id === 'number' &&
		typeof e.cachedAt === 'number' &&
		typeof e.cachedFromBlog === 'string' &&
		!!e.likedBy &&
		typeof e.likedBy === 'object'
	);
}

export function freshEntry(post: TumblrPost, cachedFromBlog: string): CachedPostEntry {
	return {
		post,
		cachedAt: Date.now(),
		cachedFromBlog,
		likedBy: {},
		rebloggedBy: {}
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
	const raw = await idbGet<CachedPostEntry>(STORES.posts, Number(postId));
	return isValidEntry(raw) ? raw : null;
}

export interface PostsPageRequest {
	limit: number;
	before?: KeysetCursor;
	blog?: string;
	filter?: PostFilter;
}

export interface PostsPage {
	entries: CachedPostEntry[];
	total: number;
	nextCursor: KeysetCursor | null;
}

/**
 * Cursor-based pagination over the compound `byCachedAt` /
 * `byBlogCachedAt` indexes. Newest-first; bounded `limit`; optional `before`
 * for forward paging. `filter` is applied in JS over the page because
 * `PostFilter` predicates depend on NPF content, not a key field.
 */
export async function getCachedPostsPage(opts: PostsPageRequest): Promise<PostsPage> {
	if (!browser) return { entries: [], total: 0, nextCursor: null };
	const limit = Math.max(0, opts.limit);
	if (limit === 0) {
		const total = opts.blog
			? await countBlogPosts(opts.blog)
			: await idbCount(STORES.posts);
		return { entries: [], total, nextCursor: null };
	}

	const total = opts.blog
		? await countBlogPosts(opts.blog)
		: await idbCount(STORES.posts);

	const index: 'byCachedAt' | 'byBlogCachedAt' = opts.blog ? 'byBlogCachedAt' : 'byCachedAt';
	const indexRange = opts.blog ? IDBKeyRange.bound([opts.blog], [opts.blog, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]) : undefined;

	const filter = opts.filter;
	const rows = await idbReadKeyset<CachedPostEntry>({
		take: limit,
		index,
		indexRange,
		before: opts.before
	});

	const entries: CachedPostEntry[] = [];
	for (const row of rows) {
		if (!isValidEntry(row.entry)) continue;
		if (opts.blog && row.entry.cachedFromBlog !== opts.blog) continue;
		if (filter && filter !== 'all' && !matchesFilter(row.entry.post, filter)) continue;
		entries.push(row.entry);
	}

	const nextCursor = rows.length === limit && entries.length > 0
		? rows[rows.length - 1].cursor
		: null;

	return { entries, total, nextCursor };
}

async function countBlogPosts(blog: string): Promise<number> {
	const db = await openCacheDB();
	return new Promise<number>((resolve, reject) => {
		const tx = db.transaction(STORES.posts, 'readonly');
		const idx = tx.objectStore(STORES.posts).index('byBlogCachedAt');
		const req = idx.count(IDBKeyRange.only(blog));
		req.onsuccess = () => resolve(req.result ?? 0);
		tx.onerror = () => reject(tx.error ?? new Error('countBlogPosts failed'));
	});
}

/**
 * Bulk write posts in one readwrite tx. Existing entries are read INSIDE the
 * tx and merged before the put, so `likedBy`/`rebloggedBy`/`notes`/
 * `noteTotals` survive without a separate read-modify-write race. Optional
 * `likedBy` / `rebloggedBy` updates apply on top.
 */
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

	await runCacheTx('readwrite', [STORES.posts], async (_tx, stores) => {
		const now = Date.now();
		const keys = valid.map((p) => p.id);
		const existingEntries = await readExisting(stores.posts, keys);
		for (const post of valid) {
			const id = Number(post.id);
			const prior = existingEntries.get(id);
			const likedBy: Record<string, boolean> = { ...(prior?.likedBy ?? {}) };
			const rebloggedBy: Record<string, boolean> = { ...(prior?.rebloggedBy ?? {}) };
			if (opts.accountBlogName) {
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
				likedBy[opts.accountBlogName] = likedBy[opts.accountBlogName] ?? false;
				rebloggedBy[opts.accountBlogName] = rebloggedBy[opts.accountBlogName] ?? false;
			}
			const entry: CachedPostEntry = prior
				? {
						...prior,
						post,
						cachedAt: now,
						cachedFromBlog: prior.cachedFromBlog || post.blog_name || opts.accountBlogName || ''
					}
				: {
						post,
						cachedAt: now,
						cachedFromBlog: post.blog_name || opts.accountBlogName || '',
						likedBy,
						rebloggedBy
					};
			stores.posts.put(JSON.parse(JSON.stringify(entry)) as CachedPostEntry);
		}
	});
}

async function readExisting(
	store: IDBObjectStore,
	keys: number[]
): Promise<Map<number, CachedPostEntry>> {
	const map = new Map<number, CachedPostEntry>();
	if (keys.length === 0) return map;
	await new Promise<void>((resolve, reject) => {
		let remaining = keys.length;
		let aborted = false;
		for (const k of keys) {
			const req = store.get(k);
			req.onsuccess = () => {
				if (aborted) return;
				const v = req.result as CachedPostEntry | undefined;
				if (isValidEntry(v)) map.set(k, v);
				if (--remaining === 0) resolve();
			};
			req.onerror = () => {
				aborted = true;
				reject(req.error ?? new Error('readExisting failed'));
			};
		}
	});
	return map;
}


export async function removeCachedPost(postId: number | string): Promise<void> {
	if (!browser) return;
	await idbDelete(STORES.posts, Number(postId));
}

export async function clearPostsForBlog(blog: string): Promise<number> {
	if (!browser) return 0;
	const db = await openCacheDB();
	const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
		const tx = db.transaction(STORES.posts, 'readonly');
		const req = tx.objectStore(STORES.posts).index('byBlogCachedAt').getAllKeys(IDBKeyRange.only(blog));
		req.onsuccess = () => resolve(req.result ?? []);
		tx.onerror = () => reject(tx.error ?? new Error('clearPostsForBlog failed'));
	});
	if (keys.length === 0) return 0;
	await idbTx(keys.map((k) => ({ store: STORES.posts, op: 'delete', key: k })));
	return keys.length;
}

export async function clearPosts(ids: ReadonlyArray<number | string>): Promise<number> {
	if (!browser || ids.length === 0) return 0;
	const keys = [...new Set(ids.map(Number))].filter(Number.isFinite);
	if (keys.length === 0) return 0;
	await idbTx(keys.map((k) => ({ store: STORES.posts, op: 'delete', key: k })));
	return keys.length;
}

export async function clearAllPosts(): Promise<void> {
	if (!browser) return;
	await idbTx([{ store: STORES.posts, op: 'clear' }]);
}

/**
 * Atomic read-modify-write inside one tx — replaces the old two-tx helper.
 * Caller-supplied `updater` runs in the same readwrite tx as the put, so
 * concurrent writers can't lose metadata.
 */
export async function mergePostMeta(
	postId: number | string,
	updater: (entry: CachedPostEntry | null) => CachedPostEntry | null
): Promise<void> {
	if (!browser) return;
	const key = Number(postId);
	await runCacheTx('readwrite', [STORES.posts], async (_tx, stores) => {
		const existing = (await new Promise<CachedPostEntry | undefined>((resolve, reject) => {
			const req = stores.posts.get(key);
			req.onsuccess = () => resolve(req.result as CachedPostEntry | undefined);
			req.onerror = () => reject(req.error ?? new Error('mergePostMeta read failed'));
		})) ?? null;
		const next = updater(existing);
		if (next === null || next === undefined) {
			stores.posts.delete(key);
			return;
		}
		stores.posts.put(JSON.parse(JSON.stringify({ ...next, cachedAt: Date.now() })) as CachedPostEntry);
	});
}

/**
 * Index-ranged scan: posts whose `cachedFromBlog` is not in either keep-set.
 * Uses the `byBlogCachedAt` index to enumerate blogs and walks each.
 */
export async function findUnreferencedPosts(
	followedBlogs: ReadonlySet<string>,
	accountBlogs: ReadonlySet<string>
): Promise<CachedPostEntry[]> {
	if (!browser) return [];
	const keep = new Set<string>([...followedBlogs, ...accountBlogs]);
	const db = await openCacheDB();
	const blogs = await new Promise<string[]>((resolve, reject) => {
		const tx = db.transaction(STORES.posts, 'readonly');
		const req = tx.objectStore(STORES.posts).index('byBlogCachedAt').openKeyCursor();
		const seen = new Set<string>();
		req.onsuccess = (event: Event) => {
			const cursor = (event.target as IDBRequest<IDBCursor | null>).result;
			if (!cursor) return;
			const key = cursor.key as [string, number, number];
			seen.add(String(key[0]));
			cursor.continue();
		};
		tx.oncomplete = () => resolve([...seen]);
		tx.onerror = () => reject(tx.error ?? new Error('findUnreferencedPosts blogs failed'));
	});
	const out: CachedPostEntry[] = [];
	for (const blog of blogs) {
		if (keep.has(blog)) continue;
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORES.posts, 'readonly');
			const req = tx.objectStore(STORES.posts).index('byBlogCachedAt').openCursor(IDBKeyRange.only(blog), 'prev');
			req.onsuccess = (event: Event) => {
				const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
				if (!cursor) return;
				const v = cursor.value as CachedPostEntry;
				if (isValidEntry(v)) out.push(v);
				cursor.continue();
			};
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error ?? new Error('findUnreferencedPosts walk failed'));
		});
	}
	return out;
}

export async function putCachedPostEntry(postId: number | string, entry: CachedPostEntry): Promise<void> {
	if (!browser) return;
	const cleaned: CachedPostEntry = { ...entry, cachedAt: Date.now() };
	const db = await openCacheDB();
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction(STORES.posts, 'readwrite');
		tx.objectStore(STORES.posts).put(JSON.parse(JSON.stringify(cleaned)) as CachedPostEntry, Number(postId));
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error('putCachedPostEntry failed'));
	});
}

// ─── Notes (inlined into post entry) ────────────────────────────────────────

function noteDedupKey(n: TumblrNote): string {
	return `${n.blog_name}_${n.timestamp}_${n.type}`;
}

const notesLocks = new Map<string, Promise<void>>();

export async function mergeNotes(
	postId: number | string,
	newNotes: TumblrNote[]
): Promise<TumblrNote[]> {
	if (!browser) return [];
	const key = String(postId);
	const prevLock = notesLocks.get(key) ?? Promise.resolve();
	let release: () => void = () => {};
	const nextLock = new Promise<void>((resolve) => {
		release = resolve;
	});
	notesLocks.set(key, prevLock.then(() => nextLock));
	try {
		await prevLock;
		let merged: TumblrNote[] = [];
		await runCacheTx('readwrite', [STORES.posts], async (_tx, stores) => {
			const numeric = Number(postId);
			const existing = (await new Promise<CachedPostEntry | undefined>((resolve, reject) => {
				const req = stores.posts.get(numeric);
				req.onsuccess = () => resolve(req.result as CachedPostEntry | undefined);
				req.onerror = () => reject(req.error ?? new Error('mergeNotes read failed'));
			})) ?? null;
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
						post: { id: numeric } as TumblrPost,
						cachedAt: Date.now(),
						cachedFromBlog: '',
						likedBy: {},
						notes: merged
					};
			stores.posts.put(JSON.parse(JSON.stringify(base)) as CachedPostEntry);
		});
		return merged;
	} finally {
		release();
		if (notesLocks.get(key) === nextLock) notesLocks.delete(key);
	}
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