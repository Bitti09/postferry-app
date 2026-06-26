<script lang="ts">
	import { getCachedAvatar } from '$lib/stores/db';

	let { blogName, size = 64, class: className = '' } = $props<{
		blogName: string;
		size?: number;
		class?: string;
	}>();

	let avatarUrl = $state(`https://api.tumblr.com/v2/blog/${blogName}/avatar/${size}`);

	$effect(() => {
		if (blogName) {
			let isSubscribed = true;
			getCachedAvatar(blogName, size).then(url => {
				if (isSubscribed) avatarUrl = url;
			});
			return () => { isSubscribed = false; };
		}
	});
</script>

<img src={avatarUrl} class={className} alt={blogName} loading="lazy" />
