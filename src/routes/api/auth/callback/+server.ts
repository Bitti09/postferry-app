import { oauthClient, takeTokenSecret } from '#lib/server/oauth';
import { TUMBLR_CONSUMER_KEY, TUMBLR_CONSUMER_SECRET } from '$app/env/private';
import { TumblrClient } from 'postferry';
import { USER_AGENT } from '#lib/server/clients';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const oauthToken = url.searchParams.get('oauth_token');
	const oauthVerifier = url.searchParams.get('oauth_verifier');

	if (!oauthToken || !oauthVerifier) {
		return new Response('Missing token or verifier', { status: 400 });
	}

	// Retrieve secret from the capped store or cookie (also handles TTL expiry).
	const tokenSecret = takeTokenSecret(oauthToken) ?? cookies.get('oauth_token_secret');
	if (!tokenSecret) {
		return new Response('Session expired or secret lost', { status: 400 });
	}

	cookies.delete('oauth_token_secret', { path: '/', sameSite: 'lax' });

	const access = await oauthClient.accessToken(oauthToken, tokenSecret, oauthVerifier);

	const client = new TumblrClient({
		consumerKey: TUMBLR_CONSUMER_KEY,
		consumerSecret: TUMBLR_CONSUMER_SECRET,
		token: access.token,
		tokenSecret: access.tokenSecret,
		userAgent: USER_AGENT
	});
	const userInfo = await client.userInfo();
	const blogName = userInfo.user.name;

	// Hand off to the SPA via sessionStorage. The layout's pending-OAuth effect
	// (src/routes/+layout.svelte) persists the account into IndexedDB and
	// clears both sessionStorage and the `?pending=1` query parameter.
	const html = `
		<!DOCTYPE html>
		<html>
		<head>
			<meta charset="utf-8" />
			<title>Authenticating...</title>
		</head>
		<body>
			<script>
				const pending = {
					blogName: ${JSON.stringify(blogName)},
					token: ${JSON.stringify(access.token)},
					secret: ${JSON.stringify(access.tokenSecret)},
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

	return new Response(html, { headers: { 'Content-Type': 'text/html' } });
};
