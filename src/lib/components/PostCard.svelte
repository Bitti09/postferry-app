<script lang="ts">
	import { PlayCircle, Download, CheckCircle2, Loader2, Image as ImageIcon } from '@lucide/svelte';
	import { extractMedia, variantForDisplay, getVideoUrls } from '$lib/mediaUrls';
	import { downloadHighestRes } from '$lib/download';
	import { settings } from '$lib/stores/settings';
	import { requestMediaDownload, cancelQueuedDownload } from '$lib/stores/downloads';
	import { cachedMediaUrls } from '../mediaCacheStatus.svelte.ts';
	import CachedMedia from './CachedMedia.svelte';
	import type { TumblrPost } from '$lib/types';

	let {
		post,
		mode = 'normal',
		onMediaClick,
		autoCacheEnabled = true
	} = $props<{
		post: TumblrPost;
		mode?: 'normal' | 'cache';
		onMediaClick?: (post: TumblrPost, mediaUrl?: string) => void;
		autoCacheEnabled?: boolean;
	}>();

	let mediaInfo = $derived.by(() => {
		const extraction = extractMedia(post);
		const allUrls = extraction.urls;
		const videos = extraction.videos;
		const images = extraction.images;
		const posters = extraction.posters;
		const rawPrimary = extraction.primary;

		let primary = rawPrimary;
		let primaryType: 'image' | 'video' = 'image';
		let posterUrl = '';

		if (videos.length > 0) {
			const isMultiMedia = videos.length + images.length > 1;
			const thumb = isMultiMedia ? (posters[0] || images[0]) : (images[0] || posters[0]);
			if (thumb) {
				primary = thumb;
				primaryType = 'image';
			} else {
				primary = videos[0] || rawPrimary;
				primaryType = 'video';
				posterUrl = posters[0] || images[0] || '';
			}
		}

		return {
			primary,
			primaryType,
			posterUrl,
			// Grid cards are a few hundred px wide — load a sized variant, not
			// the original. Falls back to the URL itself when it has no size
			// encoding (variantForDisplay is identity there).
			displayUrl: primary ? variantForDisplay(primary, 640) : '',
			previewUrl: (posterUrl || primary || images[0] || '') && variantForDisplay(posterUrl || primary || images[0] || '', 640),
			allUrls,
			isVideo: videos.length > 0,
			isImage: images.length > 0,
		};
	});

	let nsfw = $derived(post.is_nsfw);
	let mediaFailed = $state(false);

	$effect(() => {
		post.id;
		mediaFailed = false;
	});

	let isCached = $derived(mediaInfo.allUrls.length === 0 || mediaInfo.allUrls.every(u => cachedMediaUrls.has(u)));
	let postDetailHref = $derived(`/post/${post.blog_name}/${post.id_string || post.id}`);
	const DETAIL_ZONE_HEIGHT_PX = 132;

	function openPostDetail() {
		window.location.href = postDetailHref;
	}

	function handleMediaClick(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		const targetMediaUrl = mediaInfo.isVideo
			? (getVideoUrls(post)[0] || mediaInfo.primary)
			: mediaInfo.primary;
		
		if (onMediaClick) {
			onMediaClick(post, targetMediaUrl);
			return;
		}
		if (mode !== 'cache') {
			openPostDetail();
		}
	}

	function handleTextClick(e: MouseEvent) {
		if (mode === 'cache') return;
		e.preventDefault();
		e.stopPropagation();
		openPostDetail();
	}

	function downloadPostMedia() {
		if (isCached) return;

		const postMeta = {
			postId: post.id,
			blogName: post.blog_name,
			timestamp: post.timestamp,
			post
		};

		mediaInfo.allUrls.forEach((url) => {
			if (!cachedMediaUrls.has(url)) {
				requestMediaDownload(url, postMeta, 'visible');
			}
		});
	}

	/** Save the highest-resolution rendition of the primary media to disk. */
	async function saveOriginalToDisk() {
		const extraction = extractMedia(post);
		const target = mediaInfo.isVideo
			? (getVideoUrls(post)[0] || mediaInfo.primary)
			: mediaInfo.primary;
		if (!target) return;
		await downloadHighestRes(target, post, extraction);
	}

	let visible = $state(false);

	$effect(() => {
		const autoCache = $settings.autoCacheMedia && autoCacheEnabled && mode !== 'cache';
		const urls = mediaInfo.allUrls;
		if (!autoCache || urls.length === 0) return;

		// Tracked: re-runs when any of this post's urls enters the offline
		// cache, so newly visible cards pick up in-flight completions.
		const pending = urls.filter((url) => !cachedMediaUrls.has(url));
		if (pending.length === 0) return;

		const postMeta = {
			postId: post.id,
			blogName: post.blog_name,
			timestamp: post.timestamp,
			post
		};

		for (const url of pending) {
			requestMediaDownload(url, postMeta, 'visible');
		}
	});

	// Cancel still-queued work when the card unmounts (scrolled away) — keeps
	// the bulk/visible lanes from fetching media nobody looks at anymore.
	$effect(() => {
		const urls = mediaInfo.allUrls;
		return () => {
			for (const url of urls) cancelQueuedDownload(url);
		};
	});
</script>

