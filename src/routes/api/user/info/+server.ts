import { forAccounts, readAccounts } from '$lib/server/clients';
import type { RequestHandler } from './$types';

/** User info for every account in the payload (multi-account aware). */
export const POST: RequestHandler = async ({ request }) => {
	const accounts = await readAccounts(request);
	if (!accounts || accounts.length === 0) {
		return new Response('Missing required parameters', { status: 400 });
	}

	// tumblr.js types userInfo() as `Promise<any> | undefined` (callback API
	// legacy); promise form always returns, so the assertion is sound.
	const results = await forAccounts(accounts, (client) => client.userInfo() as Promise<any>);
	const ok = results.filter((r) => r.ok);

	return new Response(JSON.stringify({
		users: ok.map((r) => ({ accountBlogName: r.accountBlogName, user: (r.value as { user?: unknown }).user })),
		response: ok.map((r) => r.value)
	}), {
		headers: { 'Content-Type': 'application/json' }
	});
};
