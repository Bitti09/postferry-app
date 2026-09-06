<script lang="ts">
	let { images = [] } = $props<{ images: any[] }>();
	
	const toProxyUrl = (u: string) => `/api/media/proxy?url=${encodeURIComponent(u)}`;
	const proxied = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u) ? toProxyUrl(u) : u);

	let currentSlide = $state(0);
	let lightboxUrl = $state<string | null>(null);

	function nextSlide() {
		currentSlide = (currentSlide + 1) % images.length;
	}

	function prevSlide() {
		currentSlide = (currentSlide - 1 + images.length) % images.length;
	}

	function openLightbox(url: string) {
		lightboxUrl = url;
	}

	function closeLightbox() {
		lightboxUrl = null;
	}

	function onKeydown(e: KeyboardEvent) {
		if (!lightboxUrl) return;
		if (e.key === 'Escape') closeLightbox();
		if (e.key === 'ArrowRight') nextSlide();
		if (e.key === 'ArrowLeft') prevSlide();
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#if images.length === 1}
	{@const block = images[0]}
	{@const mediaArray = Array.isArray(block.media) ? block.media : (block.media ? [block.media] : [])}
	{@const originalImg = mediaArray.find((m: any) => m.has_original_dimensions)}
	{@const imgUrl = originalImg ? originalImg.url : (mediaArray[0]?.url || block.url)}
	{#if imgUrl}
		<button type="button" class="rounded-xl overflow-hidden shadow-2xl bg-gray-800 my-4 cursor-zoom-in text-left w-full" onclick={() => openLightbox(imgUrl)}>
			<img 
				src={proxied(imgUrl)} 
				alt="Post content" 
				class="w-full max-h-[90vh] object-contain block mx-auto"
				loading="lazy"
			/>
			{#if block.caption}
				<p class="p-4 text-sm text-gray-400 italic bg-gray-900/80 border-t border-gray-800">{@html block.caption}</p>
			{/if}
		</button>
	{/if}
{:else if images.length > 1}
	<div class="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-2 my-4">
		{#each images as block, i}
			{@const mediaArray = Array.isArray(block.media) ? block.media : (block.media ? [block.media] : [])}
			{@const originalImg = mediaArray.find((m: any) => m.has_original_dimensions)}
			{@const imgUrl = originalImg ? originalImg.url : (mediaArray[0]?.url || block.url)}
			{#if imgUrl}
				<button type="button"
					class="rounded-xl overflow-hidden shadow-lg bg-gray-900 cursor-zoom-in group aspect-[4/5] sm:aspect-square relative text-left" 
					onclick={() => { currentSlide = i; openLightbox(imgUrl); }}
				>
					<img 
						src={proxied(imgUrl)} 
						alt={`Image ${i + 1}`} 
						class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
						loading={i < 4 ? "eager" : "lazy"}
					/>
					{#if block.caption}
						<div class="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-black/90 to-transparent">
							<p class="text-xs text-white line-clamp-2">{@html block.caption}</p>
						</div>
					{/if}
				</button>
			{/if}
		{/each}
	</div>
{/if}

<!-- Fullscreen Lightbox -->
{#if lightboxUrl}
	<div class="fixed inset-0 z-[9999] bg-black/95 backdrop-blur-sm flex items-center justify-center">
		<button
			type="button"
			class="absolute inset-0"
			onclick={closeLightbox}
			aria-label="Close lightbox"
		></button>
		<img 
			src={proxied(lightboxUrl)} 
			alt="Fullscreen" 
			class="w-screen h-screen object-contain select-none"
		/>

		<!-- Prev / Next in lightbox -->
		{#if images.length > 1}
			<button 
				class="absolute left-6 btn btn-circle btn-neutral bg-black/50 border-gray-700 text-white"
				onclick={(e) => { e.stopPropagation(); prevSlide(); const b = images[currentSlide]; const m = Array.isArray(b.media) ? b.media : (b.media ? [b.media] : []); const o = m.find((x: any) => x.has_original_dimensions); lightboxUrl = o ? o.url : (m[0]?.url || b.url); }}
				aria-label="Previous"
			>❮</button>
			<button 
				class="absolute right-6 btn btn-circle btn-neutral bg-black/50 border-gray-700 text-white"
				onclick={(e) => { e.stopPropagation(); nextSlide(); const b = images[currentSlide]; const m = Array.isArray(b.media) ? b.media : (b.media ? [b.media] : []); const o = m.find((x: any) => x.has_original_dimensions); lightboxUrl = o ? o.url : (m[0]?.url || b.url); }}
				aria-label="Next"
			>❯</button>
			<div class="absolute bottom-6 text-white/50 text-xs font-bold tracking-widest uppercase">
				{currentSlide + 1} / {images.length}
			</div>
		{/if}

		<button 
			class="absolute top-6 right-6 w-12 h-12 rounded-full bg-white/10 hover:bg-white/25 backdrop-blur-sm border border-white/10 text-white text-2xl font-bold flex items-center justify-center transition-all"
			onclick={closeLightbox}
			aria-label="Close lightbox"
		>✕</button>
	</div>
{/if}
