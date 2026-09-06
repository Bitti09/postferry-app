import { clientFor, readAccounts } from '$lib/server/clients';
import type { RequestHandler } from './$types';

interface TumblrError extends Error {
	statusCode?: number;
}

export const POST: RequestHandler = async ({ request }) => {
	const body = await readAccounts(request);
	if (!body) {
		return new Response('Invalid account payload', { status: 400 });
	}
	const { accounts } = body;
	const { blogName, postId, before_timestamp, before, npf } = body as {
		blogName?: string;
		postId?: string | number;
		before_timestamp?: string | number;
		before?: string | number;
		npf?: boolean;
	};

	if (!blogName || !postId) {
		return new Response('blogName and postId are required', { status: 400 });
	}

	const client = accounts.map(clientFor).find((c) => c !== null);
	if (!client) {
		return new Response('No account with valid credentials', { status: 400 });
	}

	try {
		const params: Record<string, unknown> = {
			id: postId.toString(),
			notes_info: true,
			reblog_info: true,
			npf: npf !== false
		};
		const beforeCursor = before ?? before_timestamp;
		if (beforeCursor) {
			params.before = Number(beforeCursor);
		}
		const data = await client.blogPosts(blogName, params);

		const post = data.posts?.[0];
		return new Response(JSON.stringify({
			post: beforeCursor ? undefined : post,
			notes: post?.notes || [],
			liked: post?.liked ?? false,
			response: data
		}), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error: unknown) {
		console.error('Failed to fetch post detail:', error);
		const status = (error as TumblrError).statusCode || 500;
		let errorMessage = (error instanceof Error ? error.message : '') || 'Error fetching post from Tumblr';
		if (status === 404) {
			errorMessage = 'This post could not be found. It may have been deleted or the blog may be private.';
		}
		return new Response(JSON.stringify({ error: errorMessage }), {
			status,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};
