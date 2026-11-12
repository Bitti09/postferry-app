import { forAccounts, readAccounts } from '#lib/server/clients';
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

	const results = await forAccounts(accounts, (client) => client.userInfo());

	return Response.json({
		results: results.map((result) => ({
			accountBlogName: result.accountBlogName,
			ok: result.ok,
			user: result.ok ? result.value?.user : undefined,
			error: result.ok ? undefined : result.error
		}))
	});
};
