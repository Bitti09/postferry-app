import { forAccounts, readAccounts } from '$lib/server/clients';
import type { RequestHandler } from './$types';

interface DashboardPost {
	id: number | string;
	timestamp: number;
}

/** Multi-account dashboard merge. Per-account `before_id` cursors. */
export const POST: RequestHandler = async ({ request }) => {
	const accounts = await readAccounts(request);
	if (!accounts || accounts.length === 0) {
		return new Response('Invalid accounts payload', { status: 400 });
	}

	const { offsets, type, since_id } = (await request.json()) as {
		offsets?: Record<string, string | number>;
		type?: string | null;
		since_id?: string | number;
	};

	const results = await forAccounts(accounts, async (client, account) => {
		const params: Record<string, unknown> = {
			limit: 20,
			npf: true,
			reblog_info: true
		};
		if (type) {
			params.type = type;
		}
		if (since_id) {
			// Top-up refresh: only posts newer than what we already have.
			params.since_id = since_id.toString();
		} else {
			const accountOffset = offsets?.[account.blogName];
			if (accountOffset) {
				params.before_id = accountOffset.toString();
			}
		}
		const data = await client.userDashboard(params);
		const posts = (data.posts ?? []) as DashboardPost[];
		return {
			posts,
			// Newest post id per account for since_id top-ups.
			newSinceId: posts.length > 0 ? posts[0].id.toString() : undefined,
			// Oldest post id per account for downward pagination.
			newBeforeId: posts.length > 0 ? posts[posts.length - 1].id.toString() : undefined
		};
	});

	const allPosts = results.flatMap((r) => (r.ok ? r.value!.posts : []));

	// Deduplicate and sort by timestamp descending.
	const uniquePostsMap = new Map<string, DashboardPost>();
	for (const post of allPosts) {
		uniquePostsMap.set(post.id.toString(), post);
	}
	const sortedPosts = Array.from(uniquePostsMap.values()).sort((a, b) => b.timestamp - a.timestamp);

	const newOffsets: Record<string, string> = {};
	const newSinceIds: Record<string, string> = {};
	for (const r of results) {
		if (!r.ok || !r.value) continue;
		if (r.value.newBeforeId) newOffsets[r.accountBlogName] = r.value.newBeforeId;
		if (r.value.newSinceId) newSinceIds[r.accountBlogName] = r.value.newSinceId;
	}

	return new Response(JSON.stringify({
		posts: sortedPosts,
		newOffsets,
		newSinceIds,
		accountResponses: results
	}), {
		headers: { 'Content-Type': 'application/json' }
	});
};
