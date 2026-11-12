<script lang="ts">
	import { X, ChevronLeft, ChevronRight, Loader2, Maximize2, Minimize2 } from '@lucide/svelte';
	import { extractMedia as extractPostMedia } from '#lib/mediaUrls';
	import { onDestroy as svelteOnDestroy } from 'svelte';
	import CachedMedia from './CachedMedia.svelte';
	import { upscaleImage } from '#lib/upscaleImage';
	import { postId } from '#lib/types';

	const toProxyUrl = (u: string) => `/api/media/proxy?url=${encodeURIComponent(u)}`;

	function renderCanvas(node: HTMLCanvasElement, srcCanvas: HTMLCanvasElement | null): { update: (s: HTMLCanvasElement | null) => void } {
		function draw(src: HTMLCanvasElement | null) {
			if (!src) return;
			if (node.width !== src.width || node.height !== src.height) {
				node.width = src.width;
				node.height = src.height;
			}
			const ctx = node.getContext('2d')!;
			ctx.clearRect(0, 0, node.width, node.height);
			ctx.drawImage(src, 0, 0);
		}
		draw(srcCanvas);
		return { update: draw };
	}

	let {
		active = $bindable(false),
		posts = [],
		onReachEnd = async () => {},
		activePostId = $bindable<string | number | null>(null),
		startPostId = null,
		startMediaUrl = null
	}: {
		active?: boolean,
		posts: any[],
		onReachEnd?: () => Promise<void>,
		activePostId?: string | number | null,
		startPostId?: string | number | null,
		startMediaUrl?: string | null
	} = $props();

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
		const nextPostIds: string[] = posts.map((post: any) => postId(post));
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

	const PREFETCH_RADIUS = 12;

	// Extract and flatten media from a post
	function extractMedia(post: any): FlatMedia[] {
		const media = extractPostMedia(post);
		const videoUrls = new Set(media.videos);
		const posterUrls = new Set(media.posters);
		const hasVideos = videoUrls.size > 0;
		const filmstripUrls = new Set(media.filmstrips || []);
		const urls = media.urls.filter((url) => !(hasVideos && posterUrls.has(url)) && !filmstripUrls.has(url));
		return urls.map((url, i) => {
			const isVideo =
				videoUrls.has(url) ||
				/\.(mp4|webm|m3u8)(\?|$)/i.test(url) ||
				(post.content && post.content.some((b: any) => {
					if (b.type !== 'video') return false;
					if (b.url === url) return true;
					const mediaList = Array.isArray(b.media) ? b.media : b.media ? [b.media] : [];
					return mediaList.some((m: any) => m?.url === url);
				}));
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
	let upscaledCanvas = $state<HTMLCanvasElement | null>(null);
	let upscaleLoading = $state(false);
	let upscalingForUrl = $state<string | null>(null);

	let currentItem = $derived(flatMedia[currentIndex]);
	let attributionUrl = $derived(currentItem?.post?.source_url ?? '');
	let attributionLabel = $derived.by(() => {
		if (!attributionUrl) return '';
		const title = currentItem?.post?.source_title;
		if (title) return title;
		try {
			return new URL(attributionUrl).hostname;
		} catch {
			return attributionUrl;
		}
	});

	$effect(() => {
		const item = currentItem;
		const doFit = fitToScreen;
		const isGif = item?.url.toLowerCase().includes('.gif');
		if (!item || item.isVideo || isGif || !doFit) {
			upscaledCanvas = null;
			upscalingForUrl = null;
			upscaleLoading = false;
			return;
		}
		if (upscalingForUrl === item.url) return;
		upscalingForUrl = item.url;
		upscaleLoading = true;
		const url = item.url;
		const proxyUrl = toProxyUrl(url);
		const vw = window.innerWidth - 32;
		const vh = window.innerHeight - 128;
		upscaleImage(proxyUrl, vw, vh)
			.then((result) => {
				if (upscalingForUrl === url) {
					upscaledCanvas = result ? result.canvas : null;
					upscaleLoading = false;
				}
			})
			.catch(() => {
				if (upscalingForUrl === url) {
					upscaledCanvas = null;
					upscaleLoading = false;
				}
			});
	});

	$effect(() => {
		if (active && currentItem && currentItem.post) {
			activePostId = postId(currentItem.post);
		}
	});

	// Check if we need more posts
	$effect(() => {
		if (active && flatMedia.length > 0) {
			checkPrefetch();
		}
	});

	// Reset index when opened
	$effect(() => {
		if (!active) {
			currentIndex = 0;
		}
	});

	// Start from a specific post (and optionally media URL) when requested by the parent.
	let lastAppliedStartPostId = $state<string | number | null>(null);
	let lastAppliedStartMediaUrl = $state<string | null>(null);
	$effect(() => {
		if (!active) {
			lastAppliedStartPostId = null;
			lastAppliedStartMediaUrl = null;
			return;
		}

		const postChanged = startPostId != null && startPostId !== lastAppliedStartPostId;
		const urlChanged = startMediaUrl != null && startMediaUrl !== lastAppliedStartMediaUrl;
		if (startPostId == null && startMediaUrl == null) return;
		if (!postChanged && !urlChanged) return;

		let targetIndex = -1;
		if (startMediaUrl && startPostId != null) {
			targetIndex = flatMedia.findIndex(
				(item) => postId(item.post) === String(startPostId) && item.url === startMediaUrl
			);
		}
		if (targetIndex < 0 && startMediaUrl) {
			const idx = flatMedia.findIndex((item) => item.url === startMediaUrl);
			if (idx >= 0) targetIndex = idx;
		}
		if (targetIndex < 0 && startPostId != null) {
			targetIndex = flatMedia.findIndex((item) => postId(item.post) === String(startPostId));
		}
		if (targetIndex >= 0) {
			currentIndex = targetIndex;
		}

		lastAppliedStartPostId = startPostId;
		lastAppliedStartMediaUrl = startMediaUrl;
	});

	async function next() {
		if (currentIndex < flatMedia.length - 1) { currentIndex++; checkPrefetch(); }
	}

	function prev() {
		if (currentIndex > 0) currentIndex--;
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
					<CachedMedia
						url={currentItem.url}
						type="video/mp4"
						class="w-full h-full object-contain drop-shadow-2xl rounded-lg"
						autoplay
						post={currentItem.post}
					/>
				{:else if fitToScreen && upscaleLoading}
					<div class="flex items-center justify-center">
						<Loader2 size={36} class="text-white animate-spin" />
					</div>
				{:else if fitToScreen && upscaledCanvas}
					<canvas
						use:renderCanvas={upscaledCanvas}
						class="max-w-full max-h-full object-contain drop-shadow-2xl rounded-lg"
					></canvas>
				{:else}
					<img
						src={toProxyUrl(currentItem.url)}
						alt=""
						class="{fitToScreen ? 'w-full h-full' : 'max-w-full max-h-full'} object-contain drop-shadow-2xl rounded-lg"
						style={fitToScreen ? '' : 'width: auto; height: auto; display: block;'}
					/>
				{/if}
			{/if}

			{#if currentItem}
				<div
					class="absolute bottom-6 left-1/2 z-30 max-w-[70%] -translate-x-1/2 rounded-lg bg-black/60 px-3 py-1.5 text-[11px] text-gray-200 backdrop-blur"
					onclick={(e) => e.stopPropagation()}
					role="presentation"
				>
					<span class="font-semibold text-white">{currentItem.post?.blog_name ?? ''}</span>
					{#if attributionLabel}
						<span class="text-gray-400"> · via </span>
						<a
							href={attributionUrl}
							target="_blank"
							rel="noopener noreferrer"
							class="underline decoration-gray-500 underline-offset-2 hover:text-white"
							onclick={(e) => e.stopPropagation()}
						>{attributionLabel}</a>
					{/if}
				</div>
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
