import { checkRateLimit } from '$lib/server/rateLimiter';
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

		console.log('\n--- [Backend Search API] New Request ---');
		console.log('Query Payload:', { query, before, type, account: account.blogName });

		const cleanQuery = query.startsWith('#') ? query.substring(1) : query;
		
		const url = new URL('https://api.tumblr.com/v2/tagged');
		url.searchParams.set('tag', cleanQuery);
		if (before) {
			url.searchParams.set('before', before.toString());
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

		console.log(`[Backend Search API] Requesting Tumblr Endpoint: ${requestData.url}`);

		const authHeader = oauth.toHeader(
			oauth.authorize(requestData, { key: account.token, secret: account.secret })
		);

		console.log(`[Backend Search API] Auth Header keys:`, Object.keys(authHeader));

		await checkRateLimit();
		const res = await fetch(requestData.url, {
			headers: { ...authHeader }
		});

		if (!res.ok) {
			const errorData = await res.text();
			console.error(`[Backend Search API] Error response (${res.status}):`, errorData);
			console.log('--- [Backend Search API] Request Failed ---\n');
			return new Response(errorData, { status: res.status });
		}

		const data = await res.json();
		
		// Log the shape of the response
		if (Array.isArray(data.response)) {
			console.log(`[Backend Search API] Success! Received array with ${data.response.length} items`);
		} else if (data.response?.posts) {
			console.log(`[Backend Search API] Success! Received object with .posts array of length ${data.response.posts.length}`);
		} else {
			console.log(`[Backend Search API] Success! Received unknown response shape. Keys:`, Object.keys(data.response || {}));
		}

		const posts = data.response?.posts || (Array.isArray(data.response) ? data.response : []);
		
		console.log('--- [Backend Search API] Request Complete ---\n');

		return new Response(JSON.stringify(posts), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error: any) {
		return new Response(error.message, { status: 500 });
	}
};
