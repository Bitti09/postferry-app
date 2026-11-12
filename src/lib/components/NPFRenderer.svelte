<script lang="ts">
	import { PlayCircle } from "@lucide/svelte";
	import NPFCarousel from "./NPFCarousel.svelte";
	import NPFText from "./NPFText.svelte";
	import NPFAsk from "./NPFAsk.svelte";
	import NPFRenderer from "./NPFRenderer.svelte";
	import CachedMedia from "./CachedMedia.svelte";

	let {
		content = [],
		layout = [],
		useGrid = false,
		fillHeight = false,
	}: {
		content: any[];
		layout?: any[];
		useGrid?: boolean;
		fillHeight?: boolean;
	} = $props();

	const toProxyUrl = (u: string) => `/api/media/proxy?url=${encodeURIComponent(u)}`;
	/** NPF media is a single object for video/audio and an array for images. */
	function firstMedia(value: any): any | null {
		if (!value) return null;
		return Array.isArray(value) ? value[0] ?? null : value;
	}
	const proxied = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u) ? toProxyUrl(u) : u);

	let lightboxUrl = $state<string | null>(null);

	function openLightbox(url: string) {
		lightboxUrl = url;
	}

	function closeLightbox() {
		lightboxUrl = null;
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === "Escape") closeLightbox();
	}

	let displayContent = $derived.by(() => {
		const result = [];
		const handledIndices = new Set<number>();

		// 1. Process Asks
		const askLayout = layout?.find((l: any) => l.type === "ask");
		if (askLayout && askLayout.blocks) {
			result.push({
				type: "ask_group",
				blocks: askLayout.blocks
					.map((idx: number) => content[idx])
					.filter(Boolean),
				attribution: askLayout.attribution,
			});
			askLayout.blocks.forEach((idx: number) => handledIndices.add(idx));
		}

		// 2. Process Rows (Grid)
		const rowsLayout = useGrid
			? layout?.find((l: any) => l.type === "rows")
			: null;
		const rowDisplay = rowsLayout?.display || [];
		// Pre-build O(1) row lookup map to avoid .find() inside the loop
		const rowMap = new Map<number, any>();
		for (const r of rowDisplay) {
			for (const idx of (r.blocks || [])) {
				rowMap.set(idx, r);
			}
		}

		let currentCarousel: { type: string; images: any[] } | null = null;
		let currentList: { type: string; subtype: string; blocks: any[] } | null = null;

		for (let i = 0; i < content.length; i++) {
			if (handledIndices.has(i)) continue;

			const block = content[i];
			if (!block) continue;

			// Handle List Item grouping
			const isListItem = block.type === 'text' && (block.subtype === 'ordered-list-item' || block.subtype === 'unordered-list-item');
			
			if (isListItem) {
				if (currentCarousel) { result.push(currentCarousel); currentCarousel = null; }
				
				if (!currentList || currentList.subtype !== block.subtype) {
					if (currentList) result.push(currentList);
					currentList = { type: 'list_group', subtype: block.subtype, blocks: [block] };
				} else {
					currentList.blocks.push(block);
				}
				continue;
			} else if (currentList) {
				result.push(currentList);
				currentList = null;
			}

			// Check if this block is part of a Row (O(1) lookup via pre-built map)
			const rowForIndex = rowMap.get(i);
			if (rowForIndex) {
				if (currentCarousel) { result.push(currentCarousel); currentCarousel = null; }

				if (rowForIndex.blocks[0] === i) {
					result.push({
						type: "row",
						blocks: rowForIndex.blocks
							.map((idx: number) => content[idx])
							.filter(Boolean),
					});
				}
				handledIndices.add(i);
				continue;
			}

			// Not part of Ask or Row or List.
			// If Carousel mode is active (useGrid is false), group consecutive images.
			if (!useGrid && block.type === "image") {
				if (!currentCarousel) {
					currentCarousel = { type: "carousel", images: [block] };
				} else {
					currentCarousel.images.push(block);
				}
			} else {
				if (currentCarousel) {
					result.push(currentCarousel);
					currentCarousel = null;
				}
				result.push(block);
			}
		}

		if (currentCarousel) result.push(currentCarousel);
		if (currentList) result.push(currentList);

		return result;
	});
</script>

