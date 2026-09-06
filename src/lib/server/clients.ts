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

export interface ParsedAccountsBody {
	/** Normalized: `accounts[]`, or `[account]` when a single-account payload. */
	accounts: (AccountCredentials & Record<string, unknown>)[];
	/** Route-specific fields (blogName, postId, offsets, ...) verbatim. */
	[key: string]: unknown;
}

/**
 * Read the request body EXACTLY once and normalize the account list.
 * Accepts `{ accounts: [...] }` (multi-account) or `{ account: {...} }`
 * (legacy single-account). Returns the whole parsed body so callers
 * destructure route-specific fields from the top level — the body cannot
 * be read again ("Body has already been read" throws otherwise).
 * Returns null on malformed JSON or an absent/empty account list.
 */
export async function readAccounts(request: Request): Promise<ParsedAccountsBody | null> {
	try {
		const body = (await request.json()) as Record<string, unknown>;
		const raw = Array.isArray(body.accounts)
			? body.accounts
			: body.account
				? [body.account]
				: null;
		if (!raw || raw.length === 0) return null;
		return { ...body, accounts: raw as (AccountCredentials & Record<string, unknown>)[] };
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
