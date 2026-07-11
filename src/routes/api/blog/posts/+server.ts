import { checkRateLimit } from '$lib/server/rateLimiter';
import { Client } from 'tumblr.js';
import { TUMBLR_CONSUMER_KEY, TUMBLR_CONSUMER_SECRET } from '$env/static/private';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { account, blogName, before_id } = await request.json();

		if (!account || !account.token || !account.secret) {
			return new Response('Invalid account payload', { status: 400 });
		}

		const client = new Client({
			consumer_key: TUMBLR_CONSUMER_KEY,
			consumer_secret: TUMBLR_CONSUMER_SECRET,
			token: account.token,
			token_secret: account.secret
		});

		const params: any = {
			npf: true,
			reblog_info: true,
			notes_info: true,
			limit: 20
		};
		if (before_id) {
			params.before_id = before_id.toString();
		}

		await checkRateLimit();
		const data = await client.blogPosts(blogName, params);

		return new Response(JSON.stringify({
			posts: data.posts || [],
			response: data
		}), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error: any) {
		console.error('Error fetching blog posts:', error);
		const status = error.statusCode || 500;
		return new Response(error.message || 'Internal Server Error', { status });
	}
};
