import Dexie, { type Table } from 'dexie';
import type { TumblrPost, TumblrNote, TumblrAccount, TumblrUser, TumblrBlog } from '$lib/types';
import { browser } from '$app/environment';
import { getAppBucketIdb } from './buckets';

export interface NoteTotals {
	likes: number;
	reblogs: number;
	replies: number;
	complete: boolean;
}

export interface CachedPostEntry {
	id: number;
	post: TumblrPost;
	cachedAt: number;
	cachedFromBlog: string;
	likedBy: Record<string, boolean>;
	rebloggedBy?: Record<string, boolean>;
	notes?: TumblrNote[];
	noteTotals?: NoteTotals;
	sortTimestamp?: number;
}

export interface StoredMediaUrl {
	url: string;
	postId: number;
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
	posts!: Table<CachedPostEntry, number>;
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
	}
}

export const db = new TmblrCacheDB();

// Route the Dexie database into the persisted `app-data` storage bucket
// (Chromium 122+). Dexie resolves `dependencies.indexedDB` on first open, so
// injecting at module load is safe: every DB call is async and happens after
// this microtask. Fallback browsers keep the default origin IDB.
if (browser) {
	void (async () => {
		const bucketIdb = await getAppBucketIdb();
		if (bucketIdb) {
			Dexie.dependencies.indexedDB = bucketIdb;
		}
	})();
}
