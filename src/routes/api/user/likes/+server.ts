import { forAccounts, readAccounts } from '$lib/server/clients';
import type { RequestHandler } from './$types';

interface LikedPost {
	id: number | string;
	liked_timestamp: number | string;
}

/** Multi-account likes merge. Per-account `before` (liked_timestamp) cursors. */
export const POST: RequestHandler = async ({ request }) => {
	const body = await readAccounts(request);
	if (!body) {
		return new Response('Invalid accounts payload', { status: 400 });
	}
	const { accounts } = body;
	const before = body.before as Record<string, string | number> | undefined;
	const results = await forAccounts(accounts, async (client, account) => {
		const params: Record<string, unknown> = {
			limit: 20,
			npf: true,
			reblog_info: true
		};
		const accountBefore = before?.[account.blogName];
		if (accountBefore) {
			params.before = accountBefore.toString();
		}
		const data = await client.userLikes(params);
		const liked_posts = (data.liked_posts ?? []) as LikedPost[];
		return {
			liked_posts,
			newBefore: liked_posts.length > 0
				? liked_posts[liked_posts.length - 1].liked_timestamp
				: accountBefore
		};
	});

	const allLikes = results.flatMap((r) => (r.ok ? r.value!.liked_posts : []));

	// Deduplicate by post id.
	const uniqueLikesMap = new Map<string, LikedPost>();
	for (const post of allLikes) {
		uniqueLikesMap.set(post.id.toString(), post);
	}

	const sortedLikes = Array.from(uniqueLikesMap.values()).sort(
		(a, b) => Number(b.liked_timestamp) - Number(a.liked_timestamp)
	);

	const newBefore: Record<string, number> = {};
	const likeUpdates: Record<string, Record<string, boolean>> = {};
	for (const r of results) {
		if (!r.ok || !r.value) continue;
		if (r.value.newBefore !== undefined) newBefore[r.accountBlogName] = Number(r.value.newBefore);
		for (const p of r.value.liked_posts) {
			(likeUpdates[p.id.toString()] ??= {})[r.accountBlogName] = true;
		}
	}

	return new Response(JSON.stringify({
		liked_posts: sortedLikes,
		newBefore,
		accountResponses: results,
		likeUpdates
	}), {
		headers: { 'Content-Type': 'application/json' }
	});
};
