// ─── IndexedDB Wrapper ───────────────────────────────────────────────────────
// Low-level bucket-aware IDB operations. All promises use withResolvers().
// No `any` — values are typed at the store level.

import { browser } from '$app/environment';

export interface BucketConfig {
	bucketName: string;
	dbName: string;
	storeName: string;
}

async function openDB(cfg: BucketConfig): Promise<IDBDatabase> {
	const { promise, resolve, reject } = Promise.withResolvers<IDBDatabase>();

	try {
		let idbFactory: IDBFactory = window.indexedDB;

		if ('storageBuckets' in navigator) {
			const nav = navigator as unknown as {
				storageBuckets: {
					open(name: string, opts: { persisted: boolean; durability: string }): Promise<{ indexedDB: IDBFactory }>;
				};
			};
			const isAppState = cfg.bucketName === 'tumblr-app-state';
			const bucket = await nav.storageBuckets.open(cfg.bucketName, {
				persisted: isAppState,
				durability: isAppState ? 'strict' : 'relaxed'
			});
			idbFactory = bucket.indexedDB;
		}

		const req = idbFactory.open(cfg.dbName, 1);
		req.onupgradeneeded = () => {
			req.result.createObjectStore(cfg.storeName);
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error ?? new Error(`IDB open failed for ${cfg.bucketName}:${cfg.dbName}:${cfg.storeName}`));
	} catch (e) {
		reject(e instanceof Error ? e : new Error(String(e)));
	}

	return promise;
}

export function withStore<T>(
	cfg: BucketConfig,
	mode: IDBTransactionMode,
	callback: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T | undefined> {
	const { promise, resolve, reject } = Promise.withResolvers<T | undefined>();

	openDB(cfg)
		.then((db) => {
			const tx = db.transaction(cfg.storeName, mode);
			tx.onerror = () => reject(tx.error ?? new Error('IDB transaction failed'));
			tx.onabort = () => reject(tx.error ?? new Error('IDB transaction aborted'));

			const request = callback(tx.objectStore(cfg.storeName));
			if (request) {
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error ?? new Error('IDB request failed'));
			} else {
				resolve(undefined);
			}
		})
		.catch(reject);

	return promise;
}

export function getStore<T>(cfg: BucketConfig, key: IDBValidKey): Promise<T | undefined> {
	return withStore<T>(cfg, 'readonly', (store) => store.get(key));
}

export function setStore<T>(cfg: BucketConfig, key: IDBValidKey, value: T): Promise<void> {
	return withStore<void>(cfg, 'readwrite', (store) => {
		store.put(value, key);
	});
}

export function deleteStore(cfg: BucketConfig, key: IDBValidKey): Promise<void> {
	return withStore<void>(cfg, 'readwrite', (store) => {
		store.delete(key);
	});
}

export function clearStore(cfg: BucketConfig): Promise<void> {
	return withStore<void>(cfg, 'readwrite', (store) => {
		store.clear();
	});
}

export function entriesStore<T>(cfg: BucketConfig): Promise<Array<[IDBValidKey, T]>> {
	const { promise, resolve, reject } = Promise.withResolvers<Array<[IDBValidKey, T]>>();

	openDB(cfg)
		.then((db) => {
			const tx = db.transaction(cfg.storeName, 'readonly');
			const results: Array<[IDBValidKey, T]> = [];
			tx.objectStore(cfg.storeName).openCursor().onsuccess = (event: Event) => {
				const target = event.target as IDBRequest<IDBCursorWithValue | null>;
				const cursor = target.result;
				if (cursor) {
					results.push([cursor.key, cursor.value as T]);
					cursor.continue();
				}
			};
			tx.oncomplete = () => {
						resolve(results);
					};
			tx.onerror = () => reject(tx.error ?? new Error('IDB entries transaction failed'));
		})
		.catch(reject);

	return promise;
}

export function isBrowser(): boolean {
	return browser;
}
