import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, request }) => {
	const mediaUrl = url.searchParams.get('url');
	if (!mediaUrl) throw error(400, 'Missing url parameter');
	const range = request.headers.get('range');
	const ifRange = request.headers.get('if-range');

	try {
		// Try a completely raw fetch with minimal interference
		const res = await fetch(mediaUrl, {
			headers: {
				'Accept': '*/*',
				'Connection': 'keep-alive',
				'Referer': 'https://www.tumblr.com/',
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
				...(range ? { 'Range': range } : {}),
				...(ifRange ? { 'If-Range': ifRange } : {})
			},
			redirect: 'follow'
		});

		if (!res.ok) {
			// Try one last desperate attempt with a very generic User-Agent if raw fails
			const retryRes = await fetch(mediaUrl, {
				headers: {
					'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
					'Referer': 'https://www.tumblr.com/'
				},
				redirect: 'follow'
			}).catch(() => null);

			if (retryRes && retryRes.ok) {
				const contentType = retryRes.headers.get('Content-Type');
				const contentLength = retryRes.headers.get('Content-Length');
				return new Response(retryRes.body, {
					headers: {
						'Content-Type': contentType || 'application/octet-stream',
						...(contentLength ? { 'Content-Length': contentLength } : {}),
						'Access-Control-Allow-Origin': '*'
					}
				});
			}

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
	} catch (e: any) {
		console.error('[Media Proxy] Fatal Error:', e);
		throw error(500, e.message || 'Internal Server Error');
	}
};
