import { forAccounts, readAccounts, type AccountCredentials } from '#lib/server/clients';
import { mergeFeedPosts, postId, type DashboardParams, type PostType, type TumblrPost } from 'postferry';
import type { RequestHandler } from './$types';

/**
 * Multi-account dashboard merge.
 *
 * Per the current API docs `/user/dashboard` paginates with `offset` and
 * `since_id`; it has no `before_id` parameter. The client therefore keeps a
 * numeric offset per account for older pages and a `since_id` per account for
 * refreshes.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await readAccounts(request);
	if (!body) {
		return new Response('Invalid accounts payload', { status: 400 });
	}
	const { accounts } = body;
	const offsets = (body.offsets ?? {}) as Record<string, string | number>;
	const sinceIds = (body.since_ids ?? {}) as Record<string, string | number>;
	const type = body.type as PostType | null | undefined;

	const results = await forAccounts(accounts, async (client, account) => {
		const params: DashboardParams = {
			limit: 20,
			npf: true,
			reblog_info: true
		};
		if (type) params.type = type;

		const sinceId = sinceIds[account.blogName];
		const offset = offsets[account.blogName];
		if (sinceId) {
			params.since_id = sinceId;
		} else if (offset !== undefined && offset !== null) {
			params.offset = Number(offset);
		}

		const data = await client.userDashboard(params);
		const posts = (data.posts ?? []) as TumblrPost[];
		const numericOffset = Number(offset ?? 0);
		return {
			posts,
			// Newest id for the next refresh. Numeric max keeps this correct
			// regardless of response ordering.
			newSinceId: posts.length > 0 ? maxPostId(posts) : undefined,
			// Next older page.
			newOffset: posts.length > 0 ? numericOffset + posts.length : undefined
		};
	});

	const batches = results.flatMap((result) =>
		result.ok && result.value ? [{ account: result.accountBlogName, posts: result.value.posts }] : []
	);
	const posts = mergeFeedPosts(batches, 'timestamp');

	const newOffsets: Record<string, number> = {};
	const newSinceIds: Record<string, string> = {};
	for (const result of results) {
		if (!result.ok || !result.value) continue;
		if (result.value.newOffset !== undefined) newOffsets[result.accountBlogName] = result.value.newOffset;
		if (result.value.newSinceId) newSinceIds[result.accountBlogName] = result.value.newSinceId;
	}

	return Response.json({
		posts,
		newOffsets,
		newSinceIds,
		accountResponses: results
	});
};

function maxPostId(posts: ReadonlyArray<TumblrPost>): string {
	let best = posts[0]!;
	for (const post of posts) {
		if (comparePostId(post, best) > 0) best = post;
	}
	return postId(best);
}

function comparePostId(a: TumblrPost, b: TumblrPost): number {
	const left = postId(a);
	const right = postId(b);
	if (left.length !== right.length) return left.length - right.length;
	return left < right ? -1 : left > right ? 1 : 0;
}
