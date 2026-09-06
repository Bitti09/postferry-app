import { forAccounts, readAccounts } from '$lib/server/clients';
import type { RequestHandler } from './$types';

/**
 * User info for every account in the payload (multi-account aware).
 * Response: { results: [{ accountBlogName, ok, user?, error? }] } — one
 * entry per requested account, in request order.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await readAccounts(request);
	if (!body) {
		return new Response('Missing required parameters', { status: 400 });
	}
	const { accounts } = body;

	const results = await forAccounts(accounts, (client) => client.userInfo() as Promise<any>);

	return new Response(JSON.stringify({
		results: results.map((r) => ({
			accountBlogName: r.accountBlogName,
			ok: r.ok,
			user: r.ok ? (r.value as { user?: unknown })?.user : undefined,
			error: r.ok ? undefined : r.error
		}))
	}), {
		headers: { 'Content-Type': 'application/json' }
	});
};
