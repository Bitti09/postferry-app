import type { TumblrPost, MediaItem, NpfContentBlock, ImageBlock, VideoBlock, LinkBlock, MediaExtraction, MediaVariant } from '$lib/types';

function toMediaArray(media?: MediaItem[] | MediaItem | null): MediaItem[] {
	if (!media) return [];
	return Array.isArray(media) ? media : [media];
}

function toVariant(m: MediaItem, video = false): MediaVariant {
	return {
		url: m.url,
		width: m.width ?? 0,
		height: m.height ?? 0,
		original: !!m.has_original_dimensions && !m.cropped,
		hd: !!m.hd,
		cropped: !!m.cropped,
		video: video || undefined
	};
}

/** Rank a rendition: originals first, then non-cropped, then area, then HD. */
function variantRank(v: MediaVariant): number {
	return (v.original ? 8 : 0) + (v.cropped ? 0 : 2) + (v.hd ? 1 : 0);
}

function compareVariants(a: MediaVariant, b: MediaVariant): number {
	const ra = variantRank(a);
	const rb = variantRank(b);
	if (ra !== rb) return ra - rb;
	return a.width * a.height - b.width * b.height;
}

/** Select the highest-quality media URL from a media array. */
function pickBestMediaUrl(media?: MediaItem[] | MediaItem | null): string | null {
	return pickBestMedia(media)?.url ?? null;
}

function pickBestMedia(media?: MediaItem[] | MediaItem | null): MediaVariant | null {
	const mediaArray = toMediaArray(media).filter(m => m.url);
	if (!mediaArray.length) return null;
	const variants = mediaArray.map(m => toVariant(m));
	return variants.reduce((best, v) => (compareVariants(v, best) > 0 ? v : best));
}

/** All renditions of a media array, best first. */
function allVariants(media?: MediaItem[] | MediaItem | null, video = false): MediaVariant[] {
	return toMediaArray(media)
		.filter(m => m.url)
		.map(m => toVariant(m, video))
		.sort(compareVariants)
		.reverse();
}

const SIZE_SUFFIX_RE = /^(.*?_)(\d+)(\.([a-zA-Z0-9]+))$/;

/**
 * Rewrite a media URL to a smaller rendition for grid display.
 *
 * CDN reality (verified live): Tumblr's current `sWxH` segment URLs are
 * content-hashed per rendition — rewriting the size segment 404s. Only the
 * legacy `_N.ext` suffix form serves dynamic sizes from the same path.
 * sWxH URLs therefore pass through unchanged; the CDN rendition the API
 * returned is used as-is and CSS `object-fit` handles downscaling.
 *
 * Returns the input unchanged when the shape is unknown or the source is
 * already smaller than targetPx.
 */
export function variantForDisplay(url: string, targetPx: number): string {
	const suffix = url.match(SIZE_SUFFIX_RE);
	if (suffix) {
		const width = parseInt(suffix[2], 10);
		if (width <= targetPx) return url;
		return `${suffix[1]}${targetPx}${suffix[3]}`;
	}
	return url;
}

/**
 * Resolve the true best source (highest resolution rendition) for a display
 * URL, using the extraction's variant table. Falls back to the display URL —
 * if we recorded no variants, what we had IS the best we know.
 */
export function bestSourceFor(displayUrl: string, extraction: MediaExtraction): MediaVariant {
	const variants = extraction.variants.get(displayUrl);
	if (!variants || variants.length === 0) {
		return { url: displayUrl, width: 0, height: 0, original: false, hd: false, cropped: false };
	}
	return variants[0];
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
	const variants = new Map<string, MediaVariant[]>();
	let primary = '';

	for (const block of blocks ?? []) {
		if (isImageBlock(block)) {
			const best = pickBestMedia(block.media);
			if (best) {
				urls.add(best.url);
				images.add(best.url);
				variants.set(best.url, allVariants(block.media));
				if (!primary) primary = best.url;
			}
		} else if (isVideoBlock(block)) {
			const isNative = !block.provider || block.provider === 'tumblr';
			let vidUrl: string | null = null;
			let vidVariants: MediaVariant[] = [];

			if (isNative) {
				// Native video: attempt to follow NPF waterfall for playable MP4s
				vidUrl = pickBestMediaUrl(block.media) ??
						 block.embed_url ??
						 block.embed_iframe?.url ??
						 block.url ?? null;
				vidVariants = allVariants(block.media, true);
			}

			const posterBest = pickBestMedia(block.poster);
			const posterUrl = posterBest?.url ?? block.thumbnail_url;

			if (vidUrl) {
				urls.add(vidUrl);
				videos.add(vidUrl);
				if (vidVariants.length > 0) variants.set(vidUrl, vidVariants);
			}
			if (posterUrl) {
				urls.add(posterUrl);
				posters.add(posterUrl);
				if (posterBest) variants.set(posterUrl, allVariants(block.poster));
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
			const posterBest = pickBestMedia(block.poster);
			if (posterBest) {
				urls.add(posterBest.url);
				images.add(posterBest.url);
				variants.set(posterBest.url, allVariants(block.poster));
				if (!primary) primary = posterBest.url;
			}
		}
	}

	return {
		urls: [...urls],
		videos: [...videos],
		images: [...images],
		posters: [...posters],
		filmstrips: [...filmstrips],
		primary,
		variants
	};
}

/** Extract media from legacy post fields (photo/video types). */
function extractLegacyUrls(post: TumblrPost): MediaExtraction {
	const urls = new Set<string>();
	const images = new Set<string>();
	const videos = new Set<string>();
	const posters = new Set<string>();
	const filmstrips = new Set<string>();
	const variants = new Map<string, MediaVariant[]>();
	let primary = '';

	if (post.type === 'photo' && post.photos) {
		for (const photo of post.photos) {
			const altSizes = [...(photo.alt_sizes ?? []), ...(photo.original_size ? [photo.original_size] : [])];
			const renditions = allVariants(altSizes);
			const best = pickBestMedia(altSizes) ?? pickBestMedia(photo.original_size);
			const url = best?.url ?? photo.original_size?.url;
			if (url) {
				urls.add(url);
				images.add(url);
				if (renditions.length > 0) variants.set(url, renditions);
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
		primary,
		variants
	};
}

/** Memoized per post object — auto-GC'd with the post, no size cap needed. */
const extractionCache = new WeakMap<TumblrPost, MediaExtraction>();

/**
 * Extract all media URLs from a Tumblr post (NPF + legacy + reblog trail).
 * Results are memoized to avoid re-scanning during render passes.
 */
export function extractMedia(post: TumblrPost): MediaExtraction {
	const cached = extractionCache.get(post);
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
			primary: result.primary || trailResult.primary,
			variants: new Map([...result.variants, ...trailResult.variants])
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
		primary: preferredPrimary,
		variants: result.variants
	};

	extractionCache.set(post, cleaned);
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

