import { forAccounts, readAccounts } from '#lib/server/clients';
import type { RequestHandler } from './$types';

/** Reblog a post to the requesting account's blog. */
export const POST: RequestHandler = async ({ request }) => {
	const body = await readAccounts(request);
	if (!body) {
		return new Response('Missing required parameters', { status: 400 });
	}
	const { accounts } = body;
	const postId = body.postId as string | number | undefined;
	const reblogKey = body.reblogKey as string | undefined;
	const comment = body.comment as string | undefined;
	if (!postId || !reblogKey) {
		return new Response('Missing required parameters', { status: 400 });
	}

	const results = await forAccounts(accounts, async (client, account) => {
		return client.reblog(account.blogName, {
			id: String(postId),
			reblog_key: reblogKey,
			...(comment ? { comment } : {})
		});
	});

	const succeeded = results.filter((result) => result.ok);
	if (succeeded.length === 0) {
		const first = results.find((result) => result.error);
		return Response.json(
			{ error: first?.error ?? 'All reblog actions failed' },
			{ status: 502 }
		);
	}

	return Response.json({
		success: true,
		accounts: succeeded.map((result) => result.accountBlogName)
	});
};
