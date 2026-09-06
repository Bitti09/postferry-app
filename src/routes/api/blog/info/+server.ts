import { clientFor, readAccounts } from '$lib/server/clients';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const accounts = await readAccounts(request);
	if (!accounts || accounts.length === 0) {
		return new Response('Invalid account payload', { status: 400 });
	}
	// Route fields ride on the account objects (single body read).
	const blogName = accounts[0]?.blogName as string | undefined;
	if (!blogName) {
		return new Response('blogName is required', { status: 400 });
	}

	const client = accounts.map(clientFor).find((c) => c !== null);
	if (!client) {
		return new Response('No account with valid credentials', { status: 400 });
	}

	try {
		const data = await client.blogInfo(blogName);
		return new Response(JSON.stringify({
			info: data.blog,
			response: data
		}), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error: unknown) {
		console.error('Error fetching blog info:', error);
		const status = (error as { statusCode?: number }).statusCode || 500;
		return new Response(error instanceof Error ? error.message : 'Internal Server Error', { status });
	}
};
