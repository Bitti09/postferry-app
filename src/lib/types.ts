// ─── Official Tumblr API v2 & NPF Types ────────────────────────────────────
// Aligned with tumblr.js v5.0.1 and the Neue Post Format specification.
// https://www.tumblr.com/docs/en/api/v2
// https://www.tumblr.com/docs/npf

export type PostType = 'text' | 'quote' | 'link' | 'answer' | 'video' | 'audio' | 'photo' | 'chat';

export type PostState = 'published' | 'queue' | 'draft' | 'private' | 'unapproved';

export type PostFormatFilter = 'text' | 'raw';

export type PostFilter =
	| 'all'
	| PostType
	| 'image'; // image is a block-level filter, not a legacy post type

// ─── Media Objects ─────────────────────────────────────────────────

export interface MediaObject {
	url: string;
	type?: string;
	width?: number;
	height?: number;
	original_dimensions_missing?: boolean;
	has_original_dimensions?: boolean;
	cropped?: boolean;
	hd?: boolean;
	poster?: MediaObject | MediaObject[];
}

export type MediaItem = MediaObject;

// ─── NPF Content Blocks ─────────────────────────────────

export interface TextBlock {
	type: 'text';
	text: string;
	subtype?: string;
	indent_level?: number;
	formatting?: FormatRange[];
}

export interface ImageBlock {
	type: 'image';
	media: MediaObject[];
	caption?: string;
	alt_text?: string;
	attribution?: MediaAttribution;
	colors?: Record<string, string>;
	feedback_token?: string;
	poster?: MediaObject | MediaObject[];
}

export interface VideoBlock {
	type: 'video';
	media?: MediaObject[];
	poster?: MediaObject[];
	thumbnail_url?: string;
	caption?: string;
	attribution?: MediaAttribution;
	url?: string;
	embed_html?: string;
	embed_iframe?: { url: string; width: number; height: number };
	embed_url?: string;
	provider?: string;
	metadata?: any;
	filmstrip?: MediaObject | MediaObject[];
}

export interface AudioBlock {
	type: 'audio';
	media: MediaObject[];
	title?: string;
	artist?: string;
	album?: string;
	attribution?: MediaAttribution;
	embed_html?: string;
	provider?: string;
}

export interface LinkBlock {
	type: 'link';
	url: string;
	title?: string;
	description?: string;
	author?: string;
	excerpt?: string;
	site_name?: string;
	display_url?: string;
	poster?: MediaObject[];
}

export interface PaywallBlock {
	type: 'paywall';
	subtype?: string;
}

export type NpfContentBlock = TextBlock | ImageBlock | VideoBlock | AudioBlock | LinkBlock | PaywallBlock;

// ─── Formatting ────────────────────────────────────────────

export interface FormatRange {
	start: number;
	end: number;
	type:
		| 'bold'
		| 'italic'
		| 'strikethrough'
		| 'small'
		| 'link'
		| 'mention'
		| 'color'
		| 'ordered-list-item'
		| 'unordered-list-item';
	url?: string;
	hex?: string;
	blog?: {
		name?: string;
		uuid?: string;
		url?: string;
	};
}

// ─── Attribution ──────────────────────────────────────────────────

export interface MediaAttribution {
	type?: string;
	url?: string;
	app_name?: string;
	blog?: {
		name?: string;
		uuid?: string;
		url?: string;
	};
	post?: {
		id?: string;
		url?: string;
	};
}

// ─── NPF Layout Blocks ──────────────────────────────────

export interface LayoutAsk {
	type: 'ask';
	blocks: number[];
	attribution?: MediaAttribution;
}

export interface LayoutRows {
	type: 'rows';
	display: Array<{
		blocks: number[];
		mode?: { type: string };
	}>;
	truncate_after?: number;
}

export type NpfLayoutBlock = LayoutAsk | LayoutRows;

export type MediaBlock = NpfContentBlock;

export type PostLayout = NpfLayoutBlock;

// ─── Post Trail (Reblog Chain) ──────────────────────────────────────────────

export interface PostTrail {
	content?: NpfContentBlock[];
	layout?: NpfLayoutBlock[];
	broken_blog_name?: string;
	blog?: {
		name?: string;
		uuid?: string;
		url?: string;
	};
	post?: {
		id?: string;
		timestamp?: number;
	};
}

// ─── Legacy Photo Sizes ─────────────────────────────────

export interface LegacyPhoto {
	original_size?: MediaObject;
	alt_sizes?: MediaObject[];
}

// ─── Tumblr Post (Unified Legacy + NPF) ─────────────────────────────────────

