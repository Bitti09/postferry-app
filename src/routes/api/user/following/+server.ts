import { forAccounts, readAccounts } from '$lib/server/clients';
import type { RequestHandler } from './$types';

interface FollowedBlog {
	name: string;
}

/** Multi-account followed-blogs fetch. Per-account offset cursors. */
export const POST: RequestHandler = async ({ request }) => {
	const body = await readAccounts(request);
	if (!body) {
		return new Response('Invalid accounts payload', { status: 400 });
	}
	const { accounts } = body;
	const offsets = body.offsets as Record<string, number> | undefined;
	const results = await forAccounts(accounts, async (client, account) => {
		const params: Record<string, unknown> = { limit: 20 };
		const accountOffset = offsets?.[account.blogName];
		if (accountOffset) {
			params.offset = accountOffset.toString();
		}
		const data = await client.userFollowing(params);
		const blogs = (data.blogs ?? []) as FollowedBlog[];
		return {
			blogs,
			newOffset: blogs.length > 0 ? (accountOffset ?? 0) + blogs.length : accountOffset
		};
	});

	const allBlogs = results.flatMap((r) => (r.ok ? r.value!.blogs : []));

	const uniqueBlogsMap = new Map<string, FollowedBlog>();
	for (const blog of allBlogs) {
		uniqueBlogsMap.set(blog.name, blog);
	}
	const sortedBlogs = Array.from(uniqueBlogsMap.values()).sort(
		(a, b) => a.name.localeCompare(b.name)
	);

	const newOffsets: Record<string, number> = {};
	for (const r of results) {
		if (r.ok && r.value?.newOffset !== undefined) {
			newOffsets[r.accountBlogName] = r.value.newOffset;
		}
	}

	return new Response(JSON.stringify({
		blogs: sortedBlogs,
		newOffsets,
		accountResponses: results
	}), {
		headers: { 'Content-Type': 'application/json' }
	});
};
