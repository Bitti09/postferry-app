<script lang="ts">
	/**
	 * Renders only the first frame of a GIF (or any image) on a canvas,
	 * preventing animation in grid views. Detection is based on Content-Type.
	 */
	import { onMount } from 'svelte';

	let { src = '', alt = '', class: className = '', type = '' } = $props<{ src: string; alt?: string; class?: string; type?: string }>();

	let canvas = $state<HTMLCanvasElement | null>(null);
	let isGif = $state(false);
	let loaded = $state(false);

	async function detectGif() {
		// If type is already provided (e.g. from NPF metadata)
		if (type) {
			isGif = type === 'image/gif';
			return;
		}

		// Sniff the URL
		try {
			// For blob URLs, fetch is instant and local
			// For remote URLs, we use HEAD to avoid downloading the whole thing twice
			const response = await fetch(src, { method: src.startsWith('blob:') ? 'GET' : 'HEAD' });
			const contentType = response.headers.get('content-type');
			isGif = contentType === 'image/gif';
		} catch (e) {
			// Fallback to extension if request fails (CORS, etc.)
			isGif = src.toLowerCase().includes('.gif');
		}
	}

	onMount(async () => {
		await detectGif();
		
		if (!isGif) {
			loaded = true;
			return;
		}

		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.onload = () => {
			if (!canvas) return;
			canvas.width = img.naturalWidth;
			canvas.height = img.naturalHeight;
			const ctx = canvas.getContext('2d');
			ctx?.drawImage(img, 0, 0);
			loaded = true;
		};
		img.src = src;
	});
</script>

{#if isGif}
	<canvas bind:this={canvas} class="{className} {loaded ? 'opacity-100' : 'opacity-0'}" style="object-fit: cover; transition: opacity 0.3s;"></canvas>
{:else}
	<img {src} {alt} class="{className} {loaded ? 'opacity-100' : 'opacity-0'}" style="transition: opacity 0.3s;" loading="lazy" onload={() => loaded = true} />
{/if}
