<script lang="ts">
	import CachedMedia from './CachedMedia.svelte';
	import type { TumblrPost } from '#lib/types';

	/**
	 * Fallback renderer for posts the API still returns in the legacy format
	 * (and for NPF posts whose content could not be converted). The v2 docs
	 * explicitly keep legacy `body`, `photos`, `video_url`, `player` and
	 * `caption` fields alongside NPF `content`.
	 */
	let { post }: { post: TumblrPost } = $props();

	let photos = $derived(post.photos ?? []);
	let embeddedPlayers = $derived(post.player ?? []);
</script>

<div class="space-y-6">
	{#if post.body}
		<div class="prose prose-invert max-w-none text-gray-200 [&_a]:text-primary [&_img]:rounded-lg">
			{@html post.body}
		</div>
	{/if}

	{#if photos.length > 0}
		<div class="space-y-4">
			{#each photos as photo, index}
				{@const best = photo.original_size ?? photo.alt_sizes?.[0]}
				{#if best?.url}
					<figure class="space-y-2">
						<CachedMedia
							url={best.url}
							type="image"
							alt={post.summary || `Photo ${index + 1}`}
							class="w-full h-auto rounded-xl"
							{post}
						/>
						{#if post.caption && index === photos.length - 1}
							<figcaption class="text-sm text-gray-300">{@html post.caption}</figcaption>
						{/if}
					</figure>
				{/if}
			{/each}
		</div>
	{:else if post.video_url}
		<!-- svelte-ignore a11y_media_has_caption -->
		<video
			class="w-full rounded-xl"
			controls
			preload="metadata"
			src={post.video_url}
			poster={post.thumbnail_url}
		></video>
	{:else if post.caption}
		<div class="prose prose-invert max-w-none text-gray-200">
			{@html post.caption}
		</div>
	{/if}

	{#if embeddedPlayers.length > 0}
		<div class="space-y-4">
			{#each embeddedPlayers as player}
				{#if player.embed_code}
					<div class="overflow-hidden rounded-xl">{@html player.embed_code}</div>
				{/if}
			{/each}
		</div>
	{/if}
</div>
