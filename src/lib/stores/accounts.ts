// ─── Accounts store ─────────────────────────────────────────────────────────
// Reactive `accounts` writable backed by the `accounts` IDB store. Persists
// via debounced `saveAllAccounts` (single-tx put+delete, not clear+put).

import { writable, type Writable } from 'svelte/store';
import { browser } from '$app/env';
import { loadAllAccounts, saveAllAccounts } from '#lib/cache/meta';
import type { TumblrAccount } from '#lib/types';

const DEBOUNCE_MS = 300;

export const accountsReady = writable(false);

function createAccountsStore() {
	const { subscribe, set, update }: Writable<TumblrAccount[]> = writable([]);
	let saveTimer: ReturnType<typeof setTimeout> | null = null;

	function scheduleSave(accounts: TumblrAccount[]): void {
		if (!browser) return;
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => void saveAllAccounts(accounts), DEBOUNCE_MS);
	}

	if (browser) {
		loadAllAccounts()
			.then((cached) => {
				if (cached?.length) set(cached);
				accountsReady.set(true);
			})
			.catch(() => {
				accountsReady.set(true);
			});
	}

	return {
		subscribe,
		addAccount(account: TumblrAccount) {
			update((accounts) => {
				const idx = accounts.findIndex((a) => a.blogName === account.blogName);
				const next = idx >= 0
					? accounts.map((a, i) => (i === idx ? { ...account, active: a.active } : a))
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
		flush() {
			if (saveTimer) {
				clearTimeout(saveTimer);
				saveTimer = null;
				let current: TumblrAccount[] = [];
				subscribe((v) => (current = v))();
				void saveAllAccounts(current);
			}
		}
	};
}

export const accounts = createAccountsStore();

if (browser) {
	// `pagehide` is the modern, bfcache-friendly unload signal. `beforeunload`
	// is deliberately not used: it disables the back/forward cache and is
	// redundant for best-effort persistence.
	const flush = () => accounts.flush();
	addEventListener('pagehide', flush);
}