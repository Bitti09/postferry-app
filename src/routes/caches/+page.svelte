<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { settings } from "$lib/stores/settings";
	import {
		clearCache,
		getMediaCacheStats,
	} from "$lib/stores/db";
	import { getAllCachedMedia } from "$lib/stores/mediaCache";
	import PostCard from "$lib/components/PostCard.svelte";
	import LazyRender from "$lib/components/LazyRender.svelte";
	import InfiniteScroll from "$lib/components/InfiniteScroll.svelte";
	import Slideshow from "$lib/components/Slideshow.svelte";
	import {
		ArrowLeft,
		Trash2,
		HardDrive,
		Play
	} from "lucide-svelte";

	let mediaItems: any[] = $state([]);
	let cachedPosts: any[] = $state([]);
	let loading = $state(true);
	let currentFilter = $state("all");

	let filteredPosts = $derived(
		cachedPosts.filter((post) => {
			if (currentFilter === "all") return true;
			
			// Check for specific content blocks in NPF (Tumblr often returns NPF link posts as 'text')
			const blocks = [...(post.content || []), ...(post.trail || []).flatMap((t: any) => t.content || [])];
			
			if (currentFilter === 'photo') return blocks.some((b: any) => b.type === 'image') || post.type === 'photo';
			if (currentFilter === 'video') return blocks.some((b: any) => b.type === 'video') || post.type === 'video';
			
			return post.type === currentFilter;
		})
	);

	// Infinite Loading
	let visibleCount = $state(40);
	
	let visibleItems = $derived(
		filteredPosts.slice(0, visibleCount),
	);
	
	let hasMore = $derived(visibleCount < filteredPosts.length);

	function loadMore() {
		if (hasMore) {
			visibleCount += 40;
		}
	}

	// Stats
	let cacheStats = $state({ count: 0, estimatedMb: 0 });

	// Browser storage quota
	let storageQuota = $state({ usageMb: 0, quotaMb: 0, pct: 0 });

	async function refreshStorageQuota() {
		if (!navigator.storage?.estimate) return;
		const { usage = 0, quota = 1 } = await navigator.storage.estimate();
		const usageMb = Math.round((usage / 1024 / 1024) * 10) / 10;
		const quotaMb = Math.round((quota / 1024 / 1024) * 10) / 10;
		storageQuota = {
			usageMb,
			quotaMb,
			pct: Math.min(100, Math.round((usage / quota) * 100)),
		};
	}

	$effect(() => {
		currentFilter;
		visibleCount = 40;
	});

	let slideshowActive = $state(false);
	let activeSlideshowPostId = $state<string | number | null>(null);
	let slideshowStartPostId = $state<string | number | null>(null);

	$effect(() => {
		if (!slideshowActive && activeSlideshowPostId) {
			const el = document.getElementById(`post-${activeSlideshowPostId}`);
			if (el) {
				el.scrollIntoView({ behavior: 'instant', block: 'center' });
			}
			activeSlideshowPostId = null;
		}
	});

	function openSlideshowFromPost(post: any) {
		slideshowStartPostId = post?.id ?? null;
		slideshowActive = true;
	}

	async function handleClear() {
		if (confirm("Clear all downloaded media blobs?")) {
			await clearCache();
			for (const item of mediaItems) {
				URL.revokeObjectURL(item.url);
			}
			mediaItems = [];
			cachedPosts = [];
			cacheStats = { count: 0, estimatedMb: 0 };
			storageQuota = {
				usageMb: 0,
				quotaMb: storageQuota.quotaMb,
				pct: 0,
			};
			await refreshStorageQuota();
		}
	}

	onMount(async () => {
		try {
			mediaItems = await getAllCachedMedia();
			cacheStats = await getMediaCacheStats();
			await refreshStorageQuota();
			
			const seenIds = new Set();
			const posts = [];
			
			for (const item of mediaItems) {
				if (item.post && !seenIds.has(item.post.id)) {
					seenIds.add(item.post.id);
					posts.push(item.post);
				} else if (!item.post && !seenIds.has(item.originalUrl)) {
					seenIds.add(item.originalUrl);
					posts.push({
						id: item.originalUrl,
						blog_name: 'unknown',
						type: item.type.startsWith('video') ? 'video' : 'photo',
						summary: 'Legacy Cached Media',
						photos: item.type.startsWith('video') ? [] : [{ original_size: { url: item.originalUrl } }],
						video_url: item.type.startsWith('video') ? item.originalUrl : undefined,
						timestamp: item.timestamp || 0
					});
				}
			}
			
			cachedPosts = posts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
		} catch (e) {
			console.error(e);
		} finally {
			loading = false;
		}
	});

	onDestroy(() => {
		// Revoke object URLs created for cache entries
		for (const item of mediaItems) {
			if (item.url) URL.revokeObjectURL(item.url);
		}
	});
</script>

<div class="min-h-screen p-4 md:p-8 bg-black">
	<header
		class="mb-8 shrink-0 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
	>
		<div class="flex items-center gap-4">
			<button
				onclick={() => history.back()}
				class="btn btn-circle btn-ghost text-white"
			>
				<ArrowLeft size={24} />
			</button>
			<div>
				<h1 class="text-3xl font-bold text-white tracking-tight">
					Media Cache
				</h1>
				<p class="text-xs text-gray-500 font-bold mt-0.5">
					{cacheStats.count} blobs stored · {cacheStats.estimatedMb} MB
					used
				</p>
			</div>
		</div>

		<div class="flex flex-col items-end gap-3">
			<div class="flex items-center gap-3">
				<!-- Storage Ring Widget -->
				{#if storageQuota.quotaMb > 0}
					{@const r = 20}
					{@const circ = 2 * Math.PI * r}
					{@const dash = circ * (1 - storageQuota.pct / 100)}
					{@const color =
						storageQuota.pct > 80
							? "#ef4444"
							: storageQuota.pct > 50
								? "#f59e0b"
								: "#8b5cf6"}
					<div
						class="flex items-center gap-2 bg-gray-900 rounded-2xl border border-gray-800 px-4 py-2"
					>
						<svg
							width="48"
							height="48"
							viewBox="0 0 48 48"
							class="-rotate-90"
						>
							<circle
								cx="24"
								cy="24"
								{r}
								fill="none"
								stroke="#1f2937"
								stroke-width="4"
							/>
							<circle
								cx="24"
								cy="24"
								{r}
								fill="none"
								stroke={color}
								stroke-width="4"
								stroke-linecap="round"
								stroke-dasharray={circ}
								stroke-dashoffset={dash}
								style="transition: stroke-dashoffset 0.6s ease"
							/>
						</svg>
						<div class="flex flex-col">
							<span class="text-sm font-black text-white leading-none"
								>{storageQuota.pct}%</span
							>
							<span class="text-[10px] text-gray-500 font-bold">
								{storageQuota.usageMb >= 1024
									? (storageQuota.usageMb / 1024).toFixed(1) +
										" GB"
									: storageQuota.usageMb + " MB"}
								/ {storageQuota.quotaMb >= 1024
									? (storageQuota.quotaMb / 1024).toFixed(0) +
										" GB"
									: storageQuota.quotaMb + " MB"}
							</span>
						</div>
					</div>
				{/if}

				<button
					class="btn btn-sm btn-outline btn-error gap-2"
					onclick={handleClear}
				>
					<Trash2 size={16} /> Clear Cache
				</button>
			</div>
			
			{#if cachedPosts.length > 0}
				<div class="flex items-center gap-4">
					<div class="tabs tabs-boxed bg-gray-900 border border-gray-800 p-1 w-fit">
						<button
							class="tab {currentFilter === 'all' ? 'tab-active bg-primary text-white' : 'text-gray-400'}"
							onclick={() => (currentFilter = "all")}
						>All Media</button>
						<button
							class="tab {currentFilter === 'photo' ? 'tab-active bg-primary text-white' : 'text-gray-400'}"
							onclick={() => (currentFilter = "photo")}
						>Photos</button>
						<button
							class="tab {currentFilter === 'video' ? 'tab-active bg-primary text-white' : 'text-gray-400'}"
							onclick={() => (currentFilter = "video")}
						>Videos</button>
					</div>
					<button
						class="btn btn-sm btn-outline gap-2 border-gray-600 hover:bg-gray-800 text-gray-300"
						onclick={() => {
							slideshowStartPostId = null;
							slideshowActive = true;
						}}
						disabled={filteredPosts.length === 0}
					>
						<Play size={16} /> Play Slideshow
					</button>
				</div>
			{/if}
		</div>
	</header>

	{#if loading}
		<div class="flex justify-center py-20 items-center">
			<span class="loading loading-spinner loading-lg text-primary"
			></span>
		</div>
	{:else if cachedPosts.length === 0}
		<div class="hero py-20 rounded-3xl bg-base-200">
			<div class="hero-content text-center">
				<div class="max-w-md">
					<HardDrive size={48} class="mx-auto mb-4 text-gray-600" />
					<h2 class="text-3xl font-bold text-white">
						Cache is empty
					</h2>
					<p class="py-6 text-gray-500">
						Go back to the dashboard and scroll to cache some media.
					</p>
					<a href="/" class="btn btn-primary">Go to Dashboard</a>
				</div>
			</div>
		</div>
	{:else}
		<main 
			class="grid gap-4 items-start {$settings.mediaColumns === 'auto' ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7' : ''}"
			style={$settings.mediaColumns !== 'auto' ? `grid-template-columns: repeat(${$settings.mediaColumns}, minmax(0, 1fr));` : ''}
		>
			{#each visibleItems as post (post.id)}
				<div id={"post-" + post.id}>
					<LazyRender>
						<PostCard {post} mode="cache" onclickOverride={() => openSlideshowFromPost(post)} />
					</LazyRender>
				</div>
			{/each}
		</main>
		
		{#if filteredPosts.length === 0 && cachedPosts.length > 0}
			<div class="py-20 text-center text-gray-500">
				No media matches the current filter.
			</div>
		{/if}

		<InfiniteScroll {hasMore} loading={false} onload={loadMore} />
	{/if}
</div>

<Slideshow
	bind:active={slideshowActive}
	bind:activePostId={activeSlideshowPostId}
	startPostId={slideshowStartPostId}
	posts={filteredPosts}
	onReachEnd={async () => {
		loadMore();
	}}
/>
