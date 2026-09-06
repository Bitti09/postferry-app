<script lang="ts">
	import { activeDownloads } from '$lib/stores/downloads';
	import type { TumblrPost } from '$lib/types';
	import { onMount } from 'svelte';
	import { Loader2 } from '@lucide/svelte';

	let { url, type = 'image', alt = '', class: className = '', style = '', posterUrl = '', thumbnailMode = false, autoCacheEnabled = true, onUnavailable, post, autoplay = false, cacheOnly = false } = $props<{
		url: string;
		type?: string;
		alt?: string;
		class?: string;
		style?: string;
		posterUrl?: string;
		thumbnailMode?: boolean;
		autoCacheEnabled?: boolean;
		onUnavailable?: () => void;
		/** Optional post context for persisting post metadata when auto-caching. */
		post?: TumblrPost;
		autoplay?: boolean;
		cacheOnly?: boolean;
	}>();

	const toProxyUrl = (u: string) => `/api/media/proxy?url=${encodeURIComponent(u)}`;

	const isLikelyVideo = (t: string | undefined, u: string | undefined) => {
		const mime = (t || '').toLowerCase();
		const href = (u || '').toLowerCase();
		return (
			mime === 'video' ||
			mime.startsWith('video/') ||
			href.includes('.mp4') ||
			href.includes('.webm') ||
			href.includes('.m3u8')
		);
	};
	let isVideoMedia = $derived(isLikelyVideo(type, url));

	let retryCount = $state(0);
	let mediaUnavailable = $state(false);
	let isDownloading = $derived($activeDownloads.has(url));

	let srcUrl = $derived.by(() => {
		const base = toProxyUrl(url);
		return retryCount > 0 ? `${base}&retry=${retryCount}` : base;
	});

	let resolvedPosterUrl = $derived.by(() => {
		if (!posterUrl) return undefined;
		const base = toProxyUrl(posterUrl);
		return retryCount > 0 ? `${base}&retry=${retryCount}` : base;
	});

	onMount(() => {
		const onCached = (e: Event) => {
			const detail = (e as CustomEvent).detail;
			if (detail.url === url || detail.url === posterUrl) {
				// The background download finished, reset error state and retry
				mediaUnavailable = false;
				retryCount++;
			}
		};

		const onError = (e: Event) => {
			const detail = (e as CustomEvent).detail;
			if (detail.url === url || detail.url === posterUrl) {
				mediaUnavailable = true;
			}
		};

		window.addEventListener('tmblr-media-cached', onCached);
		window.addEventListener('tmblr-media-error', onError);

		return () => {
			window.removeEventListener('tmblr-media-cached', onCached);
			window.removeEventListener('tmblr-media-error', onError);
		};
	});

	$effect(() => {
		if (mediaUnavailable) {
			onUnavailable?.();
		}
	});

	function handleError() {
		// When offline and missing from cache, the SW returns 504 and this fires.
		if (!isDownloading) {
			mediaUnavailable = true;
		}
	}
</script>

<div class="relative w-full h-full">
	{#if isVideoMedia}
		<!-- svelte-ignore a11y_media_has_caption -->
		{#if mediaUnavailable && !isDownloading}
			<div class={className} {style}>
				<div class="w-full h-full bg-gray-800/70 flex items-center justify-center text-gray-300 text-xs font-semibold text-center px-3">
					Media unavailable
				</div>
			</div>
		{:else if thumbnailMode}
			{#if resolvedPosterUrl || posterUrl}
				<img
					src={resolvedPosterUrl}
					{alt}
					class={className}
					{style}
					loading="lazy"
					decoding="async"
					onerror={handleError}
				/>
			{:else}
				<div class={className} {style}>
					<div class="w-full h-full bg-linear-to-br from-gray-800 to-gray-900 flex items-center justify-center text-gray-300 text-xs font-semibold text-center px-3">
						Video
					</div>
				</div>
			{/if}
		{:else}
		<video
			src={srcUrl}
			poster={resolvedPosterUrl}
			class={className}
			{style}
			controls
			{autoplay}
			muted={autoplay}
			playsinline
			preload="metadata"
			onerror={handleError}
		></video>
		{/if}
	{:else}
		{#if mediaUnavailable && !isDownloading}
			<div class={className} {style}>
				<div class="w-full h-full bg-gray-800/70 flex items-center justify-center text-gray-300 text-xs font-semibold text-center px-3">
					Media unavailable
				</div>
			</div>
		{:else}
			<img
				src={srcUrl}
				{alt}
				class={className}
				{style}
				loading="lazy"
				decoding="async"
				onerror={handleError}
			/>
		{/if}
	{/if}

	{#if isDownloading}
		<div class="absolute inset-0 bg-black/60 flex flex-col items-center justify-center z-10 transition-opacity">
			<Loader2 class="w-8 h-8 text-blue-500 animate-spin mb-2" />
			<span class="text-xs font-bold text-white uppercase tracking-wider">Caching...</span>
		</div>
	{/if}
</div>
