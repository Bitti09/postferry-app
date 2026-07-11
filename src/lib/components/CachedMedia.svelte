<script lang="ts">
	import { settings } from "$lib/stores/settings";
	import { getCachedBlobUrl, downloadAndCacheMedia } from "$lib/stores/db";

	let { url, type = 'image', alt = '', class: className = '', style = '', posterUrl = '', onUnavailable } = $props<{
		url: string;
		type?: string;
		alt?: string;
		class?: string;
		style?: string;
		posterUrl?: string;
		onUnavailable?: () => void;
	}>();

	const toProxyUrl = (u: string) => `/api/media/proxy?url=${encodeURIComponent(u)}`;
	const canProxy = (u: unknown) =>
		typeof u === 'string' &&
		u.length > 0 &&
		!u.startsWith('blob:') &&
		!u.startsWith('data:') &&
		!u.startsWith('/api/media/proxy?url=');

	let localUrl = $state<string | null>(null);
	let forceProxy = $state(false);
	let mediaUnavailable = $state(false);
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
		forceProxy = false;
		mediaUnavailable = false;
		
		// Fast path: if URL is a blob: URL or data: URL, use directly
		if (url.startsWith('blob:') || url.startsWith('data:')) {
			if (isSubscribed) localUrl = url;
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
		forcePosterProxy = false;
		
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

{#if type === 'video' || type === 'video/mp4'}
	<!-- svelte-ignore a11y_media_has_caption -->
	{#if mediaUnavailable}
		<div class={className} {style}>
			<div class="w-full h-full bg-gray-800/70 flex items-center justify-center text-gray-300 text-xs font-semibold text-center px-3">
				Media unavailable
			</div>
		</div>
	{:else}
		<video
			src={srcUrl}
			poster={resolvedPosterUrl}
			class={className}
			{style}
			controls
			preload="metadata"
			onerror={() => {
				if (!forceProxy && canProxy(srcUrl)) {
					forceProxy = true;
				} else {
					mediaUnavailable = true;
				}
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
				if (!forceProxy && canProxy(srcUrl)) {
					forceProxy = true;
				} else {
					mediaUnavailable = true;
				}
			}}
		/>
	{/if}
{/if}
