<script lang="ts">
	import { PlayCircle, X, ChevronLeft, ChevronRight, Loader2, Maximize2, Minimize2 } from 'lucide-svelte';
	import { getAllMediaUrls, getCachedBlobUrl } from '$lib/stores/db';
	import { onMount, tick } from 'svelte';

	let { 
		active = $bindable(false), 
		posts = [], 
		onReachEnd = async () => {} 
	} = $props<{ 
		active?: boolean, 
		posts: any[], 
		onReachEnd?: () => Promise<void> 
	}>();

	type FlatMedia = {
		url: string;
		isVideo: boolean;
		post: any;
		indexInPost: number;
		totalInPost: number;
		displayUrl?: string; // Cache blob if available
	};

	// Instant synchronous flattening
	let flatMedia = $derived(posts.flatMap(extractMedia));
	let blobMap = $state<Record<string, string>>({});

	// Extract and flatten media from a post
	function extractMedia(post: any): FlatMedia[] {
		const urls = getAllMediaUrls(post);
		return urls.map((url, i) => {
			const isVideo = post.type === 'video' || url.includes('.mp4') || (post.content && post.content.some((b: any) => b.type === 'video' && (b.url === url || b.media?.[0]?.url === url)));
			return {
				url,
				isVideo,
				post,
				indexInPost: i + 1,
				totalInPost: urls.length
			};
		});
	}
	
	let currentIndex = $state(0);
	let isFetchingMore = $state(false);
	let loadCount = $state(0);
	let fitToScreen = $state(true);

	let currentItem = $derived(flatMedia[currentIndex]);

	// Background blob resolver
	$effect(() => {
		if (active) {
			flatMedia.forEach(async (m) => {
				if (!blobMap[m.url]) {
					const cached = await getCachedBlobUrl(m.url);
					if (cached) {
						blobMap[m.url] = cached.url;
					}
				}
			});
		}
	});

	// Check if we need more posts
	$effect(() => {
		if (active && flatMedia.length > 0) {
			checkPrefetch();
		}
	});

	// Reset index when opened (optional, maybe we want to keep it?)
	$effect(() => {
		if (!active) {
			currentIndex = 0;
		}
	});

	async function next() {
		if (currentIndex < flatMedia.length - 1) {
			currentIndex++;
			checkPrefetch();
		}
	}

	function prev() {
		if (currentIndex > 0) {
			currentIndex--;
		}
	}

	function close() {
		active = false;
	}

	async function checkPrefetch() {
		if (currentIndex >= flatMedia.length - 5 && !isFetchingMore) {
			isFetchingMore = true;
			loadCount++;
			try {
				await onReachEnd();
			} catch (e) {
				console.error('Prefetch failed:', e);
			} finally {
				isFetchingMore = false;
			}
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!active) return;
		if (e.key === 'Escape') close();
		if (e.key === 'ArrowRight') next();
		if (e.key === 'ArrowLeft') prev();
	}

	// Swipe handling
	let touchStartX = 0;
	let touchEndX = 0;
	function handleTouchStart(e: TouchEvent) {
		touchStartX = e.changedTouches[0].screenX;
	}
	function handleTouchEnd(e: TouchEvent) {
		touchEndX = e.changedTouches[0].screenX;
		if (touchStartX - touchEndX > 50) next();
		if (touchEndX - touchStartX > 50) prev();
	}

</script>

<svelte:window onkeydown={handleKeydown} />

