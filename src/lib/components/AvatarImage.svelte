<script lang="ts">
	import { settings } from "#lib/stores/settings";
	import { getCachedAvatar } from '#lib/cache';

	let { blogName, size = 64, class: className = '' }: {
		blogName: string;
		size?: number;
		class?: string;
	} = $props();

	let avatarUrl = $state('');

	$effect(() => {
		if (!blogName) return;
		avatarUrl = `/api/avatar?blog=${encodeURIComponent(blogName)}&size=${size}`;
		
		// Fast path: if autoCacheMedia is off, use direct URL (HTTP cache handles it)
		if (!$settings.autoCacheMedia) return;
		
		let isSubscribed = true;
		getCachedAvatar(blogName, size).then(url => {
			if (isSubscribed) avatarUrl = url;
		});
		return () => { isSubscribed = false; };
	});
</script>

<img src={avatarUrl} class={className} alt={blogName} loading="lazy" decoding="async" />
