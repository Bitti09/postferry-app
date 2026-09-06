import { forAccounts, readAccounts } from '$lib/server/clients';
import type { RequestHandler } from './$types';

interface TumblrError extends Error {
	statusCode?: number;
}

/**
 * Like/unlike a post. Accepts both the single-account and multi-account
 * payload shapes; the action is performed by every account that carries
 * credentials (the UI sends one account per click, batch sends fan out).
 */
export const POST: RequestHandler = async ({ request }) => {
	let action = 'like';
	const body = await readAccounts(request);
	if (!body) {
		return new Response('Missing required parameters', { status: 400 });
	}
	const { accounts } = body;
	const { postId, reblogKey, action: reqAction } = body as {
		postId?: string | number;
		reblogKey?: string;
		action?: string;
	};
	if (reqAction) {
		action = reqAction;
	}
	if (!postId || !reblogKey) {
		return new Response('Missing required parameters', { status: 400 });
	}

	const results = await forAccounts(accounts, async (client) => {
		if (action === 'unlike') {
			return client.unlikePost(postId.toString(), reblogKey);
		}
		return client.likePost(postId.toString(), reblogKey);
	});

	const succeeded = results.filter((r) => r.ok);
	if (succeeded.length === 0) {
		const first = results.find((r) => r.error);
		const status = 502;
		return new Response(first?.error ?? 'All like actions failed', {
			status,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	return new Response(JSON.stringify({ success: true, accounts: succeeded.map((r) => r.accountBlogName) }), {
		headers: { 'Content-Type': 'application/json' }
	});
};
