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
				if (browser) setCachedAccounts(newAccounts);
				return newAccounts;
			}),
		removeAccount: (blogName: string) =>
			update((accounts) => {
				const newAccounts = accounts.filter((a) => a.blogName !== blogName);
				if (browser) setCachedAccounts(newAccounts);
				return newAccounts;
			}),
		toggleActive: (blogName: string) =>
			update((accounts) => {
				const newAccounts = accounts.map((a) =>
					a.blogName === blogName ? { ...a, active: !a.active } : a
				);
				if (browser) setCachedAccounts(newAccounts);
				return newAccounts;
			})
	};
}

export const accounts = createAccountsStore();
