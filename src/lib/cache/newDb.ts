import Dexie, { type Table } from 'dexie';
import type { TumblrPost, TumblrNote, TumblrAccount, TumblrUser, TumblrBlog } from '#lib/types';
import { browser } from '$app/env';
import { getOfflineBucketIdb } from './buckets';

export interface NoteTotals {
	likes: number;
	reblogs: number;
	replies: number;
	complete: boolean;
}

export interface CachedPostEntry {
	/** Canonical string post id (`id_string`); never the lossy numeric id. */
	id: string;
	post: TumblrPost;
	/** First time this post entered the cache. Stable across refreshes. */
	cachedAt: number;
	/** Last time the row was written (post metadata or notes). */
	updatedAt?: number;
	cachedFromBlog: string;
	/** Every account/blog that surfaced this post. */
	sources: string[];
	likedBy: Record<string, boolean>;
	rebloggedBy: Record<string, boolean>;
	notes?: TumblrNote[];
	noteTotals?: NoteTotals;
	sortTimestamp?: number;
}

export interface StoredMediaUrl {
	url: string;
	/** Canonical string post id, or '0' for legacy unidentified media. */
	postId: string;
	type: string;
	/** Epoch ms the blob entered the offline cache. Used as LRU order for eviction; 0 = pre-v3 rows. */
	cachedAt?: number;
	/** Blob size in bytes when known (Content-Length); 0 = unknown. Enables byte-aware eviction. */
	size?: number;
	/** Size-independent asset identity (URL minus rendition suffix) for upgrade lookups. */
	base?: string;
}

export interface CachedAvatar {
	id: string; // `${blog}_${size}`
	blob: Blob; 
}

export interface CachedAccountInfo {
	blogName: string;
	user: TumblrUser;
	cachedAt: number;
}

export interface CachedBlogInfo {
	blogName: string;
	share_likes: boolean;
	likes?: number;
	updated?: number;
	full?: TumblrBlog;
	cachedAt: number;
}

export interface CachedFollowedList {
	accountBlogName: string;
	blogs: TumblrBlog[];
	cachedAt: number;
}

const MEDIA_SEGMENT_RE = /^(.*\/)s(\d+)x(\d+)[a-zA-Z0-9_]*(\/[^/]+)\.([a-zA-Z0-9]+)$/;
const MEDIA_SUFFIX_RE = /^(.*?_)(\d+)\.([a-zA-Z0-9]+)$/;

/**
 * Size-independent identity of a Tumblr CDN media URL: same for every
 * rendition of one asset. Mirrors the service worker's canonical parser.
 */
export function mediaAssetBase(url: string): string {
	const clean = url.split('#')[0].split('?')[0];
	const seg = clean.match(MEDIA_SEGMENT_RE);
	if (seg) return `${seg[1]}${seg[4]}.${seg[5]}`;
	const suffix = clean.match(MEDIA_SUFFIX_RE);
	if (suffix) return `${suffix[1]}${suffix[3]}`;
	return clean;
}

export class TmblrCacheDB extends Dexie {
	posts!: Table<CachedPostEntry, string>;
	mediaUrls!: Table<StoredMediaUrl, string>;
	meta!: Table<{ key: string; value: any }, string>;
	avatars!: Table<CachedAvatar, string>;
	settings!: Table<{ key: string; value: any }, string>;
	accounts!: Table<TumblrAccount, string>;
	accountInfos!: Table<CachedAccountInfo, string>;
	blogInfos!: Table<CachedBlogInfo, string>;
	followedBlogs!: Table<CachedFollowedList, string>;

