import { checkRateLimit } from '$lib/server/rateLimiter';
import { Client } from 'tumblr.js';
import { TUMBLR_CONSUMER_KEY, TUMBLR_CONSUMER_SECRET } from '$env/static/private';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	let action = 'like';
	try {
		const { account, postId, reblogKey, action: reqAction } = await request.json();
		if (reqAction) {
			action = reqAction;
		}

		if (!account || !account.token || !account.secret || !postId || !reblogKey) {
			return new Response('Missing required parameters', { status: 400 });
		}

		const client = new Client({
			consumer_key: TUMBLR_CONSUMER_KEY,
			consumer_secret: TUMBLR_CONSUMER_SECRET,
			token: account.token,
			token_secret: account.secret
		});

		await checkRateLimit();

		let responseData;
		if (action === 'unlike') {
			responseData = await client.unlikePost(postId.toString(), reblogKey);
		} else {
			responseData = await client.likePost(postId.toString(), reblogKey);
		}

		return new Response(JSON.stringify({ success: true, response: responseData }), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error: any) {
		console.error(`Tumblr ${action} Error:`, error);
		const status = error.statusCode || 500;
		return new Response(error.message || 'Internal Server Error', { 
			status,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};
