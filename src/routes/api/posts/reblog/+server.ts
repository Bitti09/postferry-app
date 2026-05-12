import { oauth } from '$lib/server/oauth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { account, postId, reblogKey, comment } = await request.json();

		if (!account || !account.token || !account.secret || !postId || !reblogKey) {
			return new Response('Missing required parameters', { status: 400 });
		}

		const url = `https://api.tumblr.com/v2/blog/${account.blogName}/post/reblog`;

		const requestData = {
			url,
			method: 'POST',
			data: {
				id: postId,
				reblog_key: reblogKey,
				comment: comment || ''
			}
		};



		const authHeader = oauth.toHeader(
			oauth.authorize(requestData, { key: account.token, secret: account.secret })
		);

		const formData = new URLSearchParams();
		formData.append('id', postId.toString());
		formData.append('reblog_key', reblogKey);
		if (comment) {
			formData.append('comment', comment);
		}

		const res = await fetch(url, {
			method: 'POST',
			headers: { 
				...authHeader,
				'Content-Type': 'application/x-www-form-urlencoded'
			},
			body: formData.toString()
		});

		if (!res.ok) {
			const errorText = await res.text();
			console.error(`Tumblr Reblog Error:`, errorText);
			return new Response(errorText, { 
				status: res.status,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		const data = await res.json();
		return new Response(JSON.stringify({ success: true, response: data }), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error) {
		console.error('Reblog Server Error:', error);
		return new Response('Internal Server Error', { status: 500 });
	}
};
