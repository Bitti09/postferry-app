import { oauth } from '$lib/server/oauth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { account, blogName, before } = await request.json();

		if (!account || !account.token || !account.secret) {
			return new Response('Invalid account payload', { status: 400 });
		}

		const tryFetch = async (identifier: string) => {
			const url = new URL(`https://api.tumblr.com/v2/blog/${identifier}/likes`);
			url.searchParams.set('reblog_info', 'true');
			url.searchParams.set('notes_info', 'true');
			if (before) {
				url.searchParams.set('before', before.toString());
			}

			const requestData = { url: url.toString(), method: 'GET' };
			const authHeader = oauth.toHeader(oauth.authorize(requestData, { key: account.token, secret: account.secret }));
			return fetch(requestData.url, { headers: { ...authHeader } });
		};

		let res = await tryFetch(blogName);

		// Fallback: Try with .tumblr.com suffix
		if (res.status === 404 && !blogName.includes('.')) {
			res = await tryFetch(`${blogName}.tumblr.com`);
		}

		if (!res.ok) {
			const errorText = await res.text();
			console.error(`Failed to fetch likes for ${blogName}:`, errorText);
			return new Response(errorText, { status: res.status });
		}

		const data = await res.json();
		return new Response(JSON.stringify({ liked_posts: data.response.liked_posts }), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error) {
		return new Response('Internal Server Error', { status: 500 });
	}
};
