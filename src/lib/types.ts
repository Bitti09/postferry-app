export interface TumblrAccount {
	blogName: string;
	token: string;
	secret: string;
	avatarUrl?: string;
	active: boolean;
}

export interface MediaItem {
	url: string;
	width?: number;
	height?: number;
	type?: string;
	has_original_dimensions?: boolean;
}

export interface MediaAttribution {
	app_name?: string;
	url?: string;
	blog?: {
		name?: string;
	};
}

export interface MediaBlock {
	type: 'image' | 'video' | 'audio' | 'link' | 'text' | 'paywall';
	subtype?: string;
	url?: string;
	media?: MediaItem[];
	poster?: MediaItem[];
	thumbnail_url?: string;
	caption?: string;
	text?: string;
	formatting?: FormatRange[];
	indent_level?: number;
	attribution?: MediaAttribution;
	title?: string;
	description?: string;
	artist?: string;
}

export interface FormatRange {
	start: number;
	end: number;
	type: 'bold' | 'italic' | 'strikethrough' | 'small' | 'link' | 'mention' | 'color';
	url?: string;
	hex?: string;
	blog?: {
		name?: string;
	};
}

export interface PostLayout {
	type: 'rows' | 'ask';
	blocks?: number[];
	attribution?: MediaAttribution;
	display?: Array<{ blocks: number[] }>;
}

export interface PostTrail {
	content?: MediaBlock[];
	layout?: PostLayout[];
	blog?: { name?: string };
}

export interface TumblrPost {
	id: number;
	id_string?: string;
	blog_name: string;
	timestamp: number;
	summary: string;
	body?: string;
	type: 'text' | 'photo' | 'video' | 'audio' | 'link' | 'quote' | 'chat' | 'answer';
	is_nsfw?: boolean;
	note_count?: number;
	content?: MediaBlock[];
	layout?: PostLayout[];
	trail?: PostTrail[];
	photos?: Array<{
		original_size?: MediaItem;
		alt_sizes?: MediaItem[];
	}>;
	video_url?: string;
	thumbnail_url?: string;
}

export type PostFilter =
	| 'all'
	| 'photo'
	| 'video'
	| 'audio'
	| 'text'
	| 'quote'
	| 'link'
	| 'chat'
	| 'answer';
