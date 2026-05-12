<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	let { hasMore = true, loading = false, onload } = $props<{ hasMore?: boolean, loading?: boolean, onload?: () => void }>();

	let observer: IntersectionObserver;
	let element: HTMLElement;
	let isIntersecting = $state(false);

	$effect(() => {
		if (!element) return;
		
		observer = new IntersectionObserver((entries) => {
			isIntersecting = entries[0].isIntersecting;
		}, { rootMargin: '400px' });

		observer.observe(element);
		
		return () => {
			observer.disconnect();
		};
	});

	$effect(() => {
		if (isIntersecting && hasMore && !loading) {
			onload?.();
		}
	});
</script>

<div bind:this={element} class="h-10 w-full flex items-center justify-center py-4">
	{#if loading}
		<span class="loading loading-spinner loading-md text-primary"></span>
	{:else if !hasMore}
		<p class="text-sm text-gray-500">No more posts to load.</p>
	{/if}
</div>
