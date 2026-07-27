// ─── Meta + Avatars + Accounts + Settings + Followed blogs + Blog infos ───
// Thin wrappers over `idbGet`/`idbPut` for the JSON-shaped stores. All
// values are stored as plain JS objects — no string envelopes.

import { browser } from '$app/environment';
import { STORES, idbGet, idbPut, idbDelete, idbWalk, idbTx, openCacheDB } from './db';
import type { TumblrAccount, TumblrUser, TumblrBlog } from '$lib/types';

export async function getMeta<T>(key: string): Promise<T | undefined> {
	if (!browser) return undefined;
	return idbGet<T>(STORES.meta, key);
}
export async function setMeta<T>(key: string, value: T): Promise<void> {
	if (!browser) return;
	await idbPut(STORES.meta, key, value);
}

// ─── Avatars ────────────────────────────────────────────────────────────────
// Keyed by `${blog}_${size}`.

const FALLBACK_AVATAR =
	'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%234b5563"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';

interface AvatarMem {
	objectUrl: string;
	blog: string;
	size: number;
}
const avatarMemoryCache = new Map<string, AvatarMem>();

function avatarKey(blogName: string, size: number): string {
	return `${blogName}_${size}`;
}

async function findBestAvatar(blogName: string): Promise<{ key: string; size: number } | null> {
	let best: { key: string; size: number } | null = null;
	const prefix = `${blogName}_`;
	await idbWalk<Blob>(STORES.avatars, (_value, key) => {
		const keyStr = String(key);
		if (!keyStr.startsWith(prefix)) return;
		const s = parseInt(keyStr.substring(prefix.length), 10);
		if (!Number.isFinite(s)) return;
		if (!best || s > best.size) best = { key: keyStr, size: s };
	});
	return best;
}

export async function getCachedAvatar(blogName: string, size: number = 512): Promise<string> {
	if (!browser) return FALLBACK_AVATAR;
	try {
		const best = await findBestAvatar(blogName);
		if (best && best.size >= size) {
			const blob = await idbGet<Blob>(STORES.avatars, best.key);
			if (blob) return avatarMemoryCache.get(best.key)?.objectUrl ?? URL.createObjectURL(blob);
		}

		await new Promise((r) => setTimeout(r, Math.random() * 400));
		const fullBlogName = blogName.includes('.') ? blogName : `${blogName}.tumblr.com`;
		const response = await fetch(`https://api.tumblr.com/v2/blog/${fullBlogName}/avatar/${size}`);
		if (response.status === 429) {
			console.warn(`[Rate Limit] Avatar fetch for ${blogName} hit 429. Using fallback.`);
			if (best) {
				const blob = await idbGet<Blob>(STORES.avatars, best.key);
				if (blob) return URL.createObjectURL(blob);
			}
			return FALLBACK_AVATAR;
		}
		if (!response.ok) throw new Error(`Avatar fetch failed with status ${response.status}`);

		const blob = await response.blob();
		await idbPut(STORES.avatars, avatarKey(blogName, size), blob);
		if (best && best.key !== avatarKey(blogName, size)) {
			await idbDelete(STORES.avatars, best.key);
		}
		return URL.createObjectURL(blob);
	} catch (e) {
		console.error(`Failed to cache avatar for ${blogName}`, e);
		return FALLBACK_AVATAR;
	}
}

// ─── Accounts (auth) ────────────────────────────────────────────────────────

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

export async function loadAllAccounts(): Promise<TumblrAccount[]> {
	if (!browser) return [];
	const out: TumblrAccount[] = [];
	await idbWalk<TumblrAccount>(STORES.accounts, (value) => {
		if (isValidAccount(value)) out.push(value);
	});
	return out;
}

export async function saveAccount(account: TumblrAccount): Promise<void> {
	if (!browser) return;
	await idbPut(STORES.accounts, account.blogName, account);
}

export async function deleteAccount(blogName: string): Promise<void> {
	if (!browser) return;
	await idbDelete(STORES.accounts, blogName);
}

