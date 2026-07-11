<script lang="ts">
	import { settings } from "$lib/stores/settings";
	import { getCachedBlobUrl, downloadAndCacheMedia } from "$lib/stores/db";

	let { url, type = 'image', alt = '', class: className = '', style = '', posterUrl = '', thumbnailMode = false, onUnavailable } = $props<{
		url: string;
		type?: string;
		alt?: string;
		class?: string;
		style?: string;
		posterUrl?: string;
		thumbnailMode?: boolean;
		onUnavailable?: () => void;
	}>();

	const toProxyUrl = (u: string) => `/api/media/proxy?url=${encodeURIComponent(u)}`;
	const canProxy = (u: unknown) =>
		typeof u === 'string' &&
		u.length > 0 &&
		!u.startsWith('blob:') &&
		!u.startsWith('data:') &&
		!u.startsWith('/api/media/proxy?url=');
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

	let localUrl = $state<string | null>(null);
	let forceProxy = $state(false);
	let mediaUnavailable = $state(false);
	let triedProxy = $state(false);
	let triedDirect = $state(false);
	let srcUrl = $derived.by(() => {
		const base = localUrl || url;
		return forceProxy && canProxy(base) ? toProxyUrl(base) : base;
	});

	let localPosterUrl = $state<string | null>(null);
	let forcePosterProxy = $state(false);
	let resolvedPosterUrl = $derived.by(() => {
		if (!posterUrl) return undefined;
		const base = localPosterUrl || posterUrl;
		return forcePosterProxy && canProxy(base) ? toProxyUrl(base) : base;
	});

	$effect(() => {
		if (!url) return;
		
		let isSubscribed = true;
		localUrl = null;
		forceProxy = canProxy(url);
		triedProxy = forceProxy;
		triedDirect = isVideoMedia ? true : !forceProxy;
		mediaUnavailable = false;
		
		// Fast path: if URL is a blob: URL or data: URL, use directly
		if (url.startsWith('blob:') || url.startsWith('data:')) {
			if (isSubscribed) localUrl = url;
			triedDirect = true;
			triedProxy = false;
			return () => { isSubscribed = false; };
		}

		// Keep video src stable to avoid first-frame/control flicker from async src swaps.
		// We still allow proxy/direct fallback through onerror, but skip late cache replacement.
		if (isVideoMedia) {
			return () => { isSubscribed = false; };
		}
		
		// For network URLs, we defer to the browser cache (HTTP cache) which is much faster
		// Only check/download IndexedDB if autoCacheMedia is enabled.
		if ($settings.autoCacheMedia) {
			getCachedBlobUrl(url).then(async cached => {
				if (!isSubscribed) return;
				if (cached?.url) {
					localUrl = cached.url;
					return;
				}

				const downloaded = await downloadAndCacheMedia(url);
				if (isSubscribed && downloaded?.url) {
					localUrl = downloaded.url;
				}
			});
		}
		
		return () => { isSubscribed = false; };
	});

	$effect(() => {
		if (!posterUrl) return;
		
		let isSubscribed = true;
		localPosterUrl = null;
		forcePosterProxy = isVideoMedia && canProxy(posterUrl);

		// Keep video poster stable to avoid flicker from async poster URL swapping.
		if (isVideoMedia) {
			return () => { isSubscribed = false; };
		}
		
		if ($settings.autoCacheMedia) {
			getCachedBlobUrl(posterUrl).then(async cached => {
				if (!isSubscribed) return;
				if (cached?.url) {
					localPosterUrl = cached.url;
					return;
				}

				const downloaded = await downloadAndCacheMedia(posterUrl);
				if (isSubscribed && downloaded?.url) {
					localPosterUrl = downloaded.url;
				}
			});
		}
		
		return () => { isSubscribed = false; };
	});

	$effect(() => {
		if (mediaUnavailable) {
			onUnavailable?.();
		}
	});
</script>

{#if isVideoMedia}
	<!-- svelte-ignore a11y_media_has_caption -->
	{#if mediaUnavailable}
		<div class={className} {style}>
			<div class="w-full h-full bg-gray-800/70 flex items-center justify-center text-gray-300 text-xs font-semibold text-center px-3">
				Media unavailable
			</div>
		</div>
	{:else if thumbnailMode}
		{#if resolvedPosterUrl || posterUrl}
			<img
				src={resolvedPosterUrl || posterUrl}
				{alt}
				class={className}
				{style}
				loading="lazy"
				decoding="async"
				onerror={() => {
					if (!forcePosterProxy && canProxy(posterUrl)) {
						forcePosterProxy = true;
						return;
					}
					mediaUnavailable = true;
				}}
			/>
		{:else}
			<div class={className} {style}>
				<div class="w-full h-full bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center text-gray-300 text-xs font-semibold text-center px-3">
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
			preload="metadata"
			onerror={() => {
				if (!triedProxy && canProxy(url)) {
					forceProxy = true;
					triedProxy = true;
					return;
				}
				mediaUnavailable = true;
			}}
		></video>
	{/if}
{:else}
	{#if mediaUnavailable}
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
			onerror={() => {
				if (!triedProxy && canProxy(url)) {
					forceProxy = true;
					triedProxy = true;
					return;
				}
				if (!triedDirect) {
					forceProxy = false;
					triedDirect = true;
					return;
				}
				mediaUnavailable = true;
			}}
		/>
	{/if}
{/if}