{#if active}
	<div 
		role="presentation"
		class="fixed inset-0 z-[100] flex flex-col bg-black/95 backdrop-blur-md"
		ontouchstart={handleTouchStart}
		ontouchend={handleTouchEnd}
	>
		<!-- Top Bar -->
		<div class="absolute top-0 left-0 right-0 p-4 flex items-center justify-between z-50 bg-gradient-to-b from-black/80 to-transparent">
			<div class="flex flex-col">
				{#if currentItem}
					<span class="text-white font-bold text-lg drop-shadow-md">
						{currentItem.post.blog_name}
					</span>
					<div class="flex items-center gap-2 text-sm text-gray-300 drop-shadow-md">
						{#if currentItem.totalInPost > 1}
							<span class="bg-white/20 px-2 py-0.5 rounded text-xs text-white">
								{currentItem.indexInPost}/{currentItem.totalInPost}
							</span>
						{/if}
						<span class="truncate max-w-[200px] sm:max-w-md">{currentItem.post.summary || ''}</span>
						{#if loadCount > 0}
							<span class="text-[10px] text-gray-500 ml-2 bg-black/40 px-1 rounded border border-white/5">
								Prefetches: {loadCount}
							</span>
						{/if}
					</div>
				{/if}
			</div>

			<div class="flex items-center gap-4">
				<button 
					class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/25 border border-white/10 text-white text-xs transition-all"
					onclick={(e) => { e.stopPropagation(); fitToScreen = !fitToScreen; }}
				>
					{#if fitToScreen}
						<Minimize2 size={16} /> Original Size
					{:else}
						<Maximize2 size={16} /> Fit to Screen
					{/if}
				</button>

				<button 
					class="w-10 h-10 rounded-full bg-white/10 hover:bg-white/25 border border-white/10 text-white flex items-center justify-center transition-all"
					onclick={(e) => { e.stopPropagation(); close(); }}
					aria-label="Close"
				><X size={24} /></button>
			</div>
		</div>

		<!-- Navigation Overlays -->
		<button 
			class="absolute left-0 top-0 bottom-0 w-1/6 md:w-32 z-40 flex items-center justify-start pl-4 text-white/50 hover:text-white transition-colors"
			onclick={(e) => { e.stopPropagation(); prev(); }}
			disabled={currentIndex === 0}
			aria-label="Previous"
		>
			<ChevronLeft size={48} class="drop-shadow-lg {currentIndex === 0 ? 'opacity-0' : 'opacity-100'}" />
		</button>

		<button 
			class="absolute right-0 top-0 bottom-0 w-1/6 md:w-32 z-40 flex items-center justify-end pr-4 text-white/50 hover:text-white transition-colors"
			onclick={(e) => { e.stopPropagation(); next(); }}
			disabled={currentIndex === flatMedia.length - 1 && !isFetchingMore}
			aria-label="Next"
		>
			{#if currentIndex === flatMedia.length - 1 && isFetchingMore}
				<Loader2 size={48} class="animate-spin drop-shadow-lg" />
			{:else}
				<ChevronRight size={48} class="drop-shadow-lg {currentIndex === flatMedia.length - 1 ? 'opacity-0' : 'opacity-100'}" />
			{/if}
		</button>

		<!-- Media Display -->
		<div class="flex-1 flex items-center justify-center relative p-4 pb-12 mt-16 overflow-hidden min-h-0" onclick={close} role="presentation">
			{#if flatMedia.length === 0}
				<Loader2 size={48} class="text-white animate-spin" />
			{:else if currentItem}
				{#if currentItem.isVideo}
					<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
					<video 
						controls 
						class="{fitToScreen ? 'w-full h-full' : 'max-w-full max-h-full'} object-contain drop-shadow-2xl rounded-lg" 
						onclick={(e) => e.stopPropagation()}
						src={blobMap[currentItem.url] || currentItem.url}
					></video>
				{:else}
					<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
					<img 
						src={blobMap[currentItem.url] || currentItem.url} 
						alt="Slideshow Media" 
						class="{fitToScreen ? 'w-full h-full' : 'max-w-full max-h-full'} object-contain drop-shadow-2xl rounded-lg select-none" 
						onclick={(e) => e.stopPropagation()} 
						loading="eager"
					/>
				{/if}
			{/if}
		</div>

		<!-- Bottom Progress Bar -->
		<div class="absolute bottom-0 left-0 right-0 h-1 bg-white/10 z-50">
			<div 
				class="h-full bg-primary transition-all duration-300"
				style="width: {flatMedia.length > 0 ? ((currentIndex + 1) / flatMedia.length) * 100 : 0}%"
			></div>
		</div>
	</div>
{/if}
