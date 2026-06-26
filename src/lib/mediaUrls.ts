import type { MediaBlock, TumblrPost, MediaItem } from './types';

export interface MediaExtraction {
	urls: string[];
	primary: string;
	videos: string[];
	images: string[];
	posters: string[];
}

function pickBestMediaUrl(media?: MediaItem[]): string | null {
	if (!media || media.length === 0) return null;

	const original = media.find((m) => m.has_original_dimensions);
	if (original?.url) return original.url;

	let largest = media[0];
	for (let i = 1; i < media.length; i++) {
		const item = media[i];
		if ((item.width || 0) > (largest.width || 0)) {
			largest = item;
		}
	}
	return largest.url || null;
}

function extractFromBlocks(blocks: MediaBlock[]): MediaExtraction {
	const urls = new Set<string>();
	const videos = new Set<string>();
	const images = new Set<string>();
	const posters = new Set<string>();
	let primary = '';

	for (const block of blocks || []) {
		if (block.type === 'image' || block.subtype === 'image') {
			const url = pickBestMediaUrl(block.media) || block.url;
			if (url) {
				urls.add(url);
				images.add(url);
				if (!primary) primary = url;
			}
		} else if (block.type === 'video' || block.subtype === 'video') {
			const vidUrl = pickBestMediaUrl(block.media) || block.url;
			const posterUrl = pickBestMediaUrl(block.poster) || block.thumbnail_url;
			if (vidUrl) {
				urls.add(vidUrl);
				videos.add(vidUrl);
			}
			if (posterUrl) {
				urls.add(posterUrl);
				posters.add(posterUrl);
			}
			if (!primary) primary = posterUrl || vidUrl || '';
		} else if (block.url) {
			urls.add(block.url);
			if (!primary) primary = block.url;
		}
	}

	return {
		urls: Array.from(urls).filter(Boolean),
		videos: Array.from(videos).filter(Boolean),
		images: Array.from(images).filter(Boolean),
		posters: Array.from(posters).filter(Boolean),
		primary
	};
}

function extractLegacyUrls(post: TumblrPost): Partial<MediaExtraction> {
	const urls = new Set<string>();
	const images = new Set<string>();
	const videos = new Set<string>();
	const posters = new Set<string>();
	let primary = '';

	if (post.type === 'photo' && post.photos) {
		for (const photo of post.photos) {
			const url = photo.original_size?.url;
			if (url) {
				urls.add(url);
				images.add(url);
				if (!primary) primary = url;
			}
		}
	} else if (post.type === 'video') {
		if (post.video_url) {
			urls.add(post.video_url);
			videos.add(post.video_url);
			if (!primary) primary = post.video_url;
		}
		if (post.thumbnail_url) {
			urls.add(post.thumbnail_url);
			posters.add(post.thumbnail_url);
			if (!primary) primary = post.thumbnail_url;
		}
	}

	if (post.body) {
		const imgRegex = /<img[^>]+src="([^">]+)"/g;
		let match: RegExpExecArray | null;
		while ((match = imgRegex.exec(post.body)) !== null) {
			if (match[1]) {
				urls.add(match[1]);
				images.add(match[1]);
				if (!primary) primary = match[1];
			}
		}

		const videoRegex = /<video[^>]*><source[^>]+src="([^">]+)"/g;
		while ((match = videoRegex.exec(post.body)) !== null) {
			if (match[1]) {
				urls.add(match[1]);
				videos.add(match[1]);
			}
		}
	}

	return {
		urls: Array.from(urls),
		images: Array.from(images),
		videos: Array.from(videos),
		posters: Array.from(posters),
		primary
	};
}

function getMediaKey(post: TumblrPost): string {
	return String(post.id) + ':' + (post.timestamp || '0') + ':' + (post.body?.length || 0);
}

const extractionCache = new WeakMap<TumblrPost, string>();
const extractionResults = new Map<string, MediaExtraction>();

/**
 * Extract every media URL from a post.
 * Results are memoized against a lightweight content fingerprint so repeated
 * calls during rendering (PostCard, Slideshow, cache-all) avoid re-scanning.
 */
export function extractMedia(post: TumblrPost): MediaExtraction {
	const key = getMediaKey(post);

	const cachedKey = extractionCache.get(post);
	if (cachedKey === key) {
		const cached = extractionResults.get(key);
		if (cached) return cached;
	}

	const npf = extractFromBlocks([...(post.content || [])]);
	for (const item of post.trail || []) {
		const trail = extractFromBlocks(item.content || []);
		npf.urls = [...new Set([...npf.urls, ...trail.urls])];
		npf.images = [...new Set([...npf.images, ...trail.images])];
		npf.videos = [...new Set([...npf.videos, ...trail.videos])];
		npf.posters = [...new Set([...npf.posters, ...trail.posters])];
		if (!npf.primary) npf.primary = trail.primary;
	}

	if (npf.urls.length === 0) {
		const legacy = extractLegacyUrls(post);
		npf.urls = legacy.urls || [];
		npf.images = legacy.images || [];
		npf.videos = legacy.videos || [];
		npf.posters = legacy.posters || [];
		if (!npf.primary) npf.primary = legacy.primary || '';
	}

	// Trim and filter
	const result: MediaExtraction = {
		urls: npf.urls.filter(Boolean),
		images: npf.images.filter(Boolean),
		videos: npf.videos.filter(Boolean),
		posters: npf.posters.filter(Boolean),
		primary: npf.primary
	};

	extractionCache.set(post, key);
	extractionResults.set(key, result);
	return result;
}

export function getAllMediaUrls(post: TumblrPost): string[] {
	return extractMedia(post).urls;
}

export function getPrimaryMediaUrl(post: TumblrPost): string {
	return extractMedia(post).primary;
}

export function getVideoUrls(post: TumblrPost): string[] {
	return extractMedia(post).videos;
}

export function getImageUrls(post: TumblrPost): string[] {
	return extractMedia(post).images;
}
