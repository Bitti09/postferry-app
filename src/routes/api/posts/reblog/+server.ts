import { forAccounts, readAccounts } from '$lib/server/clients';
import type { RequestHandler } from './$types';

interface TumblrError extends Error {
	statusCode?: number;
}

/** Reblog a post to the requesting account's blog. */
export const POST: RequestHandler = async ({ request }) => {
	const body = await readAccounts(request);
	if (!body) {
		return new Response('Missing required parameters', { status: 400 });
	}
	const { accounts } = body;
	const { postId, reblogKey, comment } = body as {
		postId?: string | number;
		reblogKey?: string;
		comment?: string;
	};
	if (!postId || !reblogKey) {
		return new Response('Missing required parameters', { status: 400 });
	}

	const results = await forAccounts(accounts, async (client, account) => {
		const params: Record<string, unknown> = {
			id: postId,
			reblog_key: reblogKey
		};
		if (comment) {
			params.comment = comment;
		}
		return client.reblogPost(account.blogName, params);
	});

	const succeeded = results.filter((r) => r.ok);
	if (succeeded.length === 0) {
		const first = results.find((r) => r.error);
		return new Response(first?.error ?? 'All reblog actions failed', {
			status: 502,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	return new Response(JSON.stringify({ success: true, accounts: succeeded.map((r) => r.accountBlogName) }), {
		headers: { 'Content-Type': 'application/json' }
	});
};
