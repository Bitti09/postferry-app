import { checkRateLimit } from '$lib/server/rateLimiter';
import { oauth, takeTokenSecret } from '$lib/server/oauth';
import { Client } from 'tumblr.js';
import { TUMBLR_CONSUMER_KEY, TUMBLR_CONSUMER_SECRET } from '$env/static/private';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const oauth_token = url.searchParams.get('oauth_token');
	const oauth_verifier = url.searchParams.get('oauth_verifier');

	if (!oauth_token || !oauth_verifier) {
		return new Response('Missing token or verifier', { status: 400 });
	}

	// Retrieve secret from the capped store or Cookie (also handles TTL expiry)
	const token_secret = takeTokenSecret(oauth_token) ?? cookies.get('oauth_token_secret');

	if (!token_secret) {
		return new Response('Session expired or secret lost', { status: 400 });
	}

	cookies.delete('oauth_token_secret', { path: '/' });

	const requestData = {
		url: 'https://www.tumblr.com/oauth/access_token',
		method: 'POST',
		data: { oauth_verifier }
	};

	const authHeader = oauth.toHeader(
		oauth.authorize(requestData, { key: oauth_token, secret: token_secret })
	);

	await checkRateLimit();
		const response = await fetch(requestData.url, {
		method: requestData.method,
		headers: {
			...authHeader,
			'Content-Type': 'application/x-www-form-urlencoded'
		}
	});

	if (!response.ok) {
		const text = await response.text();
		return new Response(`Error fetching access token: ${text}`, { status: response.status });
	}

	const text = await response.text();
	const params = new URLSearchParams(text);
	const access_token = params.get('oauth_token');
	const access_token_secret = params.get('oauth_token_secret');

	if (!access_token || !access_token_secret) {
		return new Response('Invalid access token response', { status: 500 });
	}

	const client = new Client({
		consumer_key: TUMBLR_CONSUMER_KEY,
		consumer_secret: TUMBLR_CONSUMER_SECRET,
		token: access_token,
		token_secret: access_token_secret
	});

	const userInfoData = await client.userInfo();
	const blogName = userInfoData.user.name;

	// Hand off to the SPA via sessionStorage. The layout's pending-OAuth
	// effect (see src/routes/+layout.svelte) reads this, persists via the
	// shared $lib/db/accounts.ts → openAppDB() v2 path, then clears the key.
	// This keeps the schema in one place — no inline IDB script here.
	const html = `
		<!DOCTYPE html>
		<html>
		<head>
			<title>Authenticating...</title>
		</head>
		<body>
			<script>
				const pending = {
					blogName: ${JSON.stringify(blogName)},
					token: ${JSON.stringify(access_token)},
					secret: ${JSON.stringify(access_token_secret)},
					active: true
				};
				try {
					sessionStorage.setItem('pending_oauth_account', JSON.stringify(pending));
				} catch (e) {
					console.error('Failed to stash pending OAuth account', e);
				}
				window.location.replace('/accounts?pending=1');
			</script>
		</body>
		</html>
	`;

	return new Response(html, {
		headers: {
			'Content-Type': 'text/html'
		}
	});
};
