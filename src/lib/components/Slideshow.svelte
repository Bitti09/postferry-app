<script lang="ts">
	import { X, ChevronLeft, ChevronRight, Loader2, Maximize2, Minimize2 } from 'lucide-svelte';
	import { extractMedia as extractPostMedia } from '$lib/mediaUrls';
	import { onDestroy } from 'svelte';
	import { bulkIsMediaCached, getCachedBlobUrl } from '$lib/stores/db';

	let { 
		active = $bindable(false), 
		posts = [], 
		onReachEnd = async () => {},
		activePostId = $bindable<string | number | null>(null),
		startPostId = null
	} = $props<{ 
		active?: boolean, 
		posts: any[], 
		onReachEnd?: () => Promise<void>,
		activePostId?: string | number | null,
		startPostId?: string | number | null
	}>();

	type FlatMedia = {
		url: string;
		isVideo: boolean;
		post: any;
		indexInPost: number;
		totalInPost: number;
	};

	// Incremental flattening - append only new posts, don't re-flatten all on every load
	let flatMedia = $state<FlatMedia[]>([]);
	let postCount = $state(0);
	let previousPostIds: string[] = [];
	$effect(() => {
		const nextPostIds: string[] = posts.map((post: any) => String(post?.id ?? ''));
		const unchangedPrefix =
			previousPostIds.length <= nextPostIds.length &&
			previousPostIds.every((id: string, index: number) => nextPostIds[index] === id);

		if (nextPostIds.length > postCount && unchangedPrefix) {
			const newPosts = posts.slice(postCount);
			flatMedia.push(...newPosts.flatMap(extractMedia));
			postCount = nextPostIds.length;
			previousPostIds = nextPostIds;
			return;
		}

		const didChange =
			nextPostIds.length !== previousPostIds.length ||
			nextPostIds.some((id: string, index: number) => id !== previousPostIds[index]);

		if (didChange) {
			// posts array was replaced/reordered (e.g. filter change)
			flatMedia = posts.flatMap(extractMedia);
			postCount = nextPostIds.length;
			previousPostIds = nextPostIds;
		}
	});
	let blobMap = $state<Record<string, string>>({});
	let checkedCacheStatusUrls = new Set<string>();
	let inFlightBlobUrls = new Set<string>();
	let createdBlobObjectUrls = new Set<string>();

	const PREFETCH_RADIUS = 12;
	const BLOB_FETCH_CONCURRENCY = 6;

	// Extract and flatten media from a post
	function extractMedia(post: any): FlatMedia[] {
		const media = extractPostMedia(post);
		const videoUrls = new Set(media.videos);
		const posterUrls = new Set(media.posters);
		const hasVideos = videoUrls.size > 0;
		const urls = media.urls.filter((url) => !(hasVideos && posterUrls.has(url)));
		return urls.map((url, i) => {
			const isVideo =
				videoUrls.has(url) ||
				/\.(mp4|webm|m3u8)(\?|$)/i.test(url) ||
				(post.content && post.content.some((b: any) => b.type === 'video' && (b.url === url || b.media?.some((m: any) => m?.url === url))));
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

	$effect(() => {
		if (active && currentItem && currentItem.post) {
			activePostId = currentItem.post.id;
		}
	});

	// Resolve cached blobs around the current slide to avoid expensive full-list scans.
	$effect(() => {
		if (!active || flatMedia.length === 0) {
			return;
		}
		resolveBlobsAroundCurrent();
	});

	function getPrefetchWindowUrls(): string[] {
		if (flatMedia.length === 0) return [];
		const start = Math.max(0, currentIndex - PREFETCH_RADIUS);
		const end = Math.min(flatMedia.length, currentIndex + PREFETCH_RADIUS + 1);
		const urls: string[] = [];
		for (let i = start; i < end; i++) {
			const url = flatMedia[i]?.url;
			if (url) urls.push(url);
		}
		return urls;
	}

	async function resolveBlobsAroundCurrent() {
		const candidateUrls = getPrefetchWindowUrls().filter(
			(url) => !checkedCacheStatusUrls.has(url) && !inFlightBlobUrls.has(url) && !blobMap[url]
		);
		if (candidateUrls.length === 0) return;

		const cachedSet = await bulkIsMediaCached(candidateUrls);
		for (const url of candidateUrls) {
			checkedCacheStatusUrls.add(url);
		}

		const queue = candidateUrls.filter((url) => cachedSet.has(url));
		if (queue.length === 0) return;

		for (const url of queue) {
			inFlightBlobUrls.add(url);
		}

		async function worker() {
			while (queue.length > 0) {
				const url = queue.shift();
				if (!url) continue;
				try {
					const cached = await getCachedBlobUrl(url);
					if (cached?.url) {
						blobMap[url] = cached.url;
						createdBlobObjectUrls.add(cached.url);
					}
				} finally {
					inFlightBlobUrls.delete(url);
				}
			}
		}

		void Promise.all(
			Array.from(
				{ length: Math.min(BLOB_FETCH_CONCURRENCY, queue.length) },
				() => worker()
			)
		);
	}

	function resetBlobState() {
		for (const objectUrl of createdBlobObjectUrls) {
			URL.revokeObjectURL(objectUrl);
		}
		createdBlobObjectUrls = new Set();
		checkedCacheStatusUrls = new Set();
		inFlightBlobUrls = new Set();
		blobMap = {};
	}

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
			resetBlobState();
		}
	});

	// Start from a specific post when requested by the parent.
	let lastAppliedStartPostId = $state<string | number | null>(null);
	$effect(() => {
		if (!active) {
			lastAppliedStartPostId = null;
			return;
		}

		if (startPostId == null || startPostId === lastAppliedStartPostId) {
			return;
		}

		const targetIndex = flatMedia.findIndex((item) => String(item.post?.id) === String(startPostId));
		if (targetIndex >= 0) {
			currentIndex = targetIndex;
		}

		lastAppliedStartPostId = startPostId;
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

	onDestroy(() => {
		resetBlobState();
	});

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
		class="fixed inset-0 z-100 flex flex-col bg-black/95 backdrop-blur-md"
		ontouchstart={handleTouchStart}
		ontouchend={handleTouchEnd}
	>
		<!-- Top Bar -->
		<div class="absolute top-0 left-0 right-0 p-4 flex items-center justify-between z-50 bg-linear-to-b from-black/80 to-transparent">
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
						<span class="truncate max-w-50 sm:max-w-md">{currentItem.post.summary || ''}</span>
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
		<div class="flex-1 flex items-center justify-center relative p-4 pb-12 mt-16 overflow-hidden min-h-0" onclick={(e) => {
			if (e.target === e.currentTarget) close();
		}} role="presentation">
			{#if flatMedia.length === 0}
				<Loader2 size={48} class="text-white animate-spin" />
			{:else if currentItem}
				{#if currentItem.isVideo}
					<video 
						controls 
						class="{fitToScreen ? 'w-full h-full' : 'max-w-full max-h-full'} object-contain drop-shadow-2xl rounded-lg" 
						src={blobMap[currentItem.url] || currentItem.url}
					>
						<track kind="captions" />
					</video>
				{:else}
					<img 
						src={blobMap[currentItem.url] || currentItem.url} 
						alt="Slideshow Media" 
						class="{fitToScreen ? 'w-full h-full' : 'max-w-full max-h-full'} object-contain drop-shadow-2xl rounded-lg select-none" 
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
