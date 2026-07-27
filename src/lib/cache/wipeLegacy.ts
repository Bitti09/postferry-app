// ─── Wipe any DB whose name starts with `tumblr-`, `tmblr-`, or `keyval` ──
// Plus the previously-named legacy DBs and `tmblr_*`/`tumblr_*` localStorage.
// The current `tmblr-cache` survives. Idempotent.

import { browser } from '$app/environment';

const LEGACY_DB_NAMES: string[] = [
	'keyval-store',
	'tumblr-media-blobs',
	'tumblr-avatars',
	'tumblr-followed-blogs'
];

const LEGACY_DYNAMIC_PREFIXES = ['tumblr-', 'tmblr-', 'keyval'];
const PROTECTED_DB_NAMES = new Set<string>(['tmblr-cache']);

const EXACT_LOCALSTORAGE_KEYS = ['tmblr_settings', 'tumblr_account_infos'];
const PREFIX_LOCALSTORAGE_KEYS = ['tmblr_', 'tumblr_blog_info_'];

function shouldWipeName(name: string): boolean {
	if (PROTECTED_DB_NAMES.has(name)) return false;
	if (LEGACY_DB_NAMES.includes(name)) return true;
	for (const prefix of LEGACY_DYNAMIC_PREFIXES) {
		if (name.startsWith(prefix)) return true;
	}
	return false;
}

function deleteDatabase(name: string): Promise<void> {
	return new Promise((resolve) => {
		try {
			const req = indexedDB.deleteDatabase(name);
			req.onsuccess = () => resolve();
			req.onerror = () => resolve();
			req.onblocked = () => resolve();
		} catch {
			resolve();
		}
	});
}

async function listAdditionalLegacyNames(): Promise<string[]> {
	const out = new Set<string>();
	try {
		const dbs = await (indexedDB as unknown as { databases?: () => Promise<Array<{ name?: string }>> }).databases?.();
		if (!Array.isArray(dbs)) return [];
		for (const d of dbs) {
			const name = d?.name;
			if (name && shouldWipeName(name)) out.add(name);
		}
	} catch {}
	return [...out];
}

async function clearLocalStorage(): Promise<void> {
	if (!browser) return;
	const ls = window.localStorage;
	for (const key of EXACT_LOCALSTORAGE_KEYS) {
		try {
			ls.removeItem(key);
		} catch {}
	}
	try {
		const allKeys: string[] = [];
		for (let i = 0; i < ls.length; i++) {
			const k = ls.key(i);
			if (k) allKeys.push(k);
		}
		for (const k of allKeys) {
			for (const prefix of PREFIX_LOCALSTORAGE_KEYS) {
				if (k.startsWith(prefix)) {
					try {
						ls.removeItem(k);
					} catch {}
					break;
				}
			}
		}
	} catch {}
}

export async function wipeLegacy(): Promise<void> {
	if (!browser) return;

	const targets = new Set<string>(LEGACY_DB_NAMES);
	const extras = await listAdditionalLegacyNames();
	for (const n of extras) targets.add(n);

	await Promise.allSettled([...targets].map(deleteDatabase));
	await clearLocalStorage();
}