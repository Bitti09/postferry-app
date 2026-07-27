// ─── Cache DB ────────────────────────────────────────────────────────────────
// Single IndexedDB database `tmblr-cache` at schema version 7.
//
// Layout (v7):
//   posts          keyPath=id                  value=CachedPostEntry
//                  index byCachedAt            [cachedAt, id]
//                  index byBlogCachedAt        [cachedFromBlog, cachedAt, id]
//   blobs          key=url                     value=StoredBlob (postId + postMeta)
//                  index byPost                on postId
//   blobsIndex     key=mediaId                 value=BlobsIndexEntry (bestUrl + type + postId)
//   meta           key=string                  value=JSON
//   accounts       key=blogName                value=TumblrAccount
//   accountInfos   key=blogName                value={ user, cachedAt }
//   blogInfos      key=blogName                value=CachedBlogInfo
//   settings       key='app'                   value=Settings
//   followedBlogs  key=accountBlogName         value=CachedFollowedList
//   avatars        key=`${blog}_${size}`       value=Blob
//
// All `idb*` helpers auto-open the DB and wait for the open to settle, so
// callers don't need a separate `openCacheDB()` call. Helpers accept an
// optional pre-opened `db` to chain multiple ops in a single tx.

import { browser } from '$app/environment';

// Bump this number whenever the schema changes in a breaking way. v7 is the
// clean-break schema with compound keyset indexes and atomic metadata linkage.
export const CACHE_DB_NAME = 'tmblr-cache';
export const CACHE_DB_VERSION = 7;

export const STORES = {
	posts: 'posts',
	blobs: 'blobs',
	blobsIndex: 'blobsIndex',
	meta: 'meta',
	accounts: 'accounts',
	accountInfos: 'accountInfos',
	blogInfos: 'blogInfos',
	settings: 'settings',
	followedBlogs: 'followedBlogs',
	avatars: 'avatars'
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

let cachedDbPromise: Promise<IDBDatabase> | null = null;

export function openCacheDB(): Promise<IDBDatabase> {
	if (!browser) return Promise.reject(new Error('openDb called outside browser'));
	if (cachedDbPromise) return cachedDbPromise;

	cachedDbPromise = new Promise<IDBDatabase>((resolve, reject) => {
		const req = window.indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);

		req.onupgradeneeded = () => {
			const db = req.result;
			for (const name of Object.values(STORES)) {
				if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name);
			}
			const posts = db.createObjectStore(STORES.posts, { keyPath: 'id' });
			posts.createIndex('byCachedAt', ['cachedAt', 'id'], { unique: false });
			posts.createIndex('byBlogCachedAt', ['cachedFromBlog', 'cachedAt', 'id'], { unique: false });
			const blobs = db.createObjectStore(STORES.blobs);
			blobs.createIndex('byPost', 'postId', { unique: false });
			db.createObjectStore(STORES.blobsIndex);
			for (const name of [STORES.meta, STORES.accounts, STORES.accountInfos, STORES.blogInfos, STORES.settings, STORES.followedBlogs, STORES.avatars]) db.createObjectStore(name);
		};
		req.onsuccess = () => {
			const opened = req.result;
			opened.onversionchange = () => { opened.close(); cachedDbPromise = null; };
			opened.onclose = () => { cachedDbPromise = null; };
			resolve(opened);
		};
		req.onerror = () => reject(req.error ?? new Error('openDb failed'));
		req.onblocked = () => reject(new Error('openDb blocked by another connection'));
	});
	return cachedDbPromise;
}

// ─── Proxy stripping ────────────────────────────────────────────────────────
// Svelte 5 $state proxies don't survive structured-clone when written via
// IDBObjectStore.put. structuredClone handles proxies but not all browsers
// expose it; JSON.parse(JSON.stringify()) is the universal fallback. Date is
// rare in our payloads, so the JSON round-trip is acceptable.

function stripProxy<T>(value: T): T {
	if (value === null || value === undefined) return value;
	if (typeof value !== 'object') return value;
	try {
		return JSON.parse(JSON.stringify(value)) as T;
	} catch {
		return value;
	}
}

export function clone<T>(value: T): T {
	return stripProxy(value);
}

// ─── Single-op helpers ──────────────────────────────────────────────────────

export function idbGet<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
	return openCacheDB().then(
		(db) =>
			new Promise<T | undefined>((resolve, reject) => {
				const tx = db.transaction(store, 'readonly');
				const req = tx.objectStore(store).get(key);
				req.onsuccess = () => resolve(req.result as T | undefined);
				tx.onerror = () => reject(tx.error ?? new Error(`idbGet(${store}) failed`));
				tx.onabort = () => reject(tx.error ?? new Error(`idbGet(${store}) aborted`));
			})
	);
}

export function idbPut<T>(store: StoreName, key: IDBValidKey, value: T): Promise<void> {
	return openCacheDB().then(
		(db) =>
			new Promise<void>((resolve, reject) => {
				const tx = db.transaction(store, 'readwrite');
				tx.objectStore(store).put(stripProxy(value), key);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error ?? new Error(`idbPut(${store}) failed`));
				tx.onabort = () => reject(tx.error ?? new Error(`idbPut(${store}) aborted`));
			})
	);
}

export function idbDelete(store: StoreName, key: IDBValidKey): Promise<void> {
	return openCacheDB().then(
		(db) =>
			new Promise<void>((resolve, reject) => {
				const tx = db.transaction(store, 'readwrite');
				tx.objectStore(store).delete(key);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error ?? new Error(`idbDelete(${store}) failed`));
			})
	);
}

export function idbClear(store: StoreName): Promise<void> {
	return openCacheDB().then(
		(db) =>
			new Promise<void>((resolve, reject) => {
				const tx = db.transaction(store, 'readwrite');
				tx.objectStore(store).clear();
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error ?? new Error(`idbClear(${store}) failed`));
			})
	);
}

export function idbCount(store: StoreName): Promise<number> {
	return openCacheDB().then(
		(db) =>
			new Promise<number>((resolve, reject) => {
				const tx = db.transaction(store, 'readonly');
				const req = tx.objectStore(store).count();
				req.onsuccess = () => resolve(req.result ?? 0);
				tx.onerror = () => reject(tx.error ?? new Error(`idbCount(${store}) failed`));
			})
	);
}

// ─── Multi-store atomic tx ──────────────────────────────────────────────────
// One `readwrite` tx spanning any number of stores. Each op is
// `{ store, op: 'put'|'delete'|'clear', key?, value? }`. All succeed or all
// fail. Errors reject the returned promise with the underlying tx error.

export type IdbOp =
	| { store: StoreName; op: 'put'; key: IDBValidKey; value: unknown }
	| { store: StoreName; op: 'delete'; key: IDBValidKey }
	| { store: StoreName; op: 'clear' };

export function idbTx(ops: ReadonlyArray<IdbOp>): Promise<void> {
	if (ops.length === 0) return Promise.resolve();
	return openCacheDB().then(
		(db) =>
			new Promise<void>((resolve, reject) => {
				const stores = [...new Set(ops.map((o) => o.store))];
				const tx = db.transaction(stores, 'readwrite');
				try {
					for (const op of ops) {
						const os = tx.objectStore(op.store);
						if (op.op === 'put') {
							os.put(stripProxy(op.value), op.key);
						} else if (op.op === 'delete') {
							os.delete(op.key);
						} else {
							os.clear();
						}
					}
				} catch (e) {
					reject(e instanceof Error ? e : new Error(String(e)));
					return;
				}
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error ?? new Error('idbTx failed'));
				tx.onabort = () => reject(tx.error ?? new Error('idbTx aborted'));
			})
	);
}

