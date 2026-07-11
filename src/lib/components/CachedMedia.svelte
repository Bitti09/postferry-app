<script lang="ts">
	import { settings } from "$lib/stores/settings";

	let { url, type = 'image', alt = '', class: className = '', style = '', posterUrl = '' } = $props<{
		url: string;
		type?: string;
		alt?: string;
		class?: string;
		style?: string;
		posterUrl?: string;
	}>();

	let localUrl = $state<string | null>(null);
	let srcUrl = $derived(localUrl || url);

	let localPosterUrl = $state<string | null>(null);
	let resolvedPosterUrl = $derived(posterUrl ? (localPosterUrl || posterUrl) : undefined);

	$effect(() => {
		if (!url) return;
		
		let isSubscribed = true;
		localUrl = null;
		
		// Fast path: if URL is a blob: URL or data: URL, use directly
		if (url.startsWith('blob:') || url.startsWith('data:')) {
			if (isSubscribed) localUrl = url;
			return () => { isSubscribed = false; };
		}
		
		// For network URLs, we defer to the browser cache (HTTP cache) which is much faster
		// Only check IndexedDB if autoCacheMedia is enabled
		if ($settings.autoCacheMedia) {
			import('$lib/stores/db').then(({ getCachedBlobUrl }) => {
				getCachedBlobUrl(url).then(cached => {
					if (isSubscribed && cached) {
						localUrl = cached.url;
					}
				});
			});
		}
		
		return () => { isSubscribed = false; };
	});

	$effect(() => {
		if (!posterUrl) return;
		
		let isSubscribed = true;
		localPosterUrl = null;
		
		if ($settings.autoCacheMedia) {
			import('$lib/stores/db').then(({ getCachedBlobUrl }) => {
				getCachedBlobUrl(posterUrl).then(cached => {
					if (isSubscribed && cached) {
						localPosterUrl = cached.url;
					}
				});
			});
		}
		
		return () => { isSubscribed = false; };
	});
</script>

{#if type === 'video' || type === 'video/mp4'}
	<!-- svelte-ignore a11y_media_has_caption -->
	<video src={srcUrl} poster={resolvedPosterUrl} class={className} {style} controls preload="metadata"></video>
{:else}
	<img src={srcUrl} {alt} class={className} {style} loading="lazy" decoding="async" />
{/if}
