import { oauth } from '$lib/server/oauth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { account, blogName, postId } = await request.json();

		if (!account || !account.token || !account.secret) {
			return new Response('Invalid account payload', { status: 400 });
		}

		const url = new URL(`https://api.tumblr.com/v2/blog/${blogName}/posts`);
		url.searchParams.set('id', postId.toString());
		url.searchParams.set('notes_info', 'true');
		url.searchParams.set('reblog_info', 'true');
		url.searchParams.set('npf', 'true');

		const requestData = {
			url: url.toString(),
			method: 'GET'
		};

		const authHeader = oauth.toHeader(
			oauth.authorize(requestData, { key: account.token, secret: account.secret })
		);

		const res = await fetch(requestData.url, {
			headers: { ...authHeader }
		});

		if (!res.ok) {
			console.error(`Failed to fetch post detail:`, await res.text());
			return new Response('Error fetching post from Tumblr', { status: res.status });
		}

		const data = await res.json();
		const post = data.response.posts[0];
		return new Response(JSON.stringify({ 
			post,
			notes: post?.notes || [],
			liked: post?.liked ?? false
		}), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error) {
		console.error('Detail Error:', error);
		return new Response('Internal Server Error', { status: 500 });
	}
};
