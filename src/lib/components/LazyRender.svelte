<script lang="ts">
	import { onMount } from 'svelte';

	let { children, height = 'aspect-[3/4]' } = $props<{ 
		children: any, 
		height?: string 
	}>();

	let container = $state<HTMLElement | null>(null);
	let isVisible = $state(false);

	onMount(() => {
		if (!container) return;

		const observer = new IntersectionObserver(
			(entries) => {
				isVisible = entries[0].isIntersecting;
			},
			{
				rootMargin: '1000px' // Pre-render when within 1000px
			}
		);

		observer.observe(container);

		return () => {
			observer.disconnect();
		};
	});
</script>

<div bind:this={container} class="w-full">
	{#if isVisible}
		{@render children()}
	{:else}
		<div class="w-full {height} bg-gray-900/50 rounded-xl animate-pulse"></div>
	{/if}
</div>