export interface TumblrPost {
	id: number;
	id_string: string;
	blog_name: string;
	blog?: {
		uuid?: string;
		name?: string;
		url?: string;
		title?: string;
	};
	timestamp: number;
	date?: string;
	summary: string;
	body?: string;
	type: PostType;
	is_nsfw?: boolean;
	is_nsfw_content?: boolean;
	is_nsfw_blog?: boolean;
	is_advertisement?: boolean;
	is_pinned?: boolean;
	can_like?: boolean;
	can_reblog?: boolean;
	can_reply?: boolean;
	can_send_in_message?: boolean;
	followed?: boolean;
	liked?: boolean;
	liked_timestamp?: number;
	reblogged?: boolean;
	reblog_key?: string;
	reblogged_from_id?: string;
	reblogged_from_url?: string;
	reblogged_from_name?: string;
	reblogged_from_title?: string;
	reblogged_root_id?: string;
	reblogged_root_url?: string;
	reblogged_root_name?: string;
	reblogged_root_title?: string;
	state?: PostState;
	short_url?: string;
	post_url?: string;
	slug?: string;
	note_count?: number;
	like_count?: number;
	reblog_count?: number;
	reply_count?: number;
	source_url?: string;
	source_title?: string;
	tags?: string[];
	// NPF fields
	content: NpfContentBlock[];
	layout?: NpfLayoutBlock[];
	trail?: PostTrail[];
	// Legacy fields (still returned by API alongside NPF)
	photos?: LegacyPhoto[];
	video_url?: string;
	thumbnail_url?: string;
	player?: Array<{ embed_code?: string; width?: number; height?: number }>;
	caption?: string;
	// Notes (when notes_info=true)
	notes?: TumblrNote[];
}

// ─── Notes ─────────────────────────────────────────────────

export type TumblrNote =
	| { type: 'like'; timestamp: number; blog_name: string; blog_uuid: string; blog_url: string; followed: boolean; avatar_shape: string }
	| { type: 'reblog'; timestamp: number; blog_name: string; blog_uuid: string; blog_url: string; followed: boolean; avatar_shape: string; post_id: string; reblog_parent_blog_name?: string; added_text?: string; tags?: string[] }
	| { type: 'reply'; timestamp: number; blog_name: string; blog_uuid: string; blog_url: string; followed: boolean; avatar_shape: string; reply_text: string }
	| { type: 'posted'; timestamp: number; blog_name: string; blog_uuid: string; blog_url: string; followed: boolean; avatar_shape: string };

// ─── Blog ─────────────────────────────────────────────────

export interface TumblrBlog {
	name: string;
	url: string;
	title: string;
	description: string;
	uuid?: string;
	updated?: number;
	posts?: number;
	ask?: boolean;
	ask_anon?: boolean;
	ask_page_title?: string;
	followed?: boolean;
	can_send_fan_mail?: boolean;
	can_subscribe?: boolean;
	is_nsfw?: boolean;
	share_likes?: boolean;
	share_following?: boolean;
	type?: string;
	primary?: boolean;
}

// ─── User ─────────────────────────────────────────────────

export interface TumblrUser {
	name: string;
	likes: number;
	following: number;
	default_post_format: string;
	blogs: TumblrBlog[];
	email?: string;
}

// ─── Account (App-specific) ─────────────────────────────────────────────────

export interface TumblrAccount {
	blogName: string;
	token: string;
	secret: string;
	avatarUrl?: string;
	active: boolean;
}

// ─── API Response Wrappers ──────────────────────────────────────────────────

export interface TumblrApiResponse<T> {
	meta: {
		status: number;
		msg: string;
	};
	response: T;
}

export type UserInfoResponse = TumblrApiResponse<{ user: TumblrUser }>;
export type DashboardResponse = TumblrApiResponse<{ posts: TumblrPost[]; _links?: { next?: { href: string; method: string; query_params: Record<string, string> } } }>;
export type BlogInfoResponse = TumblrApiResponse<{ blog: TumblrBlog }>;
export type BlogPostsResponse = TumblrApiResponse<{ posts: TumblrPost[]; total_posts?: number; _links?: { next?: { href: string; method: string; query_params: Record<string, string> } } }>;
export type BlogLikesResponse = TumblrApiResponse<{ liked_posts: TumblrPost[]; liked_count: number }>;
export type UserFollowingResponse = TumblrApiResponse<{ blogs: TumblrBlog[]; total_blogs: number }>;
export type TaggedResponse = TumblrApiResponse<{ posts: TumblrPost[] }>;
export type PostDetailResponse = TumblrApiResponse<{ posts: TumblrPost[] }>;

// ─── Media Extraction ───────────────────────────────────────────────────────

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
	posters: string[];
	filmstrips: string[];
	/**
	 * Every known rendition per display URL, keyed by the chosen (best) URL.
	 * Lets the download function resolve the true original regardless of what
	 * the grid displayed, and lets the grid pick a small variant.
	 */
	variants: Map<string, MediaVariant[]>;
}

// ─── Cache Types ──────────────────────────────────────────────────

export interface CachedMediaEntry {
	blob: Blob;
	type: string;
	timestamp?: number;
	post?: TumblrPost;
}

export interface CachedBlobResult {
	url: string;
	type: string;
}

export interface CacheProgress {
	done: number;
	total: number;
}
