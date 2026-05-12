import { oauth } from '$lib/server/oauth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { account } = await request.json();

		if (!account || !account.token || !account.secret) {
			return new Response('Missing required parameters', { status: 400 });
		}

		const url = 'https://api.tumblr.com/v2/user/info';

		const requestData = {
			url,
			method: 'GET'
		};

		const authHeader = oauth.toHeader(
			oauth.authorize(requestData, { key: account.token, secret: account.secret })
		);

		const res = await fetch(url, {
			method: 'GET',
			headers: { 
				...authHeader
			}
		});

		if (!res.ok) {
			const errorText = await res.text();
			return new Response(errorText, { status: res.status });
		}

		const data = await res.json();
		return new Response(JSON.stringify(data.response.user), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error) {
		console.error('User Info Error:', error);
		return new Response('Internal Server Error', { status: 500 });
	}
};
