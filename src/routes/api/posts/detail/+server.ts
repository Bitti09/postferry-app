import { checkRateLimit } from '$lib/server/rateLimiter';
import { Client } from 'tumblr.js';
import { TUMBLR_CONSUMER_KEY, TUMBLR_CONSUMER_SECRET } from '$env/static/private';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { account, blogName, postId, before_timestamp } = await request.json();

		if (!account || !account.token || !account.secret) {
			return new Response('Invalid account payload', { status: 400 });
		}

		const client = new Client({
			consumer_key: TUMBLR_CONSUMER_KEY,
			consumer_secret: TUMBLR_CONSUMER_SECRET,
			token: account.token,
			token_secret: account.secret
		});

		await checkRateLimit();
		const params: any = {
			id: postId.toString(),
			notes_info: true,
			reblog_info: true,
			npf: true
		};
		if (before_timestamp) {
			params.before_timestamp = before_timestamp.toString();
		}
		const data = await client.blogPosts(blogName, params);

		const post = data.posts?.[0];
		return new Response(JSON.stringify({ 
			post: before_timestamp ? undefined : post,
			notes: post?.notes || [],
			liked: post?.liked ?? false,
			response: data
		}), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error: any) {
		console.error(`Failed to fetch post detail:`, error);
		const status = error.statusCode || 500;
		let errorMessage = error.message || 'Error fetching post from Tumblr';
		if (status === 404) {
			errorMessage = 'This post could not be found. It may have been deleted or the blog may be private.';
		}
		return new Response(JSON.stringify({ error: errorMessage }), { 
			status, 
			headers: { 'Content-Type': 'application/json' } 
		});
	}
};
