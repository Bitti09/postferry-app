import { forAccounts, readAccounts } from '#lib/server/clients';
import { mergeFeedPosts, type TumblrPost } from 'postferry';
import type { RequestHandler } from './$types';

/** Multi-account likes merge. Per-account `before` (liked_timestamp) cursors. */
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
		return {
			likedPosts,
			newBefore:
				likedPosts.length > 0
					? likedPosts[likedPosts.length - 1]!.liked_timestamp
					: accountBefore
		};
	});

	const likes = mergeFeedPosts(
		results.flatMap((result) =>
			result.ok && result.value
				? [{ account: result.accountBlogName, posts: result.value.likedPosts, liked: true }]
				: []
		),
		'liked'
	);

	const newBefore: Record<string, number> = {};
	for (const result of results) {
		if (!result.ok || !result.value) continue;
		if (result.value.newBefore !== undefined) {
			newBefore[result.accountBlogName] = Number(result.value.newBefore);
		}
	}

	return Response.json({
		liked_posts: likes,
		newBefore,
		accountResponses: results
	});
};
