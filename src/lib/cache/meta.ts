import { browser } from '$app/env';
import { db } from './newDb';
import type { TumblrAccount, TumblrUser, TumblrBlog } from '#lib/types';
import type { CachedAccountInfo, CachedBlogInfo, CachedFollowedList } from './newDb';

export async function getMeta<T>(key: string): Promise<T | undefined> {
	if (!browser) return undefined;
	const res = await db.meta.get(key);
	return res?.value as T | undefined;
}

export async function setMeta<T>(key: string, value: T): Promise<void> {
	if (!browser) return;
	await db.meta.put({ key, value });
}

// ─── Avatars ────────────────────────────────────────────────────────────────
const FALLBACK_AVATAR =
	'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%234b5563"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';

interface AvatarMem {
	blob: Blob;
	objectUrl: string;
}
const avatarMemoryCache = new Map<string, AvatarMem>();

function avatarKey(blogName: string, size: number): string {
	return `${blogName}_${size}`;
}

function getAvatarUrl(key: string, blob: Blob): string {
	const existing = avatarMemoryCache.get(key);
	if (existing) return existing.objectUrl;
	const objectUrl = URL.createObjectURL(blob);
	avatarMemoryCache.set(key, { blob, objectUrl });
	return objectUrl;
}

function replaceAvatarUrl(key: string, blob: Blob): string {
	const existing = avatarMemoryCache.get(key);
	if (existing) URL.revokeObjectURL(existing.objectUrl);
	const objectUrl = URL.createObjectURL(blob);
	avatarMemoryCache.set(key, { blob, objectUrl });
	return objectUrl;
}

async function findBestAvatar(blogName: string): Promise<{ key: string; size: number } | null> {
	let best: { key: string; size: number } | null = null;
	const prefix = `${blogName}_`;
	await db.avatars.each((avatar) => {
		if (!avatar.id.startsWith(prefix)) return;
		const s = parseInt(avatar.id.substring(prefix.length), 10);
		if (!Number.isFinite(s)) return;
		if (!best || s > best.size) best = { key: avatar.id, size: s };
	});
	return best;
}

export async function getCachedAvatar(blogName: string, size: number = 512): Promise<string> {
	if (!browser) return FALLBACK_AVATAR;
	let best: { key: string; size: number } | null = null;
	try {
		best = await findBestAvatar(blogName);
		if (best && best.size >= size) {
			const entry = await db.avatars.get(best.key);
			if (entry?.blob) return getAvatarUrl(best.key, entry.blob);
		}

		if (!navigator.onLine) {
			if (best) {
				const entry = await db.avatars.get(best.key);
				if (entry?.blob) return getAvatarUrl(best.key, entry.blob);
			}
			return FALLBACK_AVATAR;
		}

		await new Promise((r) => setTimeout(r, Math.random() * 400));
		// Avatars go through the app's same-origin proxy, which uses the
		// postferry client; the browser never calls Tumblr directly.
		const response = await fetch(`/api/avatar?blog=${encodeURIComponent(blogName)}&size=${size}`);
		if (response.status === 429) {
			console.warn(`[Rate Limit] Avatar fetch for ${blogName} hit 429. Using fallback.`);
			if (best) {
				const entry = await db.avatars.get(best.key);
				if (entry?.blob) return getAvatarUrl(best.key, entry.blob);
			}
			return FALLBACK_AVATAR;
		}
		if (!response.ok) throw new Error(`Avatar fetch failed with status ${response.status}`);

		const blob = await response.blob();
		await db.avatars.put({ id: avatarKey(blogName, size), blob });
		if (best && best.key !== avatarKey(blogName, size)) {
			await db.avatars.delete(best.key);
		}
		return replaceAvatarUrl(avatarKey(blogName, size), blob);
	} catch (e) {
		if (best) {
			try {
				const entry = await db.avatars.get(best.key);
				if (entry?.blob) return getAvatarUrl(best.key, entry.blob);
			} catch {}
		}
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
	return await db.accounts.toArray();
}

export async function saveAccount(account: TumblrAccount): Promise<void> {
	if (!browser) return;
	await db.accounts.put(account);
}

export async function deleteAccount(blogName: string): Promise<void> {
	if (!browser) return;
	await db.accounts.delete(blogName);
}

export async function saveAllAccounts(accounts: TumblrAccount[]): Promise<void> {
	if (!browser) return;
	await db.transaction('rw', db.accounts, async () => {
		const keepKeys = new Set(accounts.map((a) => a.blogName));
		const existingKeys = await db.accounts.toCollection().primaryKeys();
		const toDelete = existingKeys.filter(k => !keepKeys.has(k));
		await db.accounts.bulkDelete(toDelete);
		await db.accounts.bulkPut(accounts);
	});
}

// ─── Account Infos (user objects) ───────────────────────────────────────────

export async function loadAllAccountInfos(): Promise<Record<string, TumblrUser>> {
	if (!browser) return {};
	const out: Record<string, TumblrUser> = {};
	await db.accountInfos.each((value) => {
		if (value?.user) out[value.blogName] = value.user;
	});
	return out;
}

export async function setAccountInfo(blogName: string, user: TumblrUser): Promise<void> {
	if (!browser) return;
	// Callers may hand us a Svelte $state proxy; IDB structured clone rejects
	// proxies (DataCloneError). Round-trip to plain data first.
	const plain: TumblrUser = JSON.parse(JSON.stringify(user));
	await db.accountInfos.put({
		blogName,
		user: plain,
		cachedAt: Date.now()
	});
}

// ─── Blog Infos ─────────────────────────────────────────────────────────────

export async function getCachedBlogInfo(blogName: string): Promise<CachedBlogInfo | null> {
	if (!browser) return null;
	const v = await db.blogInfos.get(blogName);
	return v ?? null;
}

export async function setCachedBlogInfo(blogName: string, info: CachedBlogInfo): Promise<void> {
	if (!browser) return;
	await db.blogInfos.put({ ...info, blogName });
}

// ─── Followed Blogs ─────────────────────────────────────────────────────────

export async function loadAllFollowedBlogLists(): Promise<CachedFollowedList[]> {
	if (!browser) return [];
	return await db.followedBlogs.toArray();
}

export async function saveFollowedBlogsForAccount(
	accountBlogName: string,
	blogs: TumblrBlog[]
): Promise<void> {
	if (!browser) return;
	// Callers may hand us a Svelte $state proxy array or proxied blog objects
	// (the following page keeps `followedBlogs` in $state and passes it back
	// verbatim); IDB structured clone rejects proxies (DataCloneError).
	// Round-trip to plain data first, same defense as setAccountInfo above.
	await db.followedBlogs.put({
		accountBlogName,
		blogs: JSON.parse(JSON.stringify(blogs)),
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
	const v = await db.settings.get(SETTINGS_KEY);
	if (v && v.value && typeof v.value === 'object') return { ...DEFAULT_SETTINGS, ...v.value };
	return { ...DEFAULT_SETTINGS };
}

export async function saveSettings(value: Settings): Promise<void> {
	if (!browser) return;
	await db.settings.put({ key: SETTINGS_KEY, value });
}

export { clearCache, clearMediaCache } from './clear';