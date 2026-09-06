import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const BROWSER_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Same-origin media proxy. Primary path for content the service worker can't
 * fetch cross-origin (no-CORS hosts) and for video Range streaming. Fetches
 * pass-through with Range/If-Range preserved; responses are immutable so the
 * browser HTTP cache absorbs repeats.
 */
export const GET: RequestHandler = async ({ url, request }) => {
	const mediaUrl = url.searchParams.get('url');
	if (!mediaUrl) throw error(400, 'Missing url parameter');

	const range = request.headers.get('range');
	const ifRange = request.headers.get('if-range');

	try {
		const res = await fetch(mediaUrl, {
			headers: {
				'Accept': '*/*',
				'Referer': 'https://www.tumblr.com/',
				'User-Agent': BROWSER_UA,
				...(range ? { 'Range': range } : {}),
				...(ifRange ? { 'If-Range': ifRange } : {})
			},
			redirect: 'follow',
			// Stop serving when the client is gone (fast scroll / tab close).
			signal: request.signal
		});

		if (!res.ok) {
			return new Response(null, { status: res.status, statusText: res.statusText });
		}

		const contentType = res.headers.get('Content-Type');
		const contentLength = res.headers.get('Content-Length');
		const contentRange = res.headers.get('Content-Range');
		const acceptRanges = res.headers.get('Accept-Ranges');
		const etag = res.headers.get('ETag');
		const lastModified = res.headers.get('Last-Modified');

		return new Response(res.body, {
			status: res.status,
			statusText: res.statusText,
			headers: {
				'Content-Type': contentType || 'application/octet-stream',
				...(contentLength ? { 'Content-Length': contentLength } : {}),
				...(contentRange ? { 'Content-Range': contentRange } : {}),
				...(acceptRanges ? { 'Accept-Ranges': acceptRanges } : {}),
				...(etag ? { 'ETag': etag } : {}),
				...(lastModified ? { 'Last-Modified': lastModified } : {}),
				'Cache-Control': 'public, max-age=31536000, immutable',
				'Access-Control-Allow-Origin': '*'
			}
		});
	} catch (e: unknown) {
		// Client aborts land here — expected during scrolling, don't 500.
		if (e instanceof Error && e.name === 'AbortError') {
			return new Response(null, { status: 499 });
		}
		console.error('[Media Proxy] Fatal Error:', e);
		throw error(500, e instanceof Error ? e.message : 'Internal Server Error');
	}
};
