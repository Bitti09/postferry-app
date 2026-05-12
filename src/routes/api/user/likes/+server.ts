import { oauth } from '$lib/server/oauth';
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
			if (!account.token || !account.secret) return [];

			const url = new URL('https://api.tumblr.com/v2/user/likes');
			url.searchParams.set('limit', '20');
			
			const accountBefore = before?.[account.blogName];
			if (accountBefore) {
				url.searchParams.set('before', accountBefore.toString());
			}

			const requestData = {
				url: url.toString(),
				method: 'GET'
			};

			const authHeader = oauth.toHeader(
				oauth.authorize(requestData, { key: account.token, secret: account.secret })
			);

			const res = await fetch(requestData.url, {
				headers: { ...authHeader }
			});

			if (!res.ok) {
				console.error(`Failed to fetch likes for account ${account.blogName}:`, await res.text());
				return [];
			}

			const data = await res.json();
			const accountLikes = data.response.liked_posts || [];

			// Track updated "before" timestamp for this account
			if (accountLikes.length > 0) {
				newBefore[account.blogName] = accountLikes[accountLikes.length - 1].liked_timestamp;
			} else if (accountBefore) {
				newBefore[account.blogName] = accountBefore;
			}

			return accountLikes;
		});

		const results = await Promise.all(fetchPromises);
		const allLikes = results.flat();

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
			newBefore
		}), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error) {
		console.error('User Likes Server Error:', error);
		return new Response('Internal Server Error', { status: 500 });
	}
};
