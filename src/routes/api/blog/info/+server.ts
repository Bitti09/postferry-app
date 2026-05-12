import { oauth } from '$lib/server/oauth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { account, blogName } = await request.json();

		if (!account || !account.token || !account.secret) {
			return new Response('Invalid account payload', { status: 400 });
		}

		const requestData = {
			url: `https://api.tumblr.com/v2/blog/${blogName}/info`,
			method: 'GET'
		};

		const authHeader = oauth.toHeader(
			oauth.authorize(requestData, { key: account.token, secret: account.secret })
		);

		const res = await fetch(requestData.url, {
			headers: { ...authHeader }
		});

		if (!res.ok) {
			return new Response('Error fetching info', { status: res.status });
		}

		const data = await res.json();
		return new Response(JSON.stringify({ info: data.response.blog }), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error) {
		return new Response('Internal Server Error', { status: 500 });
	}
};
