import { checkRateLimit } from '$lib/server/rateLimiter';
import { Client } from 'tumblr.js';
import { TUMBLR_CONSUMER_KEY, TUMBLR_CONSUMER_SECRET } from '$env/static/private';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { account, blogName, before } = await request.json();

		if (!account || !account.token || !account.secret) {
			return new Response('Invalid account payload', { status: 400 });
		}

		const client = new Client({
			consumer_key: TUMBLR_CONSUMER_KEY,
			consumer_secret: TUMBLR_CONSUMER_SECRET,
			token: account.token,
			token_secret: account.secret
		});

		const tryFetch = async (identifier: string) => {
			const params: any = {
				npf: true,
				reblog_info: true,
				notes_info: true
			};
			if (before) {
				params.before = before.toString();
			}
			await checkRateLimit();
			return client.blogLikes(identifier, params);
		};

		let data;
		try {
			data = await tryFetch(blogName);
		} catch (error: any) {
			if (error.statusCode === 404 && !blogName.includes('.')) {
				data = await tryFetch(`${blogName}.tumblr.com`);
			} else {
				throw error;
			}
		}

		return new Response(JSON.stringify({
			liked_posts: data.liked_posts || [],
			response: data
		}), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error: any) {
		console.error(`Failed to fetch likes:`, error);
		const status = error.statusCode || 500;
		return new Response(error.message || 'Internal Server Error', { status });
	}
};
