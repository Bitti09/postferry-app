import { forAccounts, readAccounts } from '#lib/server/clients';
import type { TumblrBlog } from 'postferry';
import type { RequestHandler } from './$types';

/** Multi-account followed-blogs fetch. Per-account offset cursors. */
export const POST: RequestHandler = async ({ request }) => {
	const body = await readAccounts(request);
	if (!body) {
		return new Response('Invalid accounts payload', { status: 400 });
	}
	const { accounts } = body;
	const offsets = (body.offsets ?? {}) as Record<string, number>;

	const results = await forAccounts(accounts, async (client, account) => {
		const accountOffset = offsets[account.blogName];
		const data = await client.userFollowing({
			limit: 20,
			...(accountOffset ? { offset: accountOffset } : {})
		});
		const blogs = (data.blogs ?? []) as TumblrBlog[];
		return {
			blogs,
			newOffset: blogs.length > 0 ? (accountOffset ?? 0) + blogs.length : accountOffset
		};
	});

	const uniqueBlogs = new Map<string, TumblrBlog>();
	for (const result of results) {
		if (!result.ok || !result.value) continue;
		for (const blog of result.value.blogs) uniqueBlogs.set(blog.name, blog);
	}
	const blogs = [...uniqueBlogs.values()].sort((a, b) => a.name.localeCompare(b.name));

	const newOffsets: Record<string, number> = {};
	for (const result of results) {
		if (result.ok && result.value?.newOffset !== undefined) {
			newOffsets[result.accountBlogName] = result.value.newOffset;
		}
	}

	return Response.json({
		blogs,
		newOffsets,
		accountResponses: results
	});
};
