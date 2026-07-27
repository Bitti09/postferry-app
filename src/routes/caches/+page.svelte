<script lang="ts">
	import { onMount, untrack, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { settings } from '$lib/stores/settings';
	import { getCachedPostsPage, clearCache, getMediaCacheStats } from '$lib/cache';
	import { refreshUnreferencedPosts } from '$lib/stores/unreferencedPosts';
	import type { PostFilter } from '$lib/postFilter';
	import PostCard from '$lib/components/PostCard.svelte';
	import InfiniteScroll from '$lib/components/InfiniteScroll.svelte';
	import Slideshow from '$lib/components/Slideshow.svelte';
	import type { TumblrPost } from '$lib/types';
	import { ArrowLeft, Trash2, HardDrive, Play, Filter, Layers, Image as ImageIcon, Video, Heart, UserSquare, Library } from '@lucide/svelte';

	const FILTERS: { value: PostFilter; label: string; icon: any }[] = [
		{ value: 'all', label: 'All', icon: Layers },
		{ value: 'photo', label: 'Photos', icon: ImageIcon },
		{ value: 'video', label: 'Videos', icon: Video }
	];
	
	const SOURCE_FILTERS: { value: 'all' | 'faves' | 'blogs'; label: string; icon: any }[] = [
		{ value: 'all', label: 'All Sources', icon: Library },
		{ value: 'faves', label: 'Faves', icon: Heart },
		{ value: 'blogs', label: 'Blogs', icon: UserSquare }
	];

	const PAGE_SIZE = 100;
	type PostCursor = { cachedAt: number; id: number; sortTimestamp?: number } | null;

	let posts: TumblrPost[] = $state([]);
	let loading = $state(true);
	let loadingMore = $state(false);
	
	let total = $state(0);
	let nextCursor = $state<PostCursor>(null);
	let hasMore = $derived(nextCursor !== null);
	let error = $state('');
	
	let loadToken = 0;

	let cacheStats = $state({ count: 0, estimatedMb: 0 });
	let storageQuota = $state({ usageMb: 0, quotaMb: 0, pct: 0 });

	let slideshowActive = $state(false);
	let activeSlideshowPostId = $state<string | number | null>(null);
	let slideshowStartPostId = $state<string | number | null>(null);
	let slideshowStartMediaUrl = $state<string | null>(null);
	let gridContainer = $state<HTMLElement | null>(null);

	const GRID_GAP_PX = 16;
	const VIRTUAL_OVERSCAN_ROWS = 8;

	let viewportWidth = $state(0);
	let viewportHeight = $state(0);
	let scrollY = $state(0);
	let gridTop = $state(0);
	let gridWidth = $state(0);

	function getAutoColumnCount(width: number): number {
		if (width >= 1536) return 7;
		if (width >= 1280) return 6;
		if (width >= 1024) return 5;
		if (width >= 768) return 4;
		if (width >= 640) return 3;
		if (width >= 480) return 2;
		return 1;
	}

	let columnCount = $derived.by(() => {
		const configured = $settings.mediaColumns;
		if (configured !== 'auto') {
			const parsed = Number.parseInt(configured, 10);
			if (Number.isFinite(parsed) && parsed > 0) return parsed;
		}
		const width = viewportWidth || (browser ? window.innerWidth : 1024);
		return getAutoColumnCount(width);
	});

	let currentFilter = $state<PostFilter>('all');
	let currentSourceFilter = $state<'all' | 'faves' | 'blogs'>('all');

	let rowCount = $derived(Math.ceil(posts.length / columnCount));
	let cardWidth = $derived.by(() => {
		if (columnCount <= 0 || gridWidth <= 0) return 0;
		return Math.max(0, (gridWidth - GRID_GAP_PX * (columnCount - 1)) / columnCount);
	});
	let rowHeight = $derived(cardWidth > 0 ? cardWidth * (4 / 3) : 0);
	let rowStride = $derived(rowHeight + GRID_GAP_PX);
	let virtualHeight = $derived(rowCount > 0 ? rowCount * rowStride - GRID_GAP_PX : 0);

	let viewportTopWithinGrid = $derived(Math.max(0, scrollY - gridTop));
	let viewportBottomWithinGrid = $derived(viewportTopWithinGrid + viewportHeight);

	let visibleStartRow = $derived.by(() => {
		if (rowStride <= 0) return 0;
		return Math.max(0, Math.floor(viewportTopWithinGrid / rowStride) - VIRTUAL_OVERSCAN_ROWS);
	});

	let visibleEndRow = $derived.by(() => {
		if (rowStride <= 0) return -1;
		return Math.min(rowCount - 1, Math.ceil(viewportBottomWithinGrid / rowStride) + VIRTUAL_OVERSCAN_ROWS);
	});

	let visibleRows = $derived.by(() => {
		if (visibleEndRow < visibleStartRow || columnCount <= 0) {
			return [] as { row: number; posts: TumblrPost[] }[];
		}

		const rows: { row: number; posts: TumblrPost[] }[] = [];
		for (let row = visibleStartRow; row <= visibleEndRow; row++) {
			const startIndex = row * columnCount;
			const postsInRow = posts.slice(startIndex, startIndex + columnCount);
			if (postsInRow.length > 0) rows.push({ row, posts: postsInRow });
		}
		return rows;
	});

	function updateViewportMetrics() {
		if (!browser) return;
		viewportWidth = window.innerWidth;
		viewportHeight = window.innerHeight;
		scrollY = window.scrollY;
	}

	function updateGridMetrics() {
		if (!browser || !gridContainer) return;
		const rect = gridContainer.getBoundingClientRect();
		gridTop = window.scrollY + rect.top;
		gridWidth = rect.width;
	}

	function refreshVirtualMetrics() {
		updateViewportMetrics();
		updateGridMetrics();
	}

	$effect(() => {
		if (!slideshowActive && activeSlideshowPostId) {
			const el = document.getElementById(`post-${activeSlideshowPostId}`);
			if (el) {
				el.scrollIntoView({ behavior: 'instant', block: 'center' });
			} else if (browser && rowStride > 0) {
				const postIndex = posts.findIndex((post) => String(post.id) === String(activeSlideshowPostId));
				if (postIndex >= 0) {
					const row = Math.floor(postIndex / columnCount);
					const targetTop = Math.max(0, gridTop + row * rowStride - 120);
					window.scrollTo({ top: targetTop, behavior: 'instant' });
				}
			}
			activeSlideshowPostId = null;
		}
	});
	
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

	async function loadPage(opts: { before?: PostCursor | null; append: boolean; filter: PostFilter; sourceFilter: 'all' | 'faves' | 'blogs' }) {
		const token = ++loadToken;
		const result = await getCachedPostsPage({
			limit: PAGE_SIZE,
			before: opts.before ?? undefined,
			filter: opts.filter,
			sourceFilter: opts.sourceFilter
		});
		
		if (token !== loadToken) return;

		if (opts.append) {
			posts = [...posts, ...result.entries.map((e) => e.post)];
		} else {
			posts = result.entries.map((e) => e.post);
		}
		total = result.total;
		nextCursor = (result.nextCursor as PostCursor | null) ?? null;
	}

	async function refreshAll() {
		loading = true;
		error = '';
		try {
			await Promise.all([
				loadPage({ before: null, append: false, filter: currentFilter, sourceFilter: currentSourceFilter }),
				getMediaCacheStats().then((s) => (cacheStats = s))
			]);
			await refreshStorageQuota();
			await refreshUnreferencedPosts();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	async function loadMore() {
		if (loadingMore || !hasMore || nextCursor === null) return;
		loadingMore = true;
		try {
			await loadPage({ before: nextCursor, append: true, filter: currentFilter, sourceFilter: currentSourceFilter });
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loadingMore = false;
		}
	}

	$effect(() => {
		const filter = currentFilter;
		const source = currentSourceFilter;
		untrack(() => {
			if (browser) {
				loadPage({ before: null, append: false, filter, sourceFilter: source }).catch(e => {
					error = e instanceof Error ? e.message : String(e);
				});
			}
		});
	});

	function openSlideshowFromPost(post: TumblrPost, mediaUrl?: string) {
		slideshowStartPostId = post?.id ?? null;
		slideshowStartMediaUrl = mediaUrl ?? null;
		slideshowActive = true;
	}

	function offlineHref(post: TumblrPost): string {
		const blog = post?.blog_name;
		const id = post?.id;
		if (!blog || id === undefined || id === null) return "#";
		return `/post/${blog}/${id}?offline=1`;
	}

	async function handleClear() {
		if (!confirm("Clear all cached posts and blobs?")) return;
		await clearCache();
		posts = [];
		total = 0;
		nextCursor = null;
		cacheStats = { count: 0, estimatedMb: 0 };
		storageQuota = {
			usageMb: 0,
			quotaMb: storageQuota.quotaMb,
			pct: 0,
		};
		await refreshStorageQuota();
		await refreshUnreferencedPosts();
	}

	function onVisibilityChange() {
		if (document.visibilityState === "visible") {
			void refreshAll();
		}
	}

	onMount(() => {
		if (browser) {
			void refreshAll();
			const onResize = () => refreshVirtualMetrics();
			const onScroll = () => { scrollY = window.scrollY; };

			window.addEventListener('resize', onResize);
			window.addEventListener('scroll', onScroll, { passive: true });
			document.addEventListener("visibilitychange", onVisibilityChange);

			const resizeObserver = new ResizeObserver(() => {
				updateGridMetrics();
			});
			if (gridContainer) {
				resizeObserver.observe(gridContainer);
			}

			requestAnimationFrame(() => {
				refreshVirtualMetrics();
			});

			return () => {
				window.removeEventListener('resize', onResize);
				window.removeEventListener('scroll', onScroll);
				document.removeEventListener("visibilitychange", onVisibilityChange);
				resizeObserver.disconnect();
			};
		}
	});

	$effect(() => {
		gridContainer;
		posts.length;
		columnCount;
		if (!browser) return;
		requestAnimationFrame(() => {
			updateGridMetrics();
		});
	});
</script>

<div class="min-h-screen p-4 md:p-8 bg-black">
	<header class="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-4">
			<button onclick={() => history.back()} class="btn btn-circle btn-ghost text-white">
				<ArrowLeft size={24} />
			</button>
			<div>
				<h1 class="text-3xl font-bold text-white tracking-tight">Media Cache</h1>
				<p class="text-xs text-gray-500 font-bold mt-0.5">
					{total} posts{currentFilter !== 'all' ? ` · filter: ${currentFilter}` : ''} · {cacheStats.count} blobs · {cacheStats.estimatedMb} MB used
				</p>
			</div>
		</div>

		<div class="flex flex-col items-end gap-3">
			<div class="flex items-center gap-3">
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
					<div class="flex items-center gap-2 bg-gray-900 rounded-2xl border border-gray-800 px-4 py-2">
						<svg width="48" height="48" viewBox="0 0 48 48" class="-rotate-90">
							<circle cx="24" cy="24" {r} fill="none" stroke="#1f2937" stroke-width="4" />
							<circle cx="24" cy="24" {r} fill="none" stroke={color} stroke-width="4" stroke-linecap="round" stroke-dasharray={circ} stroke-dashoffset={dash} style="transition: stroke-dashoffset 0.6s ease" />
						</svg>
						<div class="flex flex-col">
							<span class="text-sm font-black text-white leading-none">{storageQuota.pct}%</span>
							<span class="text-[10px] text-gray-500 font-bold">
								{storageQuota.usageMb >= 1024 ? (storageQuota.usageMb / 1024).toFixed(1) + " GB" : storageQuota.usageMb + " MB"} /
								{storageQuota.quotaMb >= 1024 ? (storageQuota.quotaMb / 1024).toFixed(0) + " GB" : storageQuota.quotaMb + " MB"}
							</span>
						</div>
					</div>
				{/if}
				<button class="btn btn-sm btn-outline btn-error gap-2" onclick={handleClear}>
					<Trash2 size={16} /> Clear Cache
				</button>
			</div>

			{#if total > 0}
				<div class="flex flex-col sm:flex-row items-end sm:items-center gap-4 w-full max-w-full">
					<div class="tabs tabs-boxed bg-gray-900 border border-gray-800 p-1 flex-nowrap overflow-x-auto w-full sm:w-auto max-w-full hide-scrollbar justify-start">
						{#each SOURCE_FILTERS as sf}
							{@const Icon = sf.icon}
							<button
								class="tab flex-1 whitespace-nowrap flex items-center justify-center gap-2 {currentSourceFilter === sf.value ? 'tab-active bg-primary text-white' : 'text-gray-400'}"
								onclick={() => { currentSourceFilter = sf.value; }}
								title={sf.label}
							>
								<Icon size={14} />
								<span class="hidden sm:inline">{sf.label}</span>
							</button>
						{/each}
					</div>
					<div class="tabs tabs-boxed bg-gray-900 border border-gray-800 p-1 flex-nowrap overflow-x-auto w-full sm:w-auto max-w-full hide-scrollbar justify-start">
						{#each FILTERS as f}
							{@const Icon = f.icon}
							<button
								class="tab flex-1 whitespace-nowrap flex items-center justify-center gap-2 {currentFilter === f.value ? 'tab-active bg-primary text-white' : 'text-gray-400'}"
								onclick={() => { currentFilter = f.value; }}
								title={f.label}
							>
								<Icon size={14} />
								<span class="hidden sm:inline">{f.label}</span>
							</button>
						{/each}
					</div>
					<div class="flex items-center gap-2 w-full sm:w-auto justify-end">
						<button
							class="btn btn-sm btn-outline gap-1 border-gray-600 hover:bg-gray-800 text-gray-300 flex-1 sm:flex-none"
							onclick={() => { slideshowStartPostId = null; slideshowStartMediaUrl = null; slideshowActive = true; }}
							disabled={posts.length === 0}
						>
							<Play size={16} /> <span class="hidden sm:inline">Play Slideshow</span><span class="sm:hidden">Play</span>
						</button>
					</div>
				</div>
			{/if}
		</div>
	</header>

	{#if loading && posts.length === 0}
		<div class="flex justify-center py-20 items-center">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:else if total === 0}
		<div class="hero py-20 rounded-3xl bg-base-200">
			<div class="hero-content text-center">
				<div class="max-w-md">
					<HardDrive size={48} class="mx-auto mb-4 text-gray-600" />
					<h2 class="text-3xl font-bold text-white">Cache is empty</h2>
					<p class="py-6 text-gray-500">Go back to the dashboard and scroll to cache some media.</p>
					<a href="/" class="btn btn-primary">Go to Dashboard</a>
				</div>
			</div>
		</div>
	{:else}
		{#if error}
			<div class="alert alert-error shadow-lg mb-6">
				<span>{error}</span>
			</div>
		{/if}

		<main>
			<div bind:this={gridContainer} class="relative w-full" style={`height: ${virtualHeight}px;`}>
				{#if cardWidth > 0}
					{#each visibleRows as rowItem (rowItem.row)}
						<div
							class="absolute"
							style={`top: ${rowItem.row * rowStride}px; left: 0; right: 0;`}
						>
							<div
								class="grid"
								style={`grid-template-columns: repeat(${columnCount}, minmax(0, 1fr)); gap: ${GRID_GAP_PX}px;`}
							>
								{#each rowItem.posts as post (post.id)}
									<div id={"post-" + post.id}>
										<a href={offlineHref(post)} class="block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-xl" title="Open from offline cache" data-sveltekit-preload-data="off">
											<PostCard {post} mode="cache" onMediaClick={(p, url) => { 
												// intercept click to prevent navigation if it was meant to open slideshow
												openSlideshowFromPost(p, url);
											}} />
										</a>
									</div>
								{/each}
							</div>
						</div>
					{/each}
				{/if}
			</div>
		</main>

		{#if posts.length === 0 && total > 0}
			<div class="py-20 text-center text-gray-500">
				<Filter size={32} class="mx-auto mb-3 text-gray-600" />
				No media matches the current filter.
			</div>
		{/if}

		<InfiniteScroll {hasMore} loading={loadingMore} onload={loadMore} />
	{/if}
</div>

<Slideshow
	bind:active={slideshowActive}
	bind:activePostId={activeSlideshowPostId}
	startPostId={slideshowStartPostId}
	startMediaUrl={slideshowStartMediaUrl}
	posts={posts}
	onReachEnd={async () => { await loadMore(); }}
/>