	constructor() {
		super('tmblr-cache-new');
		this.version(1).stores({
			posts: 'id, cachedAt, [cachedFromBlog+cachedAt], cachedFromBlog',
			mediaUrls: 'url, postId',
			meta: 'key',
			avatars: 'id',
			settings: 'key',
			accounts: 'blogName',
			accountInfos: 'blogName',
			blogInfos: 'blogName',
			followedBlogs: 'accountBlogName'
		});
		this.version(2).stores({
			posts: 'id, cachedAt, [cachedFromBlog+cachedAt], cachedFromBlog, sortTimestamp'
		}).upgrade(tx => {
			return tx.table('posts').toCollection().modify(post => {
				post.sortTimestamp = post.post.liked_timestamp || post.cachedAt;
			});
		});
		this.version(3).stores({
			mediaUrls: 'url, postId, cachedAt'
		}).upgrade(tx => {
			// Backfill LRU timestamp for pre-v3 rows; 0 sorts them first (evicted first).
			return tx.table('mediaUrls').toCollection().modify(m => {
				if (m.cachedAt == null) m.cachedAt = 0;
			});
		});
		this.version(4).stores({
			mediaUrls: 'url, postId, cachedAt, base'
		}).upgrade(tx => {
			// Backfill the asset identity for upgrade lookups (no size backfill —
			// unknown sizes evict normally via the LRU order).
			return tx.table('mediaUrls').toCollection().modify(m => {
				if (m.base == null) m.base = mediaAssetBase(m.url);
			});
		});
		this.version(5).stores({
			// Post ids become strings: Tumblr ids are 64-bit and `Number(id)`
			// silently loses precision above 2^53. `id_string` is canonical.
			posts: 'id, cachedAt, [cachedFromBlog+cachedAt], cachedFromBlog, sortTimestamp, updatedAt',
			mediaUrls: 'url, postId, cachedAt, base'
		}).upgrade(async tx => {
			const posts = tx.table('posts');
			const rows = await posts.toArray();
			await posts.clear();
			for (const row of rows) {
				const id = String(row.post?.id_string ?? row.id);
				const sources = Array.isArray(row.sources)
					? row.sources
					: row.cachedFromBlog
						? [row.cachedFromBlog]
						: [];
				await posts.put({
					...row,
					id,
					sources,
					updatedAt: row.updatedAt ?? row.cachedAt
				});
			}
			await tx
				.table('mediaUrls')
				.toCollection()
				.modify((m) => {
					if (m.postId != null) m.postId = String(m.postId);
				});
		});
	}
}

/* ── one-time move of the origin database into the persistent bucket ────── */

const DB_NAME = 'tmblr-cache-new';
const MIGRATED_FLAG = 'offline-bucket-db-migrated-v1';

async function dbExists(factory: IDBFactory, name: string): Promise<boolean> {
	try {
		const databases = await factory.databases?.();
		return !!databases?.some((entry) => entry.name === name);
	} catch {
		return false;
	}
}

function deleteOriginDb(): Promise<void> {
	return new Promise((resolve) => {
		try {
			const request = indexedDB.deleteDatabase(DB_NAME);
			request.onsuccess = () => resolve();
			request.onerror = () => resolve();
			request.onblocked = () => resolve();
		} catch {
			resolve();
		}
	});
}

/**
 * Copy an existing origin database into the bucket. Runs once, before the
 * exported `db` is opened, so every later query hits the bucket.
 */
async function migrateDbToBucket(bucketIdb: IDBFactory): Promise<void> {
	if (!(await dbExists(indexedDB, DB_NAME))) return;
	if (!localStorage.getItem(MIGRATED_FLAG)) {
		if (!(await dbExists(bucketIdb, DB_NAME))) {
			// `globalThis.indexedDB` is always the origin factory, even after a
			// dev HMR re-evaluation has installed the bucket factory globally.
			Dexie.dependencies.indexedDB = indexedDB;
			const source = new TmblrCacheDB();
			await source.open();

			Dexie.dependencies.indexedDB = bucketIdb;
			const target = new TmblrCacheDB();
			await target.open();
			for (const table of source.tables) {
				const rows = await table.toArray();
				if (rows.length > 0) await target.table(table.name).bulkPut(rows);
			}
			source.close();
			target.close();
		}
		localStorage.setItem(MIGRATED_FLAG, '1');
	}
	await deleteOriginDb();
}

if (browser) {
	// Top-level await: the bucket IDB factory must be installed before the
	// exported Dexie instance opens, otherwise it silently opens in the origin
	// namespace — which is exactly the split this replaces.
	try {
		const bucketIdb = await getOfflineBucketIdb();
		if (bucketIdb) {
			await migrateDbToBucket(bucketIdb);
			Dexie.dependencies.indexedDB = bucketIdb;
		}
	} catch (e) {
		// A failed migration must not brick startup; keep using origin storage.
		console.error('[storage] bucket DB migration failed; using origin IDB', e);
		Dexie.dependencies.indexedDB = indexedDB;
	}
}

/* Constructed only after the bucket factory is installed. */
export const db = new TmblrCacheDB();
