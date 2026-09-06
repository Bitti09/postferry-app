import { clientFor, readAccounts } from '$lib/server/clients';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const accounts = await readAccounts(request);
	if (!accounts || accounts.length === 0) {
		return new Response('Invalid account payload', { status: 400 });
	}
	// Route fields ride on the account objects (single body read).
	const first = accounts[0] as (typeof accounts)[number] & {
		blogName?: string;
		before_id?: string | number;
	};
	const { blogName, before_id } = first ?? {};

	if (!blogName) {
		return new Response('blogName is required', { status: 400 });
	}

	// Blog posts are key-readable; any usable account's client works.
	const client = accounts.map(clientFor).find((c) => c !== null);
	if (!client) {
		return new Response('No account with valid credentials', { status: 400 });
	}

	try {
		const params: Record<string, unknown> = {
			npf: true,
			reblog_info: true,
			limit: 20
		};
		if (before_id) {
			params.before_id = before_id.toString();
		}
		const data = await client.blogPosts(blogName, params);

		return new Response(JSON.stringify({
			posts: data.posts || [],
			response: data
		}), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error: unknown) {
		console.error('Error fetching blog posts:', error);
		const status = (error as { statusCode?: number }).statusCode || 500;
		return new Response(error instanceof Error ? error.message : 'Internal Server Error', { status });
	}
};