// ─── Cursor walks ───────────────────────────────────────────────────────────
// `idbWalk` iterates `store` via cursor with an optional `skip` and `take`
// limit. `skip` uses `cursor.advance(N)` so the engine skips rows in C++
// land, not in JS land — 10k-row offset is O(1) not O(N).
//
// `visit` may return `false` to stop early. `count` lets the caller scan
// every row of a specific index range; defaults to all rows of the store.

export interface WalkOpts {
	skip?: number;
	take?: number;
	index?: string;
	indexRange?: IDBKeyRange;
}

export function idbWalk<T>(
	store: StoreName,
	visit: (value: T, key: IDBValidKey) => boolean | void,
	opts: WalkOpts = {}
): Promise<number> {
	return openCacheDB().then(
		(db) =>
			new Promise<number>((resolve, reject) => {
				const tx = db.transaction(store, 'readonly');
				const os = tx.objectStore(store);
				const source: IDBIndex | IDBObjectStore = opts.index ? os.index(opts.index) : os;
				const req = opts.indexRange
					? (source as IDBIndex).openCursor(opts.indexRange)
					: source.openCursor();
				let skipped = 0;
				let visited = 0;
				let stop = false;
				const targetSkip = Math.max(0, opts.skip ?? 0);
				const targetTake = opts.take === undefined ? Infinity : Math.max(0, opts.take);

				req.onsuccess = (event: Event) => {
					const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
					if (!cursor || stop) return;
					if (skipped < targetSkip) {
						const remaining = targetSkip - skipped;
						skipped += remaining;
						try {
							cursor.advance(remaining);
						} catch {
							cursor.continue();
						}
						return;
					}
					let keepGoing = true;
					try {
						keepGoing = visit(cursor.value as T, cursor.key) !== false;
					} catch (e) {
						reject(e);
						return;
					}
					visited++;
					if (!keepGoing || visited >= targetTake) {
						stop = true;
						return;
					}
					cursor.continue();
				};

				tx.oncomplete = () => resolve(visited);
				tx.onerror = () => reject(tx.error ?? new Error(`idbWalk(${store}) failed`));
			})
	);
}
// ─── Keyset cursor reads ────────────────────────────────────────────────────
// Single-pass descending cursor for the compound `[cachedAt, id]` and
// `[cachedFromBlog, cachedAt, id]` indexes. `before` is the exclusive lower
// bound; absent = start from newest. The cursor stops after `take` rows.

export interface KeysetCursor {
	cachedAt: number;
	id: number;
}

export interface KeysetReadOpts {
	take: number;
	index: 'byCachedAt' | 'byBlogCachedAt';
	indexRange?: IDBKeyRange;
	before?: KeysetCursor;
}

export interface KeysetReadRow<T> {
	entry: T;
	key: IDBValidKey;
	cursor: KeysetCursor;
}

export async function idbReadKeyset<T>(
	opts: KeysetReadOpts
): Promise<KeysetReadRow<T>[]> {
	if (!browser) return [];
	const take = Math.max(0, opts.take);
	if (take === 0) return [];

	const db = await openCacheDB();
	const out: KeysetReadRow<T>[] = [];
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction(STORES.posts, 'readonly');
		const idx = tx.objectStore(STORES.posts).index(opts.index);
		let range: IDBKeyRange | undefined = opts.indexRange;
		if (opts.before) {
			const before = IDBKeyRange.bound(
				[Number.NEGATIVE_INFINITY],
				[opts.before.cachedAt, opts.before.id],
				false,
				false
			);
			range = range ? (intersectRanges(range, before) ?? undefined) : before;
			if (!range) {
				tx.oncomplete = () => resolve();
				return;
			}
		}
		const req = idx.openCursor(range, 'prev');
		req.onsuccess = (event: Event) => {
			const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
			if (!cursor) return;
			const value = cursor.value as T;
			const key = cursor.key as IDBValidKey;
			const keyArr = cursor.key as [number, number];
			out.push({
				entry: value,
				key,
				cursor: { cachedAt: keyArr[0], id: Number(keyArr[1]) }
			});
			if (out.length >= take) return;
			cursor.continue();
		};
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error('idbReadKeyset failed'));
		tx.onabort = () => reject(tx.error ?? new Error('idbReadKeyset aborted'));
	});
	return out;
}

