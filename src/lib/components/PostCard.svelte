<script lang="ts">
	import { PlayCircle, Download, CheckCircle2, Loader2, Image as ImageIcon } from 'lucide-svelte';
	import { getAllMediaUrls, getPrimaryMediaUrl, getVideoUrls, getImageUrls, getPosterUrls } from '$lib/mediaUrls';
	import { settings } from '$lib/stores/settings';
	import { downloadAndCacheMedia } from '$lib/stores/mediaCache';
	import CachedMedia from './CachedMedia.svelte';
	import type { TumblrPost } from '$lib/types';

	let {
		post,
		mode = 'normal',
		onclickOverride,
		preCheckedUrls = []
	} = $props<{
		post: TumblrPost;
		mode?: 'normal' | 'cache';
		onclickOverride?: () => void;
		preCheckedUrls?: string[];
	}>();

	let mediaInfo = $derived.by(() => {
		const allUrls = getAllMediaUrls(post);
		const videos = getVideoUrls(post);
		const images = getImageUrls(post);
		const posters = getPosterUrls(post);
		const rawPrimary = getPrimaryMediaUrl(post);

		let primary = rawPrimary;
		let primaryType: 'image' | 'video' = 'image';
		let posterUrl = '';

		if (videos.length > 0) {
			const thumb = images[0] || posters[0];
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
			previewUrl: posterUrl || primary || images[0] || '',
			allUrls,
			isVideo: videos.length > 0,
			isImage: images.length > 0,
		};
	});

	let nsfw = $derived(post.is_nsfw);
	let mediaFailed = $state(false);

	$effect(() => {
		// Reset per card/post render cycle.
		post.id;
		mediaFailed = false;
	});

	let cachedUrls = $state<Set<string>>(new Set());

	$effect(() => {
		post.id;
		preCheckedUrls;
		cachedUrls = new Set(preCheckedUrls);
	});

	let isCached = $derived(mediaInfo.allUrls.length === 0 || mediaInfo.allUrls.every(u => cachedUrls.has(u)));
	let isDownloading = $state(false);

	async function downloadPostMedia() {
			if (isDownloading || isCached) return;
			isDownloading = true;

			if (mediaInfo.allUrls.length === 0) {
				isDownloading = false;
				return;
			}

			downloadAndCacheMedia && Promise.all(mediaInfo.allUrls.map(async (url: string) => {
				const res = await downloadAndCacheMedia(url);
				if (res?.url) {
					const next = new Set(cachedUrls);
					next.add(url);
					cachedUrls = next;
				}
			}))
				.then(() => {
					isDownloading = false;
				})
				.catch(() => { isDownloading = false; });
		}

	$effect(() => {
		const autoCache = $settings.autoCacheMedia;
		const urls = mediaInfo.allUrls;
		if (!autoCache || urls.length === 0 || isCached || isDownloading) return;

		let cancelled = false;
		isDownloading = true;

		(async () => {
			try {
				for (const url of urls) {
					if (cancelled || cachedUrls.has(url)) continue;
					const res = await downloadAndCacheMedia(url);
					if (cancelled) break;
					if (res?.url) {
						const next = new Set(cachedUrls);
						next.add(url);
						cachedUrls = next;
					}
				}
			} finally {
				if (!cancelled) {
					isDownloading = false;
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	});
</script>

<svelte:element
	this={mode === 'cache' ? 'div' : 'a'}
	role={mode === 'cache' ? 'button' : undefined}
	tabindex={mode === 'cache' ? 0 : undefined}
	href={mode === 'normal' ? `/post/${post.blog_name}/${post.id_string || post.id}` : undefined}
	onkeydown={(e: KeyboardEvent) => {
		if (mode === 'cache' && (e.key === 'Enter' || e.key === ' ')) {
			e.preventDefault();
			onclickOverride?.();
		}
	}}
	onclick={(e: MouseEvent) => {
		if (mode === 'cache') {
			e.preventDefault();
			onclickOverride?.();
		}
	}}
	class="group relative block overflow-hidden rounded-xl bg-gray-900 aspect-3/4 shadow-lg transition-transform hover:-translate-y-1 hover:shadow-xl hover:shadow-cyan-900/20 {mode === 'cache' ? 'cursor-zoom-in text-left' : ''}"
>
	{#if mediaInfo.primary && !mediaFailed}
		{#if mediaInfo.isVideo}
			{#if mediaInfo.previewUrl}
				<img
					src={mediaInfo.previewUrl}
					alt={post.summary || 'Tumblr Post video preview'}
					class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
					loading="lazy"
					decoding="async"
					onerror={() => { mediaFailed = true; }}
				/>
			{:else}
				<div class="flex h-full w-full items-center justify-center bg-gray-800 p-4">
					<p class="text-sm text-gray-400">Video</p>
				</div>
			{/if}
		{:else}
			<CachedMedia
				url={mediaInfo.primary}
				type={mediaInfo.primaryType}
				posterUrl={mediaInfo.posterUrl}
				thumbnailMode={true}
				alt={post.summary || 'Tumblr Post'}
				class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
				onUnavailable={() => { mediaFailed = true; }}
			/>
		{/if}
	{:else}
		<div class="flex h-full w-full items-center justify-center bg-gray-800 p-4">
			<p class="text-sm text-gray-400 line-clamp-6">{@html post.summary || post.body || 'Post without media'}</p>
		</div>
	{/if}

	<!-- Overlays -->
	<div class="absolute inset-0 bg-linear-to-t from-black/80 via-black/20 to-transparent opacity-80 transition-opacity group-hover:opacity-100"></div>


	<!-- Top Left Icons -->
	<div class="absolute top-3 left-3 flex items-center gap-2 z-10">
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

	<!-- NSFW Badge -->
	{#if nsfw}
		<div class="absolute top-3 right-3 rounded bg-red-600 px-2 py-1 text-xs font-bold text-white shadow z-10">
			NSFW
		</div>
	{/if}

	<!-- Bottom Info -->
	<div class="absolute bottom-0 left-0 right-0 p-4 z-10">
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<span 
			class="text-sm font-semibold text-white truncate hover:text-primary transition-colors block relative z-30 cursor-pointer"
			onclick={(e) => {
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
			
			{#if !$settings.autoCacheMedia && !isCached && !isDownloading && mediaInfo.allUrls.length > 0}
				<button
					class="flex items-center gap-1 hover:text-white transition-colors p-1 shrink-0 whitespace-nowrap"
					onclick={(e) => { e.preventDefault(); e.stopPropagation(); downloadPostMedia(); }}
					title="Save offline"
				>
					<Download size={12} /> <span class="font-bold">Save offline</span>
				</button>
			{:else if !$settings.autoCacheMedia && isDownloading}
				<div class="flex items-center gap-1 p-1 text-primary shrink-0 whitespace-nowrap">
					<Loader2 size={12} class="animate-spin" /> <span class="font-bold">Downloading</span>
				</div>
			{/if}
		</div>
	</div>
</svelte:element>
