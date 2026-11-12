import { TUMBLR_CONSUMER_KEY, TUMBLR_CONSUMER_SECRET } from '$app/env/private';
import {
	TumblrClient,
	fanOut,
	okValues,
	type AccountResult
} from 'postferry';

export type { AccountResult } from 'postferry';

export interface AccountCredentials {
	blogName: string;
	token?: string;
	secret?: string;
}

export interface ParsedAccountsBody {
	/** Normalized: `accounts[]`. */
	accounts: (AccountCredentials & Record<string, unknown>)[];
	/** Route-specific fields (blogName, postId, offsets, ...) verbatim. */
	[key: string]: unknown;
}

export const USER_AGENT = 'postferry-app/0.0.1 (+https://github.com/Bitti09/postferry-app)';

// One client per token set. Constructing clients is cheap, but a busy
// multi-account session would otherwise rebuild the WebCrypto keys per request.
const clientCache = new Map<string, TumblrClient>();

export function clientFor(account: AccountCredentials): TumblrClient | null {
	if (!account.token || !account.secret) return null;
	const cacheKey = `${account.token}:${account.secret}`;
	let client = clientCache.get(cacheKey);
	if (!client) {
		client = new TumblrClient({
			consumerKey: TUMBLR_CONSUMER_KEY,
			consumerSecret: TUMBLR_CONSUMER_SECRET,
			token: account.token,
			tokenSecret: account.secret,
			userAgent: USER_AGENT
		});
		if (clientCache.size > 64) clientCache.clear();
		clientCache.set(cacheKey, client);
	}
	return client;
}

/**
 * API-key client for endpoints that document API-key auth (notes, tagged,
 * blog info/posts). Using OAuth also works, but a key-only client avoids
 * needing a token for public reads and matches the documentation exactly.
 */
let apiKeyClient: TumblrClient | null = null;

export function publicClient(): TumblrClient {
	if (!apiKeyClient) {
		apiKeyClient = new TumblrClient({
			auth: { type: 'apiKey', consumerKey: TUMBLR_CONSUMER_KEY },
			userAgent: USER_AGENT
		});
	}
	return apiKeyClient;
}

/**
 * Read the request body EXACTLY once and validate the account list.
 * Every route takes one shape: `{ accounts: [...] }`. Returns the whole
 * parsed body so callers destructure route-specific fields from the top
 * level — the body cannot be read again ("Body has already been read").
 */
export async function readAccounts(request: Request): Promise<ParsedAccountsBody | null> {
	try {
		const body = (await request.json()) as Record<string, unknown>;
		const raw = body.accounts;
		if (!Array.isArray(raw) || raw.length === 0) return null;
		return { ...body, accounts: raw as (AccountCredentials & Record<string, unknown>)[] };
	} catch {
		return null;
	}
}

/**
 * Run `fn` for each account with bounded concurrency and per-account error
 * isolation. One expired token never takes down the whole multi-account page.
 */
export async function forAccounts<T>(
	accounts: AccountCredentials[],
	fn: (client: TumblrClient, account: AccountCredentials) => Promise<T>
): Promise<AccountResult<T>[]> {
	return fanOut(
		accounts,
		async (account) => {
			const client = clientFor(account);
			if (!client) throw new Error('missing credentials');
			try {
				return await fn(client, account);
			} catch (error) {
				// Keep the server log readable without leaking tokens.
				console.error(`[forAccounts] ${account.blogName}:`, error instanceof Error ? error.message : error);
				throw error;
			}
		},
		{ concurrency: 5 }
	);
}

export { okValues };
