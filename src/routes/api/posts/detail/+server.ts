import { forAccounts, publicClient, readAccounts } from '#lib/server/clients';
import type { NotesMode, TumblrNote, TumblrPost } from 'postferry';
import type { RequestHandler } from './$types';

interface AccountState {
	liked: boolean;
	reblogged: boolean;
}

/**
 * Post detail.
 *
 * Without a notes cursor it fetches the post once per active account (Tumblr
 * returns `liked` per OAuth token) in a single client request and returns the
 * merged account state. With `before_timestamp` it pages notes through the
 * dedicated `/blog/{blog}/notes` endpoint instead of re-fetching the post.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await readAccounts(request);
	if (!body) {
		return new Response('Invalid account payload', { status: 400 });
	}
	const { accounts } = body;
	const blogName = body.blogName as string | undefined;
	const postId = body.postId as string | number | undefined;
	const beforeTimestamp = body.before_timestamp;
	if (!blogName || !postId) {
		return new Response('blogName and postId are required', { status: 400 });
	}

	if (beforeTimestamp !== undefined && beforeTimestamp !== null) {
		try {
			const notes = await publicClient().blogNotes(blogName, {
				id: String(postId),
				before_timestamp: Number(beforeTimestamp),
				mode: (body.notes_mode as NotesMode | undefined) ?? 'all'
			});
			return Response.json({
				notes: notes.notes ?? [],
				total_notes: notes.total_notes,
				total_likes: notes.total_likes,
				total_reblogs: notes.total_reblogs,
				_links: notes._links
			});
		} catch (error: unknown) {
			console.error('Failed to fetch notes:', error);
			const status = (error as { status?: number }).status ?? 500;
			return Response.json({ error: messageFor(error) }, { status });
		}
	}

	const results = await forAccounts(accounts, async (client, account) => {
		const data = await client.blogPosts(blogName, {
			id: String(postId),
			notes_info: true,
			reblog_info: true,
			npf: true
		});
		const post = (data.posts ?? [])[0] as TumblrPost | undefined;
		if (!post) throw new Error('Post not found');
		const notes = (post.notes ?? []) as TumblrNote[];
		return {
			post,
			notes,
			state: {
				liked: post.liked === true,
				reblogged: notes.some(
					(note) => note.type === 'reblog' && note.blog_name === account.blogName
				)
			} satisfies AccountState
		};
	});

	const primary = results.find((result) => result.ok && result.value);
	if (!primary || !primary.value) {
		const firstError = results.find((result) => result.error);
		const status = firstError?.status === 404 ? 404 : 502;
		const error = firstError?.error ?? 'Could not load this post';
		return Response.json(
			{
				error:
					status === 404
						? 'This post could not be found. It may have been deleted or the blog may be private.'
						: error
			},
			{ status }
		);
	}

	const accountStates: Record<string, AccountState> = {};
	for (const result of results) {
		if (result.ok && result.value) accountStates[result.accountBlogName] = result.value.state;
	}

	return Response.json({
		post: primary.value.post,
		notes: primary.value.notes,
		total_notes: primary.value.post.note_count,
		accountStates,
		accountResponses: results
	});
};

function messageFor(error: unknown): string {
	return error instanceof Error ? error.message : 'Error fetching notes';
}
