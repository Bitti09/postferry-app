import { writable, type Writable } from 'svelte/store';
import { browser } from '$app/environment';
import { getCachedAccounts, setCachedAccounts } from './db';

export interface TumblrAccount {
	blogName: string;
	token: string;
	secret: string;
	avatarUrl?: string;
	active: boolean;
}

function createAccountsStore() {
	const { subscribe, set, update }: Writable<TumblrAccount[]> = writable([]);

	// Debounced persistence to avoid IDB writes on every single toggle
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	function scheduleSave(accounts: TumblrAccount[]) {
		if (!browser) return;
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => setCachedAccounts(accounts), 300);
	}

	if (browser) {
		// Initialize async from our Storage Bucket
		getCachedAccounts().then(cached => {
			if (cached && cached.length > 0) {
				set(cached);
			}
		});
	}

	return {
		subscribe,
		addAccount: (account: TumblrAccount) =>
			update((accounts) => {
				const existingIndex = accounts.findIndex((a) => a.blogName === account.blogName);
				let newAccounts;
				if (existingIndex >= 0) {
					newAccounts = [...accounts];
					newAccounts[existingIndex] = { ...account, active: accounts[existingIndex].active };
				} else {
					newAccounts = [...accounts, account];
				}
				scheduleSave(newAccounts);
				return newAccounts;
			}),
		removeAccount: (blogName: string) =>
			update((accounts) => {
				const newAccounts = accounts.filter((a) => a.blogName !== blogName);
				scheduleSave(newAccounts);
				return newAccounts;
			}),
		toggleActive: (blogName: string) =>
			update((accounts) => {
				const newAccounts = accounts.map((a) =>
					a.blogName === blogName ? { ...a, active: !a.active } : a
				);
				scheduleSave(newAccounts);
				return newAccounts;
			})
	};
}

export const accounts = createAccountsStore();
