import type { TumblrPost, NpfContentBlock, NpfLayoutBlock } from './types';

export type { PostFilter } from './types';

const FILTERABLE_BLOCKS = ['photo', 'video', 'audio', 'link', 'quote', 'chat'] as const;

function postHasBlockType(post: TumblrPost, type: string): boolean {
	const blocks = collectContentBlocks(post);
	return blocks.some((b) => b.type === type);
}

function postHasBlockSubtype(post: TumblrPost, subtype: string): boolean {
	const blocks = collectContentBlocks(post);
	return blocks.some((b) => 'subtype' in b && b.subtype === subtype);
}

function postHasAskLayout(post: TumblrPost): boolean {
	const layouts = [...(post.layout || [])] as NpfLayoutBlock[];
	if (post.trail) {
		for (const item of post.trail) {
			if (item.layout) layouts.push(...item.layout);
		}
	}
	return layouts.some((l) => l.type === 'ask');
}

export function collectContentBlocks(post: TumblrPost): NpfContentBlock[] {
	const result: NpfContentBlock[] = [...(post.content || [])];
	for (const item of post.trail || []) {
		if (item.content) result.push(...item.content);
	}
	return result;
}

export function matchesFilter(post: TumblrPost, filter: import('./types').PostFilter): boolean {
	if (filter === 'all') return true;

	if (FILTERABLE_BLOCKS.includes(filter as (typeof FILTERABLE_BLOCKS)[number])) {
		if (post.type === filter) return true;
	}

	if (filter === 'photo') return postHasBlockType(post, 'image') || post.type === 'photo';
	if (filter === 'video') return postHasBlockType(post, 'video') || post.type === 'video';
	if (filter === 'audio') return postHasBlockType(post, 'audio') || post.type === 'audio';
	if (filter === 'link') return postHasBlockType(post, 'link') || post.type === 'link';
	if (filter === 'quote') return postHasBlockSubtype(post, 'quote') || post.type === 'quote';
	if (filter === 'chat') return postHasBlockSubtype(post, 'chat') || post.type === 'chat';
	if (filter === 'answer') return postHasAskLayout(post) || post.type === 'answer';
	if (filter === 'text') {
		// NPF posts may report type 'blocks'; match text content instead of
		// only the legacy post.type value.
		return (
			post.type === 'text' ||
			postHasBlockType(post, 'text') ||
			(!postHasBlockType(post, 'image') &&
				!postHasBlockType(post, 'video') &&
				!postHasBlockType(post, 'audio') &&
				!postHasBlockType(post, 'link'))
		);
	}

	// PostType has no 'image' member; anything else is a direct type match.
	return filter !== 'image' && post.type === (filter as never);
}

/**
 * Filter a list of posts exactly once.
 * Use the same function everywhere so pages don't duplicate the logic.
 */
export function filterPosts(posts: TumblrPost[], filter: import('./types').PostFilter): TumblrPost[] {
	if (filter === 'all') return posts;
	return posts.filter((p) => matchesFilter(p, filter));
}
