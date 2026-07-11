import { checkRateLimit } from '$lib/server/rateLimiter';
import { Client } from 'tumblr.js';
import { TUMBLR_CONSUMER_KEY, TUMBLR_CONSUMER_SECRET } from '$env/static/private';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { accounts, offsets, type } = await request.json();

		if (!accounts || !Array.isArray(accounts)) {
			return new Response('Invalid accounts payload', { status: 400 });
		}

		const newOffsets: Record<string, string> = {};

		// Fetch from each account in parallel using its specific offset
		const fetchPromises = accounts.map(async (account) => {
			if (!account.token || !account.secret) {
				return {
					accountBlogName: account.blogName,
					posts: [],
					response: null
				};
			}

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
			if (type) {
				params.type = type;
			}

			// Use the specific offset for this account if it exists
			const accountOffset = offsets?.[account.blogName];
			if (accountOffset) {
				params.before_id = accountOffset.toString();
			}

			let accountPosts = [];
			let accountResponse: any = null;
			try {
				await checkRateLimit();
				const data = await client.userDashboard(params);
				accountResponse = data;
				accountPosts = data.posts || [];
			} catch (error) {
				console.error(`Failed to fetch dashboard for account ${account.blogName}:`, error);
			}

			// Track the new offset for this specific account
			if (accountPosts.length > 0) {
				newOffsets[account.blogName] = accountPosts[accountPosts.length - 1].id.toString();
			} else if (accountOffset) {
				// Keep the old offset if no new posts were found
				newOffsets[account.blogName] = accountOffset;
			}

			return {
				accountBlogName: account.blogName,
				posts: accountPosts,
				response: accountResponse
			};
		});

		const results = await Promise.all(fetchPromises);
		const allPosts = results.flatMap((r) => r.posts || []);

		// Deduplicate and sort
		const uniquePostsMap = new Map();
		for (const post of allPosts) {
			uniquePostsMap.set(post.id, post);
		}

		const sortedPosts = Array.from(uniquePostsMap.values()).sort(
			(a, b) => b.timestamp - a.timestamp
		);

		return new Response(JSON.stringify({ 
			posts: sortedPosts,
			newOffsets,
			allPosts,
			accountResponses: results
		}), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error) {
		console.error('Dashboard Error:', error);
		return new Response('Internal Server Error', { status: 500 });
	}
};
