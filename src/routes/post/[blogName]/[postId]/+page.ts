import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
	return {
		blogName: params.blogName,
		postId: params.postId
	};
};
