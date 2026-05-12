import { writable, type Writable } from 'svelte/store';
import { browser } from '$app/environment';

export interface TumblrAccount {
	blogName: string;
	token: string;
	secret: string;
	avatarUrl?: string;
	active: boolean;
}

const STORAGE_KEY = 'tumblr_accounts';

function createAccountsStore() {
	// Initialize from localStorage if available
	const initial: TumblrAccount[] = browser
		? JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
		: [];

	const { subscribe, set, update }: Writable<TumblrAccount[]> = writable(initial);

	return {
		subscribe,
		addAccount: (account: TumblrAccount) =>
			update((accounts) => {
				// Prevent duplicates
				const existingIndex = accounts.findIndex((a) => a.blogName === account.blogName);
				let newAccounts;
				if (existingIndex >= 0) {
					newAccounts = [...accounts];
					newAccounts[existingIndex] = { ...account, active: accounts[existingIndex].active };
				} else {
					newAccounts = [...accounts, account];
				}
				if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(newAccounts));
				return newAccounts;
			}),
		removeAccount: (blogName: string) =>
			update((accounts) => {
				const newAccounts = accounts.filter((a) => a.blogName !== blogName);
				if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(newAccounts));
				return newAccounts;
			}),
		toggleActive: (blogName: string) =>
			update((accounts) => {
				const newAccounts = accounts.map((a) =>
					a.blogName === blogName ? { ...a, active: !a.active } : a
				);
				if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(newAccounts));
				return newAccounts;
			})
	};
}

export const accounts = createAccountsStore();
