import { publicClient } from '#lib/server/clients';
import type { RequestHandler } from './$types';

const ALLOWED_SIZES = new Set([16, 24, 30, 40, 48, 64, 96, 128, 512]);

/**
 * Same-origin avatar proxy. The only Tumblr API access happens in
 * `postferry`; the browser never calls api.tumblr.com directly.
 */
export const GET: RequestHandler = async ({ url }) => {
	const blog = url.searchParams.get('blog');
	if (!blog) return new Response('blog is required', { status: 400 });

	const requested = Number(url.searchParams.get('size') ?? 64);
	const size = ALLOWED_SIZES.has(requested) ? requested : 64;

	try {
		const response = await publicClient().blogAvatar(blog, size);
		if (!response.ok) {
			return new Response(null, { status: response.status, statusText: response.statusText });
		}
		return new Response(response.body, {
			status: 200,
			headers: {
				'Content-Type': response.headers.get('content-type') ?? 'image/png',
				'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800'
			}
		});
	} catch (error) {
		console.error('Avatar proxy failed:', error);
		return new Response('Avatar unavailable', { status: 502 });
	}
};