function intersectRanges(a: IDBKeyRange, b: IDBKeyRange): IDBKeyRange | null {
	const lowA = a.lower ?? [];
	const highA = a.upper ?? [];
	const lowB = b.lower ?? [];
	const highB = b.upper ?? [];
	const cmpLo = compareKey(lowA, lowB);
	const cmpHi = compareKey(highA, highB);
	if (cmpLo > 0 || cmpHi < 0) return null;
	return IDBKeyRange.bound(cmpLo > 0 ? lowA : lowB, cmpHi < 0 ? highA : highB, false, false);
}

function compareKey(a: IDBValidKey | IDBKeyRange, b: IDBValidKey | IDBKeyRange): number {
	if (Array.isArray(a) && Array.isArray(b)) {
		const len = Math.max(a.length, b.length);
		for (let i = 0; i < len; i++) {
			const av = (a as ArrayLike<number>)[i] ?? -Infinity;
			const bv = (b as ArrayLike<number>)[i] ?? Infinity;
			if (av < bv) return -1;
			if (av > bv) return 1;
		}
		return 0;
	}
	if (a < (b as IDBValidKey)) return -1;
	if (a > (b as IDBValidKey)) return 1;
	return 0;
}

// ─── Read/write tx with in-transaction reads ────────────────────────────────
// Caller receives the open tx plus object stores; reads and writes share one
// atomic boundary. Avoids the read-modify-write race in `mergePostMeta`.

export type Stores = {
	posts: IDBObjectStore;
	blobs: IDBObjectStore;
	blobsIndex: IDBObjectStore;
	meta: IDBObjectStore;
	accounts: IDBObjectStore;
	accountInfos: IDBObjectStore;
	blogInfos: IDBObjectStore;
	settings: IDBObjectStore;
	followedBlogs: IDBObjectStore;
	avatars: IDBObjectStore;
};

export function runCacheTx<R>(
	mode: IDBTransactionMode,
	names: ReadonlyArray<StoreName>,
	fn: (tx: IDBTransaction, stores: Stores) => Promise<R>
): Promise<R> {
	return openCacheDB().then(
		(db) =>
			new Promise<R>((resolve, reject) => {
				const tx = db.transaction([...names], mode);
				const stores = {
					posts: tx.objectStore(STORES.posts),
					blobs: tx.objectStore(STORES.blobs),
					blobsIndex: tx.objectStore(STORES.blobsIndex),
					meta: tx.objectStore(STORES.meta),
					accounts: tx.objectStore(STORES.accounts),
					accountInfos: tx.objectStore(STORES.accountInfos),
					blogInfos: tx.objectStore(STORES.blogInfos),
					settings: tx.objectStore(STORES.settings),
					followedBlogs: tx.objectStore(STORES.followedBlogs),
					avatars: tx.objectStore(STORES.avatars)
				} as Stores;
				let result: R;
				let pending: Promise<R> | null = null;
				try {
					pending = Promise.resolve(fn(tx, stores));
				} catch (e) {
					reject(e instanceof Error ? e : new Error(String(e)));
					return;
				}
				pending
					.then((r) => {
						result = r;
					})
					.catch((e) => {
						try { tx.abort(); } catch { /* ignore */ }
						reject(e instanceof Error ? e : new Error(String(e)));
					});
				tx.oncomplete = () => resolve(result);
				tx.onerror = () => reject(tx.error ?? new Error('runCacheTx failed'));
				tx.onabort = () => reject(tx.error ?? new Error('runCacheTx aborted'));
			})
	);
}

