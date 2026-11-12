import { forAccounts, readAccounts } from '#lib/server/clients';
import { mergeFeedPost, postId, type DashboardParams, type PostType, type TumblrPost } from 'postferry';
import type { RequestHandler } from './$types';

interface AccountGroup {
	blogName: string;
	ok: boolean;
	/** Posts in the exact order the API returned them. */
	posts: TumblrPost[];
	newOffset?: number;
	newSinceId?: string;
	error?: string;
	status?: number;
}

/**
 * Per-account dashboard streams.
 *
 * Posts are never merged across accounts, deduplicated across accounts, or
 * re-sorted here. Each group preserves the order of its `/user/dashboard`
 * response. The client renders one account at a time.
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

		// Attach the per-account liked/reblogged metadata for the cache without
		// changing the array order.
		const decorated = posts.map((post) =>
			mergeFeedPost(undefined, post, account.blogName, {
				liked: post.liked === true,
				reblogged: post.reblogged === true
			})
		);

		return {
			posts: decorated,
			newSinceId: posts.length > 0 ? maxPostId(posts) : undefined,
			newOffset: posts.length > 0 ? numericOffset + posts.length : undefined
		};
	});

	const groups: AccountGroup[] = results.map((result) => {
		if (!result.ok || !result.value) {
			return {
				blogName: result.accountBlogName,
				ok: false,
				posts: [],
				error: result.error,
				status: result.status
			};
		}
		return {
			blogName: result.accountBlogName,
			ok: true,
			posts: result.value.posts,
			newOffset: result.value.newOffset,
			newSinceId: result.value.newSinceId
		};
	});

	return Response.json({ groups, accountResponses: results });
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