<div
	class="npf-content {fillHeight
		? 'h-full flex flex-col min-h-0'
		: 'space-y-6'}"
>
	{#each displayContent as block}
		{#if block.type === "ask_group"}
			<NPFAsk blocks={block.blocks} attribution={block.attribution} />
		{:else if block.type === "row"}
			<div class="flex flex-row flex-wrap gap-2 my-6">
				{#each block.blocks as subblock}
					{@const imgUrl = subblock.type === 'image' ? (firstMedia(subblock.media)?.url || subblock.url) : null}
					<div class="min-w-0 flex-1">
						{#if subblock.type === "image"}
							{#if imgUrl}
								<button
									type="button"
									class="select-none rounded-2xl overflow-hidden relative group flex items-center justify-center transition-transform duration-300 hover:scale-[1.02] cursor-zoom-in"
									style="max-height: 40dvh;"
									onclick={() => openLightbox(imgUrl)}
								>
									<CachedMedia
										url={imgUrl}
										alt="Post content"
										class="select-none block object-contain w-full h-full"
										style="max-height: 40dvh;"
									/>
									{#if subblock.attribution}
										<a
											href={subblock.attribution.url}
											target="_blank"
											rel="noopener noreferrer"
											class="absolute top-2 left-2 px-2 py-1 bg-black/60 backdrop-blur text-white text-[10px] font-bold uppercase rounded hover:bg-primary transition-colors opacity-0 group-hover:opacity-100"
											onclick={(e) => e.stopPropagation()}
										>
											Via {subblock.attribution
												.app_name ||
												subblock.attribution.blog
													?.name ||
												"Link"}
										</a>
									{/if}
								</button>
							{/if}
						{:else}
							<NPFRenderer content={[subblock]} />
						{/if}
					</div>
				{/each}
			</div>
		{:else if block.type === "carousel"}
			<NPFCarousel images={block.images} />
		{:else if block.type === "list_group"}
			<svelte:element 
				this={block.subtype === 'ordered-list-item' ? 'ol' : 'ul'} 
				class="px-8 my-6 space-y-2 {block.subtype === 'ordered-list-item' ? 'list-decimal' : 'list-disc'} text-gray-200 text-lg"
			>
				{#each block.blocks as item}
					<li style="margin-left: {(item.indent_level || 0) * 20}px">
						<NPFText text={item.text} formatting={item.formatting} />
					</li>
				{/each}
			</svelte:element>
		{:else if block.type === "text"}
			<div class="px-4 md:px-8 max-w-3xl mx-auto w-full" style="margin-left: {(block.indent_level || 0) * 20}px">
				{#if block.subtype === "heading1"}
					<h1 class="text-4xl font-black text-white mb-4 tracking-tight leading-tight">
						<NPFText text={block.text} formatting={block.formatting} />
					</h1>
				{:else if block.subtype === "heading2"}
					<h2 class="text-3xl font-black text-white mb-3 tracking-tight leading-tight">
						<NPFText text={block.text} formatting={block.formatting} />
					</h2>
				{:else if block.subtype === "quirky"}
					<p class="text-3xl font-serif italic text-primary/90 mb-4 quirky-text leading-relaxed">
						<NPFText text={block.text} formatting={block.formatting} />
					</p>
				{:else if block.subtype === "quote"}
					<blockquote class="border-l-4 border-primary pl-6 italic text-gray-200 text-2xl my-8 bg-gray-900/40 py-4 rounded-r-2xl shadow-inner font-serif">
						<NPFText text={block.text} formatting={block.formatting} />
					</blockquote>
				{:else if block.subtype === "indented"}
					<div class="border-l-2 border-gray-800 pl-6 my-4 italic text-gray-400 text-lg">
						<NPFText text={block.text} formatting={block.formatting} />
					</div>
				{:else if block.subtype === "chat"}
					<div class="font-mono bg-gray-800/40 p-5 rounded-2xl text-[15px] my-6 border border-gray-700/50 shadow-lg leading-relaxed">
						<NPFText text={block.text} formatting={block.formatting} />
					</div>
				{:else}
					<p class="text-gray-200 leading-relaxed whitespace-pre-wrap mb-5 last:mb-0 text-xl font-medium tracking-wide">
						<NPFText text={block.text} formatting={block.formatting} />
					</p>
				{/if}
			</div>
		{:else if block.type === "image"}
			{@const mediaArray = Array.isArray(block.media) ? block.media : (block.media ? [block.media] : [])}
			{@const originalImg = mediaArray.find((m: any) => m.has_original_dimensions)}
			{@const imgUrl = originalImg ? originalImg.url : (mediaArray[0]?.url || block.url)}
			{#if imgUrl}
				<div class="max-w-3xl mx-auto px-4 md:px-8 w-full">
					<button
						type="button"
						class="select-none rounded-2xl overflow-hidden relative group flex items-center justify-center mx-auto transition-transform duration-300 hover:scale-[1.02] cursor-zoom-in"
						style="max-height: 60dvh; width: 100%; aspect-ratio: auto;"
						onclick={() => openLightbox(imgUrl)}
					>
						<CachedMedia
							url={imgUrl}
							alt="Post content"
							class="select-none block object-contain w-full h-full"
							style="max-height: 60dvh;"
						/>
					{#if block.attribution}
						<a
							href={block.attribution.url}
							target="_blank"
							rel="noopener noreferrer"
							class="absolute top-4 left-4 px-3 py-1.5 bg-black/70 backdrop-blur-md text-white text-xs font-black uppercase rounded-lg hover:bg-primary transition-all opacity-0 group-hover:opacity-100 shadow-lg"
							onclick={(e) => e.stopPropagation()}
						>
							Via {block.attribution.app_name ||
								block.attribution.blog?.name ||
								"Link"}
						</a>
					{/if}
					</button>
				</div>
				{#if block.caption}
					<p
						class="px-6 py-3 text-sm text-gray-400 italic bg-gray-900/30 rounded-xl border border-gray-800 -mt-4 mb-8 mx-auto w-fit max-w-2xl text-center"
					>
						{@html block.caption}
					</p>
				{/if}
			{/if}
		{:else if block.type === "video"}
			{@const mediaArray = Array.isArray(block.media) ? block.media : (block.media ? [block.media] : [])}
			{@const originalVid = mediaArray.find((m: any) => m.has_original_dimensions)}
			{@const vidUrl = originalVid ? originalVid.url : (mediaArray[0]?.url || block.url)}
			{#if vidUrl}
				<div class="rounded-2xl overflow-hidden shadow-2xl bg-black aspect-video my-8 relative group border border-gray-800 max-h-[75dvh]">
					{#if firstMedia(block.media)?.type?.startsWith("video/") || vidUrl.includes(".mp4") || vidUrl.includes(".webm") || !block.provider || block.provider === 'tumblr'}
						<CachedMedia
							url={vidUrl}
							type={firstMedia(block.media)?.type || "video/mp4"}
							posterUrl={firstMedia(block.poster)?.url || block.thumbnail_url || ""}
							class="w-full h-full object-contain"
						/>
					{:else}
						{@const fallbackHref = block.attribution?.url || vidUrl}
						{@const fallbackHost = (() => { try { return new URL(fallbackHref).hostname; } catch { return ''; } })()}
						<a
							href={fallbackHref}
							target="_blank"
							rel="noopener noreferrer"
							class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-linear-to-br from-gray-900 to-black hover:from-gray-800 hover:to-gray-900 transition-colors group/link"
						>
							{#if firstMedia(block.poster)?.url || block.thumbnail_url}
								<CachedMedia
									url={firstMedia(block.poster)?.url || block.thumbnail_url}
									type="image"
									thumbnailMode={true}
									class="absolute inset-0 w-full h-full object-cover opacity-30 group-hover/link:opacity-40 transition-opacity"
								/>
							{/if}
							<div class="relative z-10 flex flex-col items-center gap-3 p-6 text-center max-w-md">
								<div class="w-16 h-16 rounded-full bg-primary/90 flex items-center justify-center shadow-2xl group-hover/link:scale-110 transition-transform">
									<PlayCircle size={32} />
								</div>
								<div class="space-y-1">
									<p class="text-white font-black text-lg">Watch external video</p>
									<p class="text-gray-400 text-xs font-mono uppercase tracking-widest break-all">
										{block.attribution?.app_name || fallbackHost || 'External'}
									</p>
								</div>
								<span class="text-[10px] text-gray-500 uppercase tracking-widest group-hover/link:text-primary transition-colors">
									Open in new tab →
								</span>
							</div>
						</a>
					{/if}

					{#if block.attribution}
						<div class="absolute bottom-4 left-4 right-4 flex justify-end opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
							<span class="px-3 py-1 bg-black/60 backdrop-blur rounded-lg text-[10px] text-white uppercase font-black">
								Source: {block.attribution.app_name || block.attribution.blog?.name || 'External'}
							</span>
						</div>
					{/if}
				</div>
			{/if}
		{:else if block.type === "link"}
			<a
				href={block.url}
				target="_blank"
				rel="noopener noreferrer"
				class="block p-6 bg-gray-900 rounded-2xl border border-gray-800 hover:border-primary transition-all group my-6 shadow-xl"
			>
				{#if firstMedia(block.poster)}
					<CachedMedia
						url={firstMedia(block.poster).url}
						alt=""
						class="w-full h-64 object-cover rounded-xl mb-4 shadow-lg"
					/>
				{/if}
				<h3
					class="text-xl font-black text-white group-hover:text-primary transition-colors tracking-tight"
				>
					{block.title || block.url}
				</h3>
				{#if block.description}
					<p class="text-gray-400 mt-2 line-clamp-2">
						{block.description}
					</p>
				{/if}
				<span
					class="text-xs text-gray-600 mt-4 block truncate font-mono uppercase tracking-widest"
					>{new URL(block.url).hostname}</span
				>
			</a>
		{:else if block.type === "audio"}
			<div class="p-6 bg-gray-900 rounded-3xl my-6 flex flex-wrap items-center gap-6 border border-gray-800 shadow-2xl relative group overflow-hidden">
				<div class="absolute inset-0 bg-linear-to-r from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
				<div class="p-5 bg-primary/20 rounded-2xl text-primary shadow-inner relative z-10">
					<PlayCircle size={40} />
				</div>
				<div class="flex-1 min-w-[200px] relative z-10">
					<h4 class="text-xl font-black text-white tracking-tight leading-tight">
						{block.title || "Audio Track"}
					</h4>
					{#if block.artist}
						<p class="text-sm text-primary font-black uppercase tracking-widest mt-1">
							{block.artist}
						</p>
					{/if}
				</div>
				<div class="w-full sm:w-auto relative z-10">
					{#if firstMedia(block.media)?.url}
						<audio controls src={firstMedia(block.media).url} class="w-full h-10"></audio>
					{/if}
				</div>
				
				{#if block.attribution}
					<div class="w-full text-[10px] text-gray-500 uppercase font-bold tracking-tighter mt-2 opacity-60 group-hover:opacity-100 transition-opacity">
						Via {block.attribution.app_name || block.attribution.blog?.name || 'Tumblr Audio'}
					</div>
				{/if}
			</div>
		{:else if block.type === "paywall"}
			<div class="p-8 bg-gray-900 rounded-3xl border-2 border-dashed border-gray-800 my-8 text-center">
				<div class="text-primary mb-2">🔒</div>
				<p class="text-gray-400 font-bold uppercase tracking-widest text-xs">Premium Content</p>
				<p class="text-gray-500 text-sm mt-1">This part of the post is hidden behind a paywall.</p>
			</div>
		{:else}
			<div class="p-4 bg-gray-900/50 rounded-xl border border-gray-800 my-4 text-xs text-gray-500 italic">
				Unsupported block type: {block.type}
			</div>
		{/if}
	{/each}
</div>

<!-- Fullscreen Lightbox Overlay -->
<svelte:window onkeydown={onKeydown} />
{#if lightboxUrl}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-[9999] bg-black/95 backdrop-blur-sm flex items-center justify-center"
		onclick={closeLightbox}
	>
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<img
			src={proxied(lightboxUrl)}
			alt="Fullscreen"
			class="w-dvw h-dvh object-contain select-none"
			onclick={(e) => e.stopPropagation()}
		/>
		<button
			class="absolute top-6 right-6 w-12 h-12 rounded-full bg-white/10 hover:bg-white/25 backdrop-blur-sm border border-white/10 text-white text-2xl font-bold flex items-center justify-center transition-all"
			onclick={closeLightbox}
			aria-label="Close lightbox">✕</button
		>
	</div>
{/if}