/** Single-tx: put every account, delete any removed keys. No clear-then-put race. */
export async function saveAllAccounts(accounts: TumblrAccount[]): Promise<void> {
	if (!browser) return;
	const db = await openCacheDB();
	const existingKeys = await new Promise<IDBValidKey[]>((resolve, reject) => {
		const tx = db.transaction(STORES.accounts, 'readonly');
		const req = tx.objectStore(STORES.accounts).getAllKeys();
		req.onsuccess = () => resolve(req.result ?? []);
		tx.onerror = () => reject(tx.error ?? new Error('saveAllAccounts keys failed'));
	});
	const keepKeys = new Set(accounts.map((a) => a.blogName));
	const ops: Array<
		| { store: typeof STORES.accounts; op: 'put'; key: IDBValidKey; value: TumblrAccount }
		| { store: typeof STORES.accounts; op: 'delete'; key: IDBValidKey }
	> = [];
	for (const a of accounts) ops.push({ store: STORES.accounts, op: 'put', key: a.blogName, value: a });
	for (const k of existingKeys) {
		if (!keepKeys.has(String(k))) ops.push({ store: STORES.accounts, op: 'delete', key: k });
	}
	await idbTx(ops);
}

// ─── Account Infos (user objects) ───────────────────────────────────────────

interface CachedAccountInfo {
	user: TumblrUser;
	cachedAt: number;
}

export async function loadAllAccountInfos(): Promise<Record<string, TumblrUser>> {
	if (!browser) return {};
	const out: Record<string, TumblrUser> = {};
	await idbWalk<CachedAccountInfo>(STORES.accountInfos, (value, key) => {
		if (value?.user) out[String(key)] = value.user;
	});
	return out;
}

export async function setAccountInfo(blogName: string, user: TumblrUser): Promise<void> {
	if (!browser) return;
	await idbPut<CachedAccountInfo>(STORES.accountInfos, blogName, {
		user,
		cachedAt: Date.now()
	});
}

// ─── Blog Infos ─────────────────────────────────────────────────────────────

export interface CachedBlogInfo {
	share_likes: boolean;
	likes?: number;
	updated?: number;
	full?: TumblrBlog;
	cachedAt: number;
}

export async function getCachedBlogInfo(blogName: string): Promise<CachedBlogInfo | null> {
	if (!browser) return null;
	const v = await idbGet<CachedBlogInfo>(STORES.blogInfos, blogName);
	return v ?? null;
}

export async function setCachedBlogInfo(blogName: string, info: CachedBlogInfo): Promise<void> {
	if (!browser) return;
	await idbPut(STORES.blogInfos, blogName, info);
}

// ─── Followed Blogs ─────────────────────────────────────────────────────────

export interface CachedFollowedList {
	accountBlogName: string;
	blogs: TumblrBlog[];
	cachedAt: number;
}

export async function loadAllFollowedBlogLists(): Promise<CachedFollowedList[]> {
	if (!browser) return [];
	const out: CachedFollowedList[] = [];
	await idbWalk<CachedFollowedList>(STORES.followedBlogs, (value) => {
		if (value) out.push(value);
	});
	return out;
}

export async function saveFollowedBlogsForAccount(
	accountBlogName: string,
	blogs: TumblrBlog[]
): Promise<void> {
	if (!browser) return;
	await idbPut<CachedFollowedList>(STORES.followedBlogs, accountBlogName, {
		accountBlogName,
		blogs,
		cachedAt: Date.now()
	});
}

export async function getCachedFollowedBlogs(): Promise<TumblrBlog[]> {
	if (!browser) return [];
	const all = await loadAllFollowedBlogLists();
	const merged: TumblrBlog[] = [];
	const seen = new Set<string>();
	for (const entry of all) {
		for (const b of entry.blogs) {
			if (b?.name && !seen.has(b.name)) {
				seen.add(b.name);
				merged.push(b);
			}
		}
	}
	return merged;
}

// ─── Settings ───────────────────────────────────────────────────────────────

export interface Settings {
	autoCacheMedia: boolean;
	mediaColumns: string;
	blogCardColumns: string;
}

export const DEFAULT_SETTINGS: Settings = {
	autoCacheMedia: true,
	mediaColumns: 'auto',
	blogCardColumns: 'auto'
};

const SETTINGS_KEY = 'app';

export async function loadSettings(): Promise<Settings> {
	if (!browser) return { ...DEFAULT_SETTINGS };
	const v = await idbGet<Settings>(STORES.settings, SETTINGS_KEY);
	if (v && typeof v === 'object') return { ...DEFAULT_SETTINGS, ...v };
	return { ...DEFAULT_SETTINGS };
}

export async function saveSettings(value: Settings): Promise<void> {
	if (!browser) return;
	await idbPut(STORES.settings, SETTINGS_KEY, value);
}

export { STORES } from './db';
export { clearCache, clearMediaCache } from './clear';