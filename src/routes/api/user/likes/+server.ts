import { checkRateLimit } from '$lib/server/rateLimiter';
import { Client } from 'tumblr.js';
import { TUMBLR_CONSUMER_KEY, TUMBLR_CONSUMER_SECRET } from '$env/static/private';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { accounts, before } = await request.json();

		if (!accounts || !Array.isArray(accounts)) {
			return new Response('Invalid accounts payload', { status: 400 });
		}

		const newBefore: Record<string, number> = {};

		// Fetch from each account in parallel
		const fetchPromises = accounts.map(async (account) => {
			if (!account.token || !account.secret) {
				return {
					accountBlogName: account.blogName,
					liked_posts: [],
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
			const accountBefore = before?.[account.blogName];
			if (accountBefore) {
				params.before = accountBefore.toString();
			}

			let accountLikes = [];
			let accountResponse: any = null;
			try {
				await checkRateLimit();
				const data = await client.userLikes(params);
				accountResponse = data;
				accountLikes = data.liked_posts || [];
			} catch (error) {
				console.error(`Failed to fetch likes for account ${account.blogName}:`, error);
			}

			// Track updated "before" timestamp for this account
			if (accountLikes.length > 0) {
				newBefore[account.blogName] = accountLikes[accountLikes.length - 1].liked_timestamp;
			} else if (accountBefore) {
				newBefore[account.blogName] = accountBefore;
			}

			return {
				accountBlogName: account.blogName,
				liked_posts: accountLikes,
				response: accountResponse
			};
		});

		const results = await Promise.all(fetchPromises);
		const allLikes = results.flatMap((r) => r.liked_posts || []);

		// Deduplicate by post ID
		const uniqueLikesMap = new Map();
		for (const post of allLikes) {
			uniqueLikesMap.set(post.id, post);
		}

		// Sort by liked_timestamp descending
		const sortedLikes = Array.from(uniqueLikesMap.values()).sort(
			(a, b) => b.liked_timestamp - a.liked_timestamp
		);

		return new Response(JSON.stringify({ 
			liked_posts: sortedLikes,
			newBefore,
			allLikedPosts: allLikes,
			accountResponses: results
		}), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error) {
		console.error('User Likes Server Error:', error);
		return new Response('Internal Server Error', { status: 500 });
	}
};
