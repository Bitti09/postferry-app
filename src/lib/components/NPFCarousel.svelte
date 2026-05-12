<script lang="ts">
	let { images = [] } = $props<{ images: any[] }>();
	
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
	{@const imgUrl = block.media?.[0]?.url || block.url}
	{#if imgUrl}
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div class="rounded-xl overflow-hidden shadow-2xl bg-gray-800 my-4 border border-gray-800 cursor-zoom-in" onclick={() => openLightbox(imgUrl)}>
			<img 
				src={imgUrl} 
				alt="Post content" 
				class="w-full max-h-[90vh] object-contain block mx-auto"
				loading="lazy"
			/>
			{#if block.caption}
				<p class="p-4 text-sm text-gray-400 italic bg-gray-900/80 border-t border-gray-800">{@html block.caption}</p>
			{/if}
		</div>
	{/if}
{:else if images.length > 1}
	<div class="flex flex-col my-4 rounded-2xl overflow-hidden shadow-2xl border border-gray-800 bg-gray-900">
		<!-- Image Stage -->
		<div class="relative bg-black w-full flex items-center justify-center group cursor-zoom-in" style="height: 80vh; max-height: 80vh;">
			{#each images as block, i}
				{@const imgUrl = block.media?.[0]?.url || block.url}
				{#if imgUrl}
					<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_img_redundant_alt -->
					<img 
						src={imgUrl} 
						alt={`Image ${i + 1}`} 
						class="max-h-full object-contain w-full"
						style="display: {i === currentSlide ? 'block' : 'none'};"
						loading={i === 0 ? "eager" : "lazy"}
						onclick={() => openLightbox(imgUrl)}
					/>
				{/if}
			{/each}

			<button 
				class="absolute left-4 btn btn-circle btn-sm btn-neutral opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 border-gray-700 z-10" 
				onclick={(e) => { e.stopPropagation(); prevSlide(); }}
				aria-label="Previous image"
			>❮</button>
			
			<button 
				class="absolute right-4 btn btn-circle btn-sm btn-neutral opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 border-gray-700 z-10" 
				onclick={(e) => { e.stopPropagation(); nextSlide(); }}
				aria-label="Next image"
			>❯</button>
		</div>

		<!-- Clickable Tabs (Indicators) -->
		<div class="flex flex-wrap justify-center gap-3 p-4 bg-gray-900 border-t border-gray-800">
			{#each images as _, i}
				<button 
					class="group relative flex flex-col items-center"
					onclick={() => currentSlide = i}
				>
					<span class="text-[10px] font-black mb-1 transition-colors {i === currentSlide ? 'text-primary' : 'text-gray-600'}">
						{String(i + 1).padStart(2, '0')}
					</span>
					<div class="w-12 h-1.5 rounded-full transition-all duration-300 {i === currentSlide ? 'bg-primary shadow-[0_0_10px_rgba(var(--p),0.5)]' : 'bg-gray-800 group-hover:bg-gray-700'}"></div>
				</button>
			{/each}
		</div>
		
		<!-- Caption Area -->
		{#if images[currentSlide]?.caption}
			<div class="p-4 bg-gray-950/50 border-t border-gray-800">
				<p class="text-sm text-gray-400 italic">
					{@html images[currentSlide].caption}
				</p>
			</div>
		{/if}
	</div>
{/if}

<!-- Fullscreen Lightbox -->
{#if lightboxUrl}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div 
		class="fixed inset-0 z-[9999] bg-black/95 backdrop-blur-sm flex items-center justify-center"
		onclick={closeLightbox}
	>
		<img 
			src={lightboxUrl} 
			alt="Fullscreen" 
			class="w-screen h-screen object-contain select-none"
			onclick={(e) => e.stopPropagation()}
		/>

		<!-- Prev / Next in lightbox -->
		{#if images.length > 1}
			<button 
				class="absolute left-6 btn btn-circle btn-neutral bg-black/50 border-gray-700 text-white"
				onclick={(e) => { e.stopPropagation(); prevSlide(); const b = images[currentSlide]; lightboxUrl = b.media?.[0]?.url || b.url; }}
				aria-label="Previous"
			>❮</button>
			<button 
				class="absolute right-6 btn btn-circle btn-neutral bg-black/50 border-gray-700 text-white"
				onclick={(e) => { e.stopPropagation(); nextSlide(); const b = images[currentSlide]; lightboxUrl = b.media?.[0]?.url || b.url; }}
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
