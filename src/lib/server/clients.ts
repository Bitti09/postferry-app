import { Client } from 'tumblr.js';
import { TUMBLR_CONSUMER_KEY, TUMBLR_CONSUMER_SECRET } from '$env/static/private';

export interface AccountCredentials {
	blogName: string;
	token?: string;
	secret?: string;
}

export interface AccountResult<T> {
	accountBlogName: string;
	ok: boolean;
	/** Defined only when ok. */
	value?: T;
	/** Defined only when !ok. */
	error?: string;
}

// One tumblr.js Client per token set — constructing clients is cheap but
// a busy multi-account session rebuilds them on every request otherwise.
const clientCache = new Map<string, Client>();

export function clientFor(account: AccountCredentials): Client | null {
	if (!account.token || !account.secret) return null;
	const cacheKey = `${account.token}:${account.secret}`;
	let client = clientCache.get(cacheKey);
	if (!client) {
		client = new Client({
			consumer_key: TUMBLR_CONSUMER_KEY,
			consumer_secret: TUMBLR_CONSUMER_SECRET,
			token: account.token,
			token_secret: account.secret
		});
		if (clientCache.size > 64) clientCache.clear();
		clientCache.set(cacheKey, client);
	}
	return client;
}

/**
 * Parse a request body carrying either `accounts: AccountCredentials[]` or a
 * single `account`, and return the WHOLE parsed body — callers destructure
 * both the account fields and their route-specific fields from the same
 * objects. The request body can only be read ONCE; routes must never call
 * `request.json()` again after this (it throws "Body has already been read").
 *
 * Returns null on malformed JSON or an absent/empty account list.
 */
export async function readAccounts(
	request: Request
): Promise<(AccountCredentials & Record<string, unknown>)[] | null> {
	try {
		const body = (await request.json()) as {
			accounts?: (AccountCredentials & Record<string, unknown>)[];
			account?: AccountCredentials & Record<string, unknown>;
		};
		const list = Array.isArray(body.accounts)
			? body.accounts
			: body.account
				? [body.account]
				: null;
		if (!list || list.length === 0) return null;
		return list;
	} catch {
		return null;
	}
}

/**
 * Run `fn` for each account in parallel with per-account error isolation.
 * Failures become `{ ok: false, error }` entries — one expired token never
 * takes down the whole multi-account page.
 */
export async function forAccounts<T>(
	accounts: AccountCredentials[],
	fn: (client: Client, account: AccountCredentials) => Promise<T>
): Promise<AccountResult<T>[]> {
	return Promise.all(
		accounts.map(async (account): Promise<AccountResult<T>> => {
			const client = clientFor(account);
			if (!client) {
				return { accountBlogName: account.blogName, ok: false, error: 'missing credentials' };
			}
			try {
				return { accountBlogName: account.blogName, ok: true, value: await fn(client, account) };
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				console.error(`[forAccounts] ${account.blogName}:`, message);
				return { accountBlogName: account.blogName, ok: false, error: message };
			}
		})
	);
}

/** Collect the successful values from a forAccounts result. */
export function okValues<T>(results: AccountResult<T>[]): T[] {
	return results.flatMap((r) => (r.ok && r.value !== undefined ? [r.value] : []));
}
