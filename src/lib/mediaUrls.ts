import type { TumblrPost, MediaItem, NpfContentBlock, ImageBlock, VideoBlock, LinkBlock } from '$lib/types';
import type { MediaExtraction } from '$lib/types';

function toMediaArray(media?: MediaItem[] | MediaItem | null): MediaItem[] {
	if (!media) return [];
	return Array.isArray(media) ? media : [media];
}

/** Select the highest-quality media URL from a media array. */
function pickBestMediaUrl(media?: MediaItem[] | MediaItem | null): string | null {
	const mediaArray = toMediaArray(media);
	if (!mediaArray.length) return null;

	// 1. Look for the guaranteed original
	const original = mediaArray.find(m => m.has_original_dimensions && !m.cropped);
	if (original) return original.url ?? null;

	// 2. Filter out cropped thumbnails
	let candidates = mediaArray.filter(m => !m.cropped);
	if (!candidates.length) candidates = mediaArray; // fallback if everything is cropped

	// 3. Evaluate based on explicit HD flag or largest area
	let best = candidates[0];
	for (let i = 1; i < candidates.length; i++) {
		const m = candidates[i];
		if (m.hd && !best.hd) {
			best = m;
			continue;
		}
		
		const currentArea = (m.width || 0) * (m.height || 0);
		const bestArea = (best.width || 0) * (best.height || 0);
		if (currentArea > bestArea) {
			best = m;
		}
	}
	
	return best.url ?? null;
}

/** Type guard for image blocks */
function isImageBlock(block: NpfContentBlock): block is ImageBlock {
	return block.type === 'image';
}

/** Type guard for video blocks */
function isVideoBlock(block: NpfContentBlock): block is VideoBlock {
	return block.type === 'video';
}

/** Type guard for link blocks (have url) */
function isLinkBlock(block: NpfContentBlock): block is LinkBlock {
	return block.type === 'link';
}

/** Extract media from NPF content blocks. */
function extractFromBlocks(blocks: NpfContentBlock[]): MediaExtraction {
	const urls = new Set<string>();
	const videos = new Set<string>();
	const images = new Set<string>();
	const posters = new Set<string>();
	const filmstrips = new Set<string>();
	let primary = '';

	for (const block of blocks ?? []) {
			if (isImageBlock(block)) {
				const url = pickBestMediaUrl(block.media);
				if (url) {
					urls.add(url);
					images.add(url);
					if (!primary) primary = url;
				}
			} else if (isVideoBlock(block)) {
				const isNative = !block.provider || block.provider === 'tumblr';
				let vidUrl: string | null = null;
				
				if (isNative) {
					// Native video: attempt to follow NPF waterfall for playable MP4s
					vidUrl = pickBestMediaUrl(block.media) ?? 
							 block.embed_url ?? 
							 block.embed_iframe?.url ?? 
							 block.url ?? null;
				}
				
				const posterUrl = pickBestMediaUrl(block.poster) ?? block.thumbnail_url;
				
				if (vidUrl) {
					urls.add(vidUrl);
					videos.add(vidUrl);
				}
				if (posterUrl) {
					urls.add(posterUrl);
					posters.add(posterUrl);
				}
				if (!primary) primary = posterUrl ?? vidUrl ?? '';

				// Extract filmstrip frames for video preview scrubbing
				if (block.filmstrip) {
					const stripArray = toMediaArray(block.filmstrip);
					for (const frame of stripArray) {
						if (frame.url) {
							urls.add(frame.url);
							filmstrips.add(frame.url);
						}
					}
				}
			} else if (isLinkBlock(block)) {
				const posterUrl = pickBestMediaUrl(block.poster);
				if (posterUrl) {
					urls.add(posterUrl);
					images.add(posterUrl);
					if (!primary) primary = posterUrl;
				}
			}
		}

	return {
		urls: [...urls],
		videos: [...videos],
		images: [...images],
		posters: [...posters],
		filmstrips: [...filmstrips],
		primary
	};
}

