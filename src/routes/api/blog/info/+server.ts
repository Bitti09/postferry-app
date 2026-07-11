import { checkRateLimit } from '$lib/server/rateLimiter';
import { Client } from 'tumblr.js';
import { TUMBLR_CONSUMER_KEY, TUMBLR_CONSUMER_SECRET } from '$env/static/private';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { account, blogName } = await request.json();

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
		const data = await client.blogInfo(blogName);

		return new Response(JSON.stringify({
			info: data.blog,
			response: data
		}), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error: any) {
		console.error('Error fetching blog info:', error);
		const status = error.statusCode || 500;
		return new Response(error.message || 'Internal Server Error', { status });
	}
};
