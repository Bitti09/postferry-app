import { publicClient, readAccounts } from '#lib/server/clients';
import type { PostFormatFilter, TumblrPost } from 'postferry';
import type { RequestHandler } from './$types';

/**
 * Tagged search. `/tagged` is API-key scoped, so accounts are accepted for
 * payload uniformity but not required for authentication. The endpoint has no
 * `type` parameter; filtering happens client-side with the shared predicate.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await readAccounts(request);
	if (!body) {
		return new Response('Invalid account payload', { status: 400 });
	}

	const query = body.query as string | undefined;
	const before = body.before;
	const filter = body.filter as PostFormatFilter | undefined;
	if (!query) {
		return new Response('Query is required', { status: 400 });
	}

	const cleanQuery = query.startsWith('#') ? query.substring(1) : query;

	try {
		const result = await publicClient().tagged(cleanQuery, {
			limit: 20,
			npf: true,
			...(before !== undefined && before !== null ? { before: Number(before) } : {}),
			...(filter === 'text' || filter === 'raw' ? { filter } : {})
		});
		// The documented response is an array; tolerate the older `{posts}`
		// wrapper some proxies return.
		const posts = (Array.isArray(result)
			? result
			: ((result as { posts?: TumblrPost[] }).posts ?? [])) as TumblrPost[];

		return Response.json({ posts });
	} catch (error: unknown) {
		console.error('Search failed:', error);
		const status = (error as { status?: number }).status ?? 502;
		return new Response(error instanceof Error ? error.message : 'Search failed', { status });
	}
};