/** Extract media from legacy post fields (photo/video types). */
function extractLegacyUrls(post: TumblrPost): MediaExtraction {
	const urls = new Set<string>();
	const images = new Set<string>();
	const videos = new Set<string>();
	const posters = new Set<string>();
	const filmstrips = new Set<string>();
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
			const url = match[1];
			if (url) {
				urls.add(url);
				images.add(url);
				if (!primary) primary = url;
			}
		}

		const videoRegex = /<video[^>]*><source[^>]+src="([^">]+)"/g;
		while ((match = videoRegex.exec(post.body)) !== null) {
			const url = match[1];
			if (url) {
				urls.add(url);
				videos.add(url);
			}
		}
	}

	return {
		urls: [...urls],
		images: [...images],
		videos: [...videos],
		posters: [...posters],
		filmstrips: [...filmstrips],
		primary
	};
}

/** Generate a cache key for a post based on its immutable identifiers. */
function getMediaKey(post: TumblrPost): string {
	return `${post.id}:${post.timestamp}:${post.body?.length ?? 0}`;
}

/** Simple LRU cache for extraction results (max 500 entries). */
const extractionCache = new Map<string, MediaExtraction>();
const MAX_CACHE_SIZE = 500;

function setCached(key: string, value: MediaExtraction): void {
	if (extractionCache.size >= MAX_CACHE_SIZE) {
		const firstKey = extractionCache.keys().next().value;
		firstKey && extractionCache.delete(firstKey);
	}
	extractionCache.set(key, value);
}

/**
 * Extract all media URLs from a Tumblr post (NPF + legacy + reblog trail).
 * Results are memoized to avoid re-scanning during render passes.
 */
export function extractMedia(post: TumblrPost): MediaExtraction {
	const key = getMediaKey(post);

	const cached = extractionCache.get(key);
	if (cached) return cached;

	// NPF content blocks
	let result = extractFromBlocks(post.content ?? []);

	// Reblog trail
	for (const trail of post.trail ?? []) {
		const trailResult = extractFromBlocks(trail.content ?? []);
		result = {
			urls: [...new Set([...result.urls, ...trailResult.urls])],
			videos: [...new Set([...result.videos, ...trailResult.videos])],
			images: [...new Set([...result.images, ...trailResult.images])],
			posters: [...new Set([...result.posters, ...trailResult.posters])],
			filmstrips: [...new Set([...result.filmstrips, ...trailResult.filmstrips])],
			primary: result.primary || trailResult.primary
		};
	}

	// Fallback to legacy fields if NPF yielded nothing
	if (!result.urls.length) {
		result = extractLegacyUrls(post);
	}

	// Ensure clean output
	const preferredPrimary =
		result.images[0] ||
		result.posters[0] ||
		result.videos[0] ||
		result.primary ||
		result.urls[0] ||
		'';

	const cleaned: MediaExtraction = {
		urls: result.urls.filter(Boolean),
		videos: result.videos.filter(Boolean),
		images: result.images.filter(Boolean),
		posters: result.posters.filter(Boolean),
		filmstrips: result.filmstrips.filter(Boolean),
		primary: preferredPrimary
	};

	setCached(key, cleaned);
	return cleaned;
}

/** Get all media URLs (images + videos + posters) from a post. */
export function getAllMediaUrls(post: TumblrPost): string[] {
	return extractMedia(post).urls;
}

/** Get the primary/featured media URL for a post. */
export function getPrimaryMediaUrl(post: TumblrPost): string {
	return extractMedia(post).primary;
}

/** Get all video URLs from a post. */
export function getVideoUrls(post: TumblrPost): string[] {
	return extractMedia(post).videos;
}

/** Get all image URLs from a post. */
export function getImageUrls(post: TumblrPost): string[] {
	return extractMedia(post).images;
}

/** Get all poster/thumbnail URLs from a post (mostly video posters). */
export function getPosterUrls(post: TumblrPost): string[] {
	return extractMedia(post).posters;
}

/** Clear the extraction cache (useful for testing or memory pressure). */
export function clearMediaExtractionCache(): void {
	extractionCache.clear();
}
