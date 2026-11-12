import { oauthClient, rememberTokenSecret } from '#lib/server/oauth';
import { redirect } from '@sveltejs/kit';
import { TUMBLR_CALLBACK_URL } from '$app/env/private';
import type { RequestHandler } from './$types';

/**
 * Tumblr rejects any `oauth_callback` that is not registered verbatim on the
 * app, so the callback must never be inferred from the incoming request
 * (`http` behind a TLS-terminating tunnel, a `localhost` port, or a rotated
 * ngrok host all produce a URL Tumblr refuses).
 *
 * `TUMBLR_CALLBACK_URL` is the registered value and wins whenever it is set.
 * The header-based fallback only exists for local setups without that env var.
 */
function resolveCallbackUrl(url: URL, request: Request): string {
	if (TUMBLR_CALLBACK_URL) return TUMBLR_CALLBACK_URL;

	const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
	const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
	return `${proto || url.protocol.replace(':', '')}://${host || url.host}/api/auth/callback`;
}

export const GET: RequestHandler = async ({ url, request, cookies }) => {
	const callbackUrl = resolveCallbackUrl(url, request);

	const requestToken = await oauthClient.requestToken(callbackUrl);
	rememberTokenSecret(requestToken.token, requestToken.tokenSecret);

	// Cookie fallback for a second mechanism / restart between redirects.
	cookies.set('oauth_token_secret', requestToken.tokenSecret, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		maxAge: 60 * 10
	});

	throw redirect(302, oauthClient.authorizeUrl(requestToken.token), { external: true });
};
