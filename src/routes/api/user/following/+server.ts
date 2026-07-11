import { checkRateLimit } from '$lib/server/rateLimiter';
import { Client } from 'tumblr.js';
import { TUMBLR_CONSUMER_KEY, TUMBLR_CONSUMER_SECRET } from '$env/static/private';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { accounts, offsets, cachedBlogNames } = await request.json();

		if (!accounts || !Array.isArray(accounts)) {
			return new Response('Invalid accounts payload', { status: 400 });
		}

		const cachedBlogNamesSet = new Set(cachedBlogNames || []);
		const newOffsets: Record<string, number> = {};

		// Fetch from each account in parallel
		const fetchPromises = accounts.map(async (account) => {
			if (!account.token || !account.secret) return [];

			const client = new Client({
				consumer_key: TUMBLR_CONSUMER_KEY,
				consumer_secret: TUMBLR_CONSUMER_SECRET,
				token: account.token,
				token_secret: account.secret
			});

			const params: any = { limit: 20 };
			const accountOffset = offsets?.[account.blogName];
			if (accountOffset) {
				params.offset = accountOffset.toString();
			}

			let blogs = [];
			try {
				await checkRateLimit();
				const data = await client.userFollowing(params);
				blogs = data.blogs || [];
			} catch (error) {
				console.error(`Failed to fetch following for account ${account.blogName}:`, error);
			}

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

		// Enrich uncached blogs with full blogInfo using Client library
		const enrichedBlogs = await Promise.all(
			sortedBlogs.map(async (blog) => {
				if (cachedBlogNamesSet.has(blog.name)) {
					return blog;
				}
				const firstAuth = accounts.find((a) => a.token && a.secret);
				if (!firstAuth) return blog;

				const client = new Client({
					consumer_key: TUMBLR_CONSUMER_KEY,
					consumer_secret: TUMBLR_CONSUMER_SECRET,
					token: firstAuth.token,
					token_secret: firstAuth.secret
				});

				try {
					await checkRateLimit();
					const infoData = await client.blogInfo(blog.name);
					if (infoData?.blog) {
						return {
							...blog,
							...infoData.blog,
							share_likes: infoData.blog.share_likes,
							likes: infoData.blog.likes,
							updated: infoData.blog.updated || blog.updated
						};
					}
				} catch (e) {
					console.error(`Failed to enrich blog info for ${blog.name} on server:`, e);
				}
				return blog;
			})
		);

		return new Response(JSON.stringify({ 
			blogs: enrichedBlogs,
			newOffsets
		}), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error) {
		console.error('User Following Server Error:', error);
		return new Response('Internal Server Error', { status: 500 });
	}
};
