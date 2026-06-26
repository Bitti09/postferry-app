<script lang="ts">
	import { getCachedBlobUrl, downloadAndCacheMedia } from "$lib/stores/db";
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
		if (url) {
			let isSubscribed = true;
			localUrl = null;
			
			// Always check if we have it locally first!
			getCachedBlobUrl(url).then(cached => {
				if (isSubscribed && cached) {
					localUrl = cached.url;
				} else if (isSubscribed && $settings.autoCacheMedia) {
					console.log(`[Auto-Cache] Dispatching background fetch for: ${url}`);
					// Not cached, but user wants to auto-cache. Background fetch it!
					downloadAndCacheMedia(url).then(result => {
						if (isSubscribed && result) {
							console.log(`[Auto-Cache] Successfully stored in Storage Bucket: ${url}`);
							localUrl = result.url;
						} else if (isSubscribed) {
							console.warn(`[Auto-Cache] Failed to fetch or store media: ${url}`);
						}
					});
				}
			});
			return () => { isSubscribed = false; };
		}
	});
	$effect(() => {
		if (posterUrl) {
			let isSubscribed = true;
			localPosterUrl = null;
			getCachedBlobUrl(posterUrl).then(cached => {
				if (isSubscribed && cached) {
					localPosterUrl = cached.url;
				} else if (isSubscribed && $settings.autoCacheMedia) {
					console.log(`[Auto-Cache] Dispatching background fetch for poster: ${posterUrl}`);
					downloadAndCacheMedia(posterUrl).then(result => {
						if (isSubscribed && result) {
							console.log(`[Auto-Cache] Successfully stored poster: ${posterUrl}`);
							localPosterUrl = result.url;
						}
					});
				}
			});
			return () => { isSubscribed = false; };
		}
	});
</script>

{#if type === 'video' || type === 'video/mp4'}
	<!-- svelte-ignore a11y_media_has_caption -->
	<video src={srcUrl} poster={resolvedPosterUrl} class={className} {style} controls preload="metadata"></video>
{:else}
	<img src={srcUrl} {alt} class={className} {style} loading="lazy" />
{/if}
