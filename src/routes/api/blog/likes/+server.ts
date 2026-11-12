import { clientFor, readAccounts } from '#lib/server/clients';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const body = await readAccounts(request);
	if (!body) {
		return new Response('Invalid account payload', { status: 400 });
	}
	const { accounts } = body;
	const blogName = body.blogName as string | undefined;
	if (!blogName) {
		return new Response('blogName is required', { status: 400 });
	}

	const client = accounts.map(clientFor).find((c) => c !== null);
	if (!client) {
		return new Response('No account with valid credentials', { status: 400 });
	}

	const before = body.before;
	const params = {
		npf: true,
		...(before !== undefined && before !== null ? { before: Number(before) } : {})
	};

	try {
		let data;
		try {
			data = await client.blogLikes(blogName, params);
		} catch (error) {
			const status = (error as { status?: number }).status;
			if (status === 404 && !blogName.includes('.')) {
				data = await client.blogLikes(`${blogName}.tumblr.com`, params);
			} else {
				throw error;
			}
		}

		return Response.json({
			liked_posts: data.liked_posts ?? [],
			liked_count: data.liked_count,
			response: data
		});
	} catch (error: unknown) {
		console.error('Failed to fetch likes:', error);
		const status = (error as { status?: number }).status ?? 500;
		return new Response(error instanceof Error ? error.message : 'Internal Server Error', { status });
	}
};
