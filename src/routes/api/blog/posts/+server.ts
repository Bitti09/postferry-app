import { clientFor, readAccounts } from '#lib/server/clients';
import type { TumblrPost } from 'postferry';
import type { RequestHandler } from './$types';

/**
 * Blog posts. The current API paginates `/blog/{blog}/posts` with `before`
 * (Unix seconds) or `offset`; `before_id` is not a documented parameter.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await readAccounts(request);
	if (!body) {
		return new Response('Invalid account payload', { status: 400 });
	}
	const { accounts } = body;
	const blogName = body.blogName as string | undefined;
	if (!blogName) {
		return new Response('blogName is required', { status: 400 });
	}

	const before = body.before ?? body.before_timestamp;
	const client = accounts.map(clientFor).find((c) => c !== null);
	if (!client) {
		return new Response('No account with valid credentials', { status: 400 });
	}

	try {
		const data = await client.blogPosts(blogName, {
			npf: true,
			reblog_info: true,
			limit: 20,
			...(before !== undefined && before !== null ? { before: Number(before) } : {})
		});
		const posts = (data.posts ?? []) as TumblrPost[];
		return Response.json({
			posts,
			// Cursor for the next older page: the oldest publish time returned.
			newBefore: posts.length > 0 ? posts[posts.length - 1]!.timestamp : undefined,
			total_posts: data.total_posts,
			response: data
		});
	} catch (error: unknown) {
		console.error('Error fetching blog posts:', error);
		const status = (error as { status?: number }).status ?? 500;
		return new Response(error instanceof Error ? error.message : 'Internal Server Error', { status });
	}
};
