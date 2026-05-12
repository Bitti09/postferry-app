import { oauth, tokenSecretsMap } from '$lib/server/oauth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const oauth_token = url.searchParams.get('oauth_token');
	const oauth_verifier = url.searchParams.get('oauth_verifier');

	if (!oauth_token || !oauth_verifier) {
		return new Response('Missing token or verifier', { status: 400 });
	}

	// Retrieve secret from Map or Cookie
	let token_secret = tokenSecretsMap.get(oauth_token);
	if (!token_secret) {
		token_secret = cookies.get('oauth_token_secret') || undefined;
	}

	if (!token_secret) {
		return new Response('Session expired or secret lost', { status: 400 });
	}

	// Clean up map
	tokenSecretsMap.delete(oauth_token);
	cookies.delete('oauth_token_secret', { path: '/' });

	const requestData = {
		url: 'https://www.tumblr.com/oauth/access_token',
		method: 'POST',
		data: { oauth_verifier }
	};

	const authHeader = oauth.toHeader(
		oauth.authorize(requestData, { key: oauth_token, secret: token_secret })
	);

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

	// Fetch user info to get the blog name
	const userInfoRequest = {
		url: 'https://api.tumblr.com/v2/user/info',
		method: 'GET'
	};

	const userInfoAuthHeader = oauth.toHeader(
		oauth.authorize(userInfoRequest, { key: access_token, secret: access_token_secret })
	);

	const userInfoResponse = await fetch(userInfoRequest.url, {
		headers: { ...userInfoAuthHeader }
	});

	if (!userInfoResponse.ok) {
		return new Response('Error fetching user info', { status: userInfoResponse.status });
	}

	const userInfoData = await userInfoResponse.json();
	const blogName = userInfoData.response.user.name;

	// Render an HTML page that saves the tokens to localStorage and redirects to /
	const html = `
		<!DOCTYPE html>
		<html>
		<head>
			<title>Authenticating...</title>
		</head>
		<body>
			<script>
				const newAccount = {
					blogName: ${JSON.stringify(blogName)},
					token: ${JSON.stringify(access_token)},
					secret: ${JSON.stringify(access_token_secret)},
					active: true
				};
				
				const storageKey = 'tumblr_accounts';
				let accounts = JSON.parse(localStorage.getItem(storageKey) || '[]');
				
				// Prevent duplicates
				const existingIndex = accounts.findIndex(a => a.blogName === newAccount.blogName);
				if (existingIndex >= 0) {
					accounts[existingIndex] = { ...newAccount, active: accounts[existingIndex].active };
				} else {
					accounts.push(newAccount);
				}
				
				localStorage.setItem(storageKey, JSON.stringify(accounts));
				window.location.href = '/';
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
