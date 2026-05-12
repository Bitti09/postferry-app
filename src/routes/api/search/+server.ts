import { oauth } from '$lib/server/oauth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { account, query, before, type } = await request.json();

		if (!account || !account.token || !account.secret) {
			return new Response('Invalid account payload', { status: 400 });
		}

		if (!query) {
			return new Response('Query is required', { status: 400 });
		}

		const isTagSearch = query.startsWith('#');
		const cleanQuery = isTagSearch ? query.substring(1) : query;
		
		let url: URL;
		if (isTagSearch) {
			url = new URL('https://api.tumblr.com/v2/tagged');
			url.searchParams.set('tag', cleanQuery);
			if (before) {
				url.searchParams.set('before', before.toString());
			}
		} else {
			url = new URL('https://api.tumblr.com/v2/search/posts');
			url.searchParams.set('q', query);
			if (before) {
				url.searchParams.set('offset', before.toString());
			}
		}

		url.searchParams.set('limit', '20');
		url.searchParams.set('npf', 'true');
		if (type && type !== 'all') {
			url.searchParams.set('type', type);
		}

		const requestData = {
			url: url.toString(),
			method: 'GET'
		};

		const authHeader = oauth.toHeader(
			oauth.authorize(requestData, { key: account.token, secret: account.secret })
		);

		const res = await fetch(requestData.url, {
			headers: { ...authHeader }
		});

		if (!res.ok) {
			const errorData = await res.text();
			return new Response(errorData, { status: res.status });
		}

		const data = await res.json();
		const posts = data.response?.posts || (Array.isArray(data.response) ? data.response : []);
		
		return new Response(JSON.stringify(posts), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error: any) {
		return new Response(error.message, { status: 500 });
	}
};
