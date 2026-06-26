import { checkRateLimit } from '$lib/server/rateLimiter';
import { oauth } from '$lib/server/oauth';
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
			if (!account.token || !account.secret) return [];

			const url = new URL('https://api.tumblr.com/v2/user/dashboard');
			url.searchParams.set('limit', '20');
			
			if (type) {
				url.searchParams.set('type', type);
			}
			
			// Use the specific offset for this account if it exists
			const accountOffset = offsets?.[account.blogName];
			if (accountOffset) {
				url.searchParams.set('before_id', accountOffset.toString());
			}

			const requestData = {
				url: url.toString(),
				method: 'GET'
			};

			const authHeader = oauth.toHeader(
				oauth.authorize(requestData, { key: account.token, secret: account.secret })
			);

			await checkRateLimit();
		const res = await fetch(requestData.url, {
				headers: { ...authHeader }
			});

			if (!res.ok) {
				console.error(`Failed to fetch for account ${account.blogName}:`, await res.text());
				return [];
			}

			const data = await res.json();
			const accountPosts = data.response.posts || [];
			
			// Track the new offset for this specific account
			if (accountPosts.length > 0) {
				newOffsets[account.blogName] = accountPosts[accountPosts.length - 1].id.toString();
			} else if (accountOffset) {
				// Keep the old offset if no new posts were found
				newOffsets[account.blogName] = accountOffset;
			}

			return accountPosts;
		});

		const results = await Promise.all(fetchPromises);
		const allPosts = results.flat();

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
			newOffsets 
		}), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error) {
		console.error('Dashboard Error:', error);
		return new Response('Internal Server Error', { status: 500 });
	}
};
