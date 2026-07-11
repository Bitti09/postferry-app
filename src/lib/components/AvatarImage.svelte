<script lang="ts">
	import { settings } from "$lib/stores/settings";
	import { getCachedAvatar } from "$lib/stores/db";

	let { blogName, size = 64, class: className = '' } = $props<{
		blogName: string;
		size?: number;
		class?: string;
	}>();

	let avatarUrl = $state('');

	$effect(() => {
		if (!blogName) return;
		avatarUrl = `https://api.tumblr.com/v2/blog/${blogName}/avatar/${size}`;
		
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
