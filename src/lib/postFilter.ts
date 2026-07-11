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

	if (filter === 'photo') return postHasBlockType(post, 'image');
	if (filter === 'video') return postHasBlockType(post, 'video');
	if (filter === 'audio') return postHasBlockType(post, 'audio');
	if (filter === 'link') return postHasBlockType(post, 'link');
	if (filter === 'quote') return postHasBlockSubtype(post, 'quote');
	if (filter === 'chat') return postHasBlockSubtype(post, 'chat');
	if (filter === 'answer') return postHasAskLayout(post);

	return post.type === filter;
}

/**
 * Filter a list of posts exactly once.
 * Use the same function everywhere so pages don't duplicate the logic.
 */
export function filterPosts(posts: TumblrPost[], filter: import('./types').PostFilter): TumblrPost[] {
	if (filter === 'all') return posts;
	return posts.filter((p) => matchesFilter(p, filter));
}
