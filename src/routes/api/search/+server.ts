import { forAccounts, readAccounts } from '$lib/server/clients';
import type { RequestHandler } from './$types';

/**
 * Tagged search. The /tagged endpoint is api-key-scoped (not account-scoped),
 * so we accept the multi-account payload for API uniformity but use only the
 * first usable account's client.
 */
export const POST: RequestHandler = async ({ request }) => {
	const accounts = await readAccounts(request);
	if (!accounts || accounts.length === 0) {
		return new Response('Invalid account payload', { status: 400 });
	}

	// Route fields ride on the account objects (single body read — see
	// readAccounts contract).
	const body0 = accounts[0] as (typeof accounts)[number] & {
		query?: string;
		before?: string | number;
		type?: string;
	};
	const { query, before, type } = body0 ?? {};

	if (!query) {
		return new Response('Query is required', { status: 400 });
	}

	const cleanQuery = query.startsWith('#') ? query.substring(1) : query;

	const results = await forAccounts(accounts, async (client) => {
		const params: Record<string, unknown> = {
			limit: 20,
			npf: true,
			reblog_info: true
		};
		if (before) {
			params.before = before.toString();
		}
		if (type && type !== 'all') {
			params.type = type;
		}
		return client.taggedPosts(cleanQuery, params);
	});

	const first = results.find((r) => r.ok);
	if (!first) {
		const error = results.find((r) => r.error)?.error ?? 'No usable account';
		return new Response(error, { status: 502 });
	}

	const data = first.value as { posts?: unknown[] } | unknown[] | null;
	const posts = (Array.isArray(data) ? data : data?.posts) ?? [];

	return new Response(JSON.stringify({ posts, response: data }), {
		headers: { 'Content-Type': 'application/json' }
	});
};
