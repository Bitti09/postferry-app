// ─── Account Persistence ─────────────────────────────────────────────────────
// Uses the app-state bucket. All values typed; no `any`.

import { isBrowser, getStore, setStore, entriesStore, type BucketConfig } from './idb';
import type { TumblrAccount } from '$lib/types';

const APP_BUCKET: BucketConfig = {
	bucketName: 'tumblr-app-state',
	dbName: 'keyval-store',
	storeName: 'keyval'
};

const ACCOUNTS_KEY = 'tumblr_cached_accounts';

export async function loadCachedAccounts(): Promise<TumblrAccount[]> {
	if (!isBrowser()) return [];
	try {
		const raw = await getStore<unknown>(APP_BUCKET, ACCOUNTS_KEY);
		if (!raw || !Array.isArray(raw)) return [];
		return raw.filter(isValidAccount);
	} catch {
		return [];
	}
}

export async function saveCachedAccounts(accounts: TumblrAccount[]): Promise<void> {
	if (!isBrowser()) return;
	try {
		await setStore(APP_BUCKET, ACCOUNTS_KEY, accounts);
	} catch (e) {
		console.error('Failed to persist accounts:', e);
	}
}

function isValidAccount(item: unknown): item is TumblrAccount {
	if (!item || typeof item !== 'object') return false;
	const a = item as Record<string, unknown>;
	return (
		typeof a.blogName === 'string' &&
		typeof a.token === 'string' &&
		typeof a.secret === 'string' &&
		typeof a.active === 'boolean'
	);
}
