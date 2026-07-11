import { checkRateLimit } from '$lib/server/rateLimiter';
import { Client } from 'tumblr.js';
import { TUMBLR_CONSUMER_KEY, TUMBLR_CONSUMER_SECRET } from '$env/static/private';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { account, postId, reblogKey, comment } = await request.json();

		if (!account || !account.token || !account.secret || !postId || !reblogKey) {
			return new Response('Missing required parameters', { status: 400 });
		}

		const client = new Client({
			consumer_key: TUMBLR_CONSUMER_KEY,
			consumer_secret: TUMBLR_CONSUMER_SECRET,
			token: account.token,
			token_secret: account.secret
		});

		const params: any = {
			id: postId,
			reblog_key: reblogKey
		};
		if (comment) {
			params.comment = comment;
		}

		await checkRateLimit();
		const responseData = await client.reblogPost(account.blogName, params);

		return new Response(JSON.stringify({ success: true, response: responseData }), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error: any) {
		console.error(`Tumblr Reblog Error:`, error);
		const status = error.statusCode || 500;
		return new Response(error.message || 'Internal Server Error', { 
			status,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};
