import { forAccounts, readAccounts } from '#lib/server/clients';
import type { RequestHandler } from './$types';

/**
 * Like/unlike a post for every account with credentials.
 * The UI sends one account per click; batch sends fan out.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await readAccounts(request);
	if (!body) {
		return new Response('Missing required parameters', { status: 400 });
	}
	const { accounts } = body;
	const action = (body.action as string | undefined) ?? 'like';
	const postId = body.postId as string | number | undefined;
	const reblogKey = body.reblogKey as string | undefined;
	if (!postId || !reblogKey) {
		return new Response('Missing required parameters', { status: 400 });
	}

	const params = { id: String(postId), reblog_key: reblogKey };
	const results = await forAccounts(accounts, async (client) => {
		return action === 'unlike' ? client.unlike(params) : client.like(params);
	});

	const succeeded = results.filter((result) => result.ok);
	if (succeeded.length === 0) {
		const first = results.find((result) => result.error);
		return Response.json(
			{ error: first?.error ?? 'All like actions failed' },
			{ status: 502 }
		);
	}

	return Response.json({
		success: true,
		accounts: succeeded.map((result) => result.accountBlogName)
	});
};
