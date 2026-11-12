import { forAccounts, readAccounts } from '#lib/server/clients';
import { mergeFeedPost, type TumblrPost } from 'postferry';
import type { RequestHandler } from './$types';

interface LikesGroup {
	blogName: string;
	ok: boolean;
	/** Posts in the order the account's likes endpoint returned them. */
	posts: TumblrPost[];
	newBefore?: number;
	error?: string;
	status?: number;
}

/**
 * Per-account likes streams. No cross-account merge, sort or dedupe: each group
 * keeps the API's liked_timestamp order and its own `before` cursor.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await readAccounts(request);
	if (!body) {
		return new Response('Invalid accounts payload', { status: 400 });
	}
	const { accounts } = body;
	const before = (body.before ?? {}) as Record<string, string | number>;

	const results = await forAccounts(accounts, async (client, account) => {
		const accountBefore = before[account.blogName];
		const data = await client.userLikes({
			limit: 20,
			npf: true,
			...(accountBefore ? { before: Number(accountBefore) } : {})
		});
		const likedPosts = (data.liked_posts ?? []) as TumblrPost[];

		const posts = likedPosts.map((post) =>
			mergeFeedPost(undefined, post, account.blogName, {
				liked: true,
				reblogged: post.reblogged === true
			})
		);

		return {
			posts,
			newBefore:
				likedPosts.length > 0
					? likedPosts[likedPosts.length - 1]!.liked_timestamp
					: accountBefore
		};
	});

	const groups: LikesGroup[] = results.map((result) => {
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
			newBefore:
				result.value.newBefore !== undefined ? Number(result.value.newBefore) : undefined
		};
	});

	return Response.json({ groups, accountResponses: results });
};
