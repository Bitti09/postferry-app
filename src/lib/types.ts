// ─── API types ─────────────────────────────────────────────────────────────
// Post, blog, user and NPF types live in the standalone `postferry`
// package so the API client can be reused outside this app. Re-exported here
// for the app's existing `#lib/types` imports.

export type {
	PostType,
	PostState,
	PostFormatFilter,
	PostFilter,
	MediaObject,
	MediaItem,
	TextBlock,
	ImageBlock,
	VideoBlock,
	AudioBlock,
	LinkBlock,
	PaywallBlock,
	NpfContentBlock,
	FormatRange,
	MediaAttribution,
	LayoutAsk,
	LayoutRows,
	NpfLayoutBlock,
	MediaBlock,
	PostLayout,
	PostTrail,
	LegacyPhoto,
	TumblrPost,
	NoteBase,
	TumblrNote,
	NotesMode,
	TumblrBlog,
	TumblrUser,
	TumblrMeta,
	TumblrApiResponse,
	FeedMeta,
	FeedPost,
	AccountResult,
	DashboardParams,
	LikesParams,
	FollowingParams,
	BlogInfoParams,
	BlogPostsParams,
	BlogNotesParams,
	TaggedParams,
	LikeParams,
	ReblogParams,
	FollowParams
} from 'postferry';

export { postId } from 'postferry';

// ─── Account (app-specific) ────────────────────────────────────────────────

export interface TumblrAccount {
	blogName: string;
	token: string;
	secret: string;
	avatarUrl?: string;
	active: boolean;
}

// ─── Media extraction ──────────────────────────────────────────────────────

export interface MediaVariant {
	url: string;
	width: number;
	height: number;
	/** Tumblr guarantees this rendition preserves the original aspect/size. */
	original: boolean;
	hd: boolean;
	cropped: boolean;
	/** Populated only for video renditions; undefined for images. */
	video?: boolean;
}

export interface MediaExtraction {
	urls: string[];
	primary: string;
	videos: string[];
	images: string[];
	audio: string[];
	posters: string[];
	filmstrips: string[];
	/**
	 * Every known rendition per display URL, keyed by the chosen (best) URL.
	 * Lets the download function resolve the true original regardless of what
	 * the grid displayed, and lets the grid pick a small variant.
	 */
	variants: Map<string, MediaVariant[]>;
}

// ─── Cache types ───────────────────────────────────────────────────────────

export interface CachedMediaEntry {
	blob: Blob;
	type: string;
	timestamp?: number;
	post?: import('postferry').TumblrPost;
}

export interface CachedBlobResult {
	url: string;
	type: string;
}

export interface CacheProgress {
	done: number;
	total: number;
}
