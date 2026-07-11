import { checkRateLimit } from '$lib/server/rateLimiter';
import { oauth } from '$lib/server/oauth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { accounts, offsets } = await request.json();

		if (!accounts || !Array.isArray(accounts)) {
			return new Response('Invalid accounts payload', { status: 400 });
		}

		const newOffsets: Record<string, number> = {};

		// Fetch from each account in parallel
		const fetchPromises = accounts.map(async (account) => {
			if (!account.token || !account.secret) return [];

			const url = new URL('https://api.tumblr.com/v2/user/following');
			url.searchParams.set('limit', '20');
			
			const accountOffset = offsets?.[account.blogName];
			if (accountOffset) {
				url.searchParams.set('offset', accountOffset.toString());
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
				console.error(`Failed to fetch following for account ${account.blogName}:`, await res.text());
				return [];
			}

			const data = await res.json();
			const blogs = data.response.blogs || [];

			if (blogs.length > 0) {
				newOffsets[account.blogName] = (accountOffset || 0) + blogs.length;
			} else if (accountOffset) {
				newOffsets[account.blogName] = accountOffset;
			}

			return blogs;
		});

		const results = await Promise.all(fetchPromises);
		const allBlogs = results.flat();

		// Deduplicate by blog name
		const uniqueBlogsMap = new Map();
		for (const blog of allBlogs) {
			uniqueBlogsMap.set(blog.name, blog);
		}

		// Sort by blog name
		const sortedBlogs = Array.from(uniqueBlogsMap.values()).sort(
			(a, b) => a.name.localeCompare(b.name)
		);

		return new Response(JSON.stringify({ 
			blogs: sortedBlogs,
			newOffsets
		}), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error) {
		console.error('User Following Server Error:', error);
		return new Response('Internal Server Error', { status: 500 });
	}
};
