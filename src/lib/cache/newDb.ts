import Dexie, { type Table } from 'dexie';
import type { TumblrPost, TumblrNote, TumblrAccount, TumblrUser, TumblrBlog } from '$lib/types';

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
	}
}

export const db = new TmblrCacheDB();
