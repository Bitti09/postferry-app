import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const mediaUrl = url.searchParams.get('url');
	if (!mediaUrl) throw error(400, 'Missing url parameter');

	try {
		// Try a completely raw fetch with minimal interference
		const res = await fetch(mediaUrl, {
			headers: {
				'Accept': '*/*',
				'Connection': 'keep-alive'
			},
			redirect: 'follow'
		});

		if (!res.ok) {
			console.error(`[Media Proxy] Remote server returned ${res.status} for ${mediaUrl}`);
			
			// Try one last desperate attempt with a very generic User-Agent if raw fails
			const retryRes = await fetch(mediaUrl, {
				headers: {
					'User-Agent': 'Mozilla/5.0'
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

		return new Response(res.body, {
			headers: {
				'Content-Type': contentType || 'application/octet-stream',
				...(contentLength ? { 'Content-Length': contentLength } : {}),
				'Cache-Control': 'public, max-age=31536000, immutable',
				'Access-Control-Allow-Origin': '*'
			}
		});
	} catch (e: any) {
		console.error('[Media Proxy] Fatal Error:', e);
		throw error(500, e.message || 'Internal Server Error');
	}
};
