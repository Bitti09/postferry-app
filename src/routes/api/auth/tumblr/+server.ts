import { oauth, tokenSecretsMap } from '$lib/server/oauth';
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const callbackUrl = `${url.origin}/api/auth/callback`;

	const requestData = {
		url: 'https://www.tumblr.com/oauth/request_token',
		method: 'POST',
		data: { oauth_callback: callbackUrl }
	};

	const authHeader = oauth.toHeader(oauth.authorize(requestData));

	const response = await fetch(requestData.url, {
		method: requestData.method,
		headers: {
			...authHeader,
			'Content-Type': 'application/x-www-form-urlencoded'
		}
	});

	if (!response.ok) {
		const text = await response.text();
		return new Response(`Error fetching request token: ${text}`, { status: response.status });
	}

	const text = await response.text();
	const params = new URLSearchParams(text);
	const oauth_token = params.get('oauth_token');
	const oauth_token_secret = params.get('oauth_token_secret');

	if (!oauth_token || !oauth_token_secret) {
		return new Response('Invalid response from Tumblr', { status: 500 });
	}

	// Store secret in Map
	tokenSecretsMap.set(oauth_token, oauth_token_secret);
	
	// Also store in cookie as a fallback/secondary mechanism
	cookies.set('oauth_token_secret', oauth_token_secret, {
		path: '/',
		httpOnly: true,
		secure: url.protocol === 'https:',
		maxAge: 60 * 10 // 10 minutes
	});

	throw redirect(302, `https://www.tumblr.com/oauth/authorize?oauth_token=${oauth_token}`);
};