<svelte:element
	this={'div'}
	role={mode === 'cache' ? 'button' : undefined}
	tabindex={mode === 'cache' ? 0 : undefined}
	onkeydown={(e: KeyboardEvent) => {
		if (mode === 'cache' && (e.key === 'Enter' || e.key === ' ')) {
			e.preventDefault();
			handleMediaClick(e as unknown as MouseEvent);
		}
	}}
	onclick={(e: MouseEvent) => {
		if (mode === 'cache') {
			const target = e.target as HTMLElement;
			if (target.closest('.postcard-text-area')) {
				return;
			}
			handleMediaClick(e);
		}
	}}
	class="group relative block overflow-hidden rounded-xl bg-gray-900 aspect-3/4 shadow-lg transition-transform hover:-translate-y-1 hover:shadow-xl hover:shadow-cyan-900/20 {mode === 'cache' ? 'cursor-zoom-in text-left' : ''}"
>
	{#if mediaInfo.primary && !mediaFailed}
		{#if mediaInfo.isVideo}
			{#if mediaInfo.previewUrl}
				<CachedMedia
					url={mediaInfo.previewUrl}
					type="image"
					thumbnailMode={true}
					autoCacheEnabled={autoCacheEnabled}
					alt={post.summary || 'Tumblr Post video preview'}
					class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
					onUnavailable={() => { mediaFailed = true; }}
					post={post}
				/>
			{:else}
				<div class="flex h-full w-full items-center justify-center bg-gray-800 p-4">
					<p class="text-sm text-gray-400">Video</p>
				</div>
			{/if}
		{:else}
		<CachedMedia
			url={mediaInfo.displayUrl || mediaInfo.primary}
			type={mediaInfo.primaryType}
			posterUrl={mediaInfo.posterUrl}
			thumbnailMode={true}
			autoCacheEnabled={autoCacheEnabled}
			alt={post.summary || 'Tumblr Post'}
			class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
			onUnavailable={() => { mediaFailed = true; }}
			post={post}
		/>
		{/if}
	{:else}
		<div class="flex h-full w-full items-center justify-center bg-gray-800 p-4">
			<p class="text-sm text-gray-400 line-clamp-6">{@html post.summary || post.body || 'Post without media'}</p>
		</div>
	{/if}

	<!-- Overlays -->
	<div class="absolute inset-0 pointer-events-none bg-linear-to-t from-black/80 via-black/20 to-transparent opacity-80 transition-opacity group-hover:opacity-100"></div>

	{#if mode === 'normal'}
		<button
			type="button"
			class="absolute inset-x-0 top-0 z-20 cursor-zoom-in"
			style={`bottom: ${DETAIL_ZONE_HEIGHT_PX}px;`}
			aria-label="Open slideshow"
			onclick={handleMediaClick}
		></button>
	{/if}


	<!-- Top Left Icons -->
	<div class="absolute top-3 left-3 flex items-center gap-2 z-10 pointer-events-none">
		<!-- Video Icon -->
		{#if mediaInfo.isVideo}
			<div class="text-white/80 drop-shadow-md">
				<PlayCircle size={24} />
			</div>
		{:else if mediaInfo.isImage}
			<div class="text-white/80 drop-shadow-md">
				<ImageIcon size={24} />
			</div>
		{/if}
		
		<!-- Cached indicator badge -->
		{#if isCached}
			<div class="w-6 h-6 rounded-full bg-green-500/90 flex items-center justify-center shadow-lg">
				<CheckCircle2 size={14} class="text-white" />
			</div>
		{/if}
	</div>

	<!-- Save-to-disk button -->
	<button
		type="button"
		class="absolute top-3 right-11 z-10 rounded-full bg-black/60 p-2 text-white/90 opacity-0 transition-opacity hover:bg-black/80 hover:text-white group-hover:opacity-100 pointer-events-auto"
		aria-label="Download highest resolution"
		title="Download highest resolution"
		onclick={(e) => { e.stopPropagation(); void saveOriginalToDisk(); }}
	>
		<Download size={16} />
	</button>

	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		class="postcard-text-area absolute bottom-0 left-0 right-0 p-4 z-30 cursor-pointer"
		style={mode === 'normal' ? `min-height: ${DETAIL_ZONE_HEIGHT_PX}px;` : undefined}
		role={mode === 'normal' ? 'button' : undefined}
		tabindex={mode === 'normal' ? 0 : undefined}
		onkeydown={(e: KeyboardEvent) => {
			if (mode !== 'normal') return;
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				openPostDetail();
			}
		}}
		onclick={handleTextClick}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<span 
			class="text-sm font-semibold text-white truncate hover:text-primary transition-colors block relative z-30 cursor-pointer"
			onclick={(e) => {
				if (mode === 'cache') return;
				e.preventDefault();
				e.stopPropagation();
				window.location.href = `/blog/${post.blog_name}`;
			}}
		>
			{post.blog_name}
		</span>
		<p class="text-xs text-gray-300 line-clamp-2 mt-1">{post.summary}</p>

		<div class="mt-3 flex items-center justify-between gap-1 text-xs text-gray-400 relative z-30">
			<span class="truncate">{post.note_count || 0} notes</span>
			
			{#if !$settings.autoCacheMedia && !isCached && mediaInfo.allUrls.length > 0}
				<button
					class="flex items-center gap-1 hover:text-white transition-colors p-1 shrink-0 whitespace-nowrap"
					onclick={(e) => { e.preventDefault(); e.stopPropagation(); downloadPostMedia(); }}
					title="Save offline"
				>
					<Download size={12} /> <span class="font-bold">Save offline</span>
				</button>
			{/if}
		</div>
	</div>
</svelte:element>
