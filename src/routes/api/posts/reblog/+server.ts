import { forAccounts, readAccounts } from '$lib/server/clients';
import type { RequestHandler } from './$types';

interface TumblrError extends Error {
	statusCode?: number;
}

/** Reblog a post to the requesting account's blog. */
export const POST: RequestHandler = async ({ request }) => {
	const accounts = await readAccounts(request);
	if (!accounts || accounts.length === 0) {
		return new Response('Missing required parameters', { status: 400 });
	}
	// Route fields ride on the account objects (single body read).
	const first = accounts[0] as (typeof accounts)[number] & {
		postId?: string | number;
		reblogKey?: string;
		comment?: string;
	};
	const { postId, reblogKey, comment } = first ?? {};
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
