import { clientFor, publicClient, readAccounts } from '#lib/server/clients';
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

	// Prefer an authenticated client when one is available: it exposes
	// `share_likes` and the caller's like count. The API docs allow API-key
	// auth for /blog/{blog}/info as well.
	const client = accounts.map(clientFor).find((c) => c !== null) ?? publicClient();

	try {
		const data = await client.blogInfo(blogName);
		return Response.json({
			info: data.blog,
			response: data
		});
	} catch (error: unknown) {
		console.error('Error fetching blog info:', error);
		const status = (error as { status?: number }).status ?? 500;
		return new Response(error instanceof Error ? error.message : 'Internal Server Error', { status });
	}
};
