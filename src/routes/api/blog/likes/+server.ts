import { clientFor, readAccounts } from '$lib/server/clients';
import type { RequestHandler } from './$types';

interface TumblrError extends Error {
	statusCode?: number;
}

export const POST: RequestHandler = async ({ request }) => {
	const body = await readAccounts(request);
	if (!body) {
		return new Response('Invalid account payload', { status: 400 });
	}
	const { accounts } = body;
	const { blogName, before } = body as {
		blogName?: string;
		before?: string | number;
	};
	if (!blogName) {
		return new Response('blogName is required', { status: 400 });
	}

	const client = accounts.map(clientFor).find((c) => c !== null);
	if (!client) {
		return new Response('No account with valid credentials', { status: 400 });
	}

	const tryFetch = async (identifier: string) => {
		const params: Record<string, unknown> = {
			npf: true,
			reblog_info: true,
			notes_info: true
		};
		if (before) {
			params.before = before.toString();
		}
		return client.blogLikes(identifier, params);
	};

	try {
		let data;
		try {
			data = await tryFetch(blogName);
		} catch (error) {
			const status = (error as TumblrError).statusCode;
			if (status === 404 && !blogName.includes('.')) {
				data = await tryFetch(`${blogName}.tumblr.com`);
			} else {
				throw error;
			}
		}

		return new Response(JSON.stringify({
			liked_posts: data.liked_posts || [],
			response: data
		}), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error: unknown) {
		console.error('Failed to fetch likes:', error);
		const status = (error as TumblrError).statusCode || 500;
		return new Response(error instanceof Error ? error.message : 'Internal Server Error', { status });
	}
};
