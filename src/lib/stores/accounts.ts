import { writable, type Writable } from 'svelte/store';
import { browser } from '$app/environment';
import { loadCachedAccounts, saveCachedAccounts } from '$lib/db/accounts';
import type { TumblrAccount } from '$lib/types';

const DEBOUNCE_MS = 300;

/** Becomes `true` after the first IndexedDB load attempt completes (even if empty). */
export const accountsReady = writable(false);

function createAccountsStore() {
	const { subscribe, set, update }: Writable<TumblrAccount[]> = writable([]);

	let saveTimer: ReturnType<typeof setTimeout> | null = null;

	function scheduleSave(accounts: TumblrAccount[]): void {
		if (!browser) return;
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => saveCachedAccounts(accounts), DEBOUNCE_MS);
	}

	// Initialize from IndexedDB
	if (browser) {
		loadCachedAccounts().then((cached) => {
			if (cached?.length) set(cached);
			// Always signal readiness so consumers can distinguish
			// "not loaded yet" from "loaded and truly empty"
			accountsReady.set(true);
		});
	}

	return {
		subscribe,
		addAccount(account: TumblrAccount) {
			update((accounts) => {
				const idx = accounts.findIndex((a) => a.blogName === account.blogName);
				const next = idx >= 0
					? accounts.map((a, i) => i === idx ? { ...account, active: a.active } : a)
					: [...accounts, account];
				scheduleSave(next);
				return next;
			});
		},
		removeAccount(blogName: string) {
			update((accounts) => {
				const next = accounts.filter((a) => a.blogName !== blogName);
				scheduleSave(next);
				return next;
			});
		},
		toggleActive(blogName: string) {
			update((accounts) => {
				const next = accounts.map((a) =>
					a.blogName === blogName ? { ...a, active: !a.active } : a
				);
				scheduleSave(next);
				return next;
			});
		},
		/** Persist immediately (e.g., on page unload). */
		flush() {
			if (saveTimer) {
				clearTimeout(saveTimer);
				saveTimer = null;
				// Get current value and save
				let current: TumblrAccount[] = [];
				subscribe((v) => (current = v))();
				saveCachedAccounts(current);
			}
		}
	};
}

export const accounts = createAccountsStore();

// Flush on page hide/unload
if (browser) {
	const flush = () => accounts.flush();
	addEventListener('pagehide', flush);
	addEventListener('beforeunload', flush);
}