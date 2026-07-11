import { checkRateLimit } from '$lib/server/rateLimiter';
import { Client } from 'tumblr.js';
import { TUMBLR_CONSUMER_KEY, TUMBLR_CONSUMER_SECRET } from '$env/static/private';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { account, query, before, type } = await request.json();

		if (!account || !account.token || !account.secret) {
			return new Response('Invalid account payload', { status: 400 });
		}

		if (!query) {
			return new Response('Query is required', { status: 400 });
		}

		console.log('\n--- [Backend Search API] New Request ---');
		console.log('Query Payload:', { query, before, type, account: account.blogName });

		const cleanQuery = query.startsWith('#') ? query.substring(1) : query;

		const client = new Client({
			consumer_key: TUMBLR_CONSUMER_KEY,
			consumer_secret: TUMBLR_CONSUMER_SECRET,
			token: account.token,
			token_secret: account.secret
		});

		const params: any = {
			limit: 20,
			npf: true,
			reblog_info: true,
			notes_info: true
		};
		if (before) {
			params.before = before.toString();
		}
		if (type && type !== 'all') {
			params.type = type;
		}

		console.log(`[Backend Search API] Requesting Tumblr Endpoint: tagged tag=${cleanQuery}`);

		await checkRateLimit();
		const data = await client.taggedPosts(cleanQuery, params);

		// Log the shape of the response
		if (Array.isArray(data)) {
			console.log(`[Backend Search API] Success! Received array with ${data.length} items`);
		} else if (data?.posts) {
			console.log(`[Backend Search API] Success! Received object with .posts array of length ${data.posts.length}`);
		} else {
			console.log(`[Backend Search API] Success! Received unknown response shape. Keys:`, Object.keys(data || {}));
		}

		const posts = data?.posts || (Array.isArray(data) ? data : []);

		console.log('--- [Backend Search API] Request Complete ---\n');

		return new Response(JSON.stringify({
			posts,
			response: data
		}), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error: any) {
		console.error(`[Backend Search API] Error:`, error);
		const status = error.statusCode || 500;
		return new Response(error.message || 'Internal Server Error', { status });
	}
};
