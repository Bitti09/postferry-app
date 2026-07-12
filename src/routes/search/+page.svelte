<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { accounts } from '$lib/stores/accounts';
	import { cacheAllVisible } from '$lib/cacheUtils';
	import { settings } from '$lib/stores/settings';
	import { filterPosts, type PostFilter } from '$lib/postFilter';
	import PostCard from '$lib/components/PostCard.svelte';
	import LazyRender from '$lib/components/LazyRender.svelte';
	import InfiniteScroll from '$lib/components/InfiniteScroll.svelte';
	import Slideshow from '$lib/components/Slideshow.svelte';
	import { Search, Loader2, Play, Grid, Home, Heart, X, Download } from 'lucide-svelte';

	let query = $state('');
	let posts: any[] = $state([]);
	let loading = $state(false);
	let hasMore = $state(true);
	let paginationValue: number | null = $state(null);
	let error = $state('');
	let slideshowActive = $state(false);
	let activeSlideshowPostId = $state<string | number | null>(null);
	let slideshowStartPostId = $state<string | number | null>(null);
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
		return 2;
	}

	$effect(() => {
		if (!slideshowActive && activeSlideshowPostId) {
			const el = document.getElementById(`post-${activeSlideshowPostId}`);
			if (el) {
				el.scrollIntoView({ behavior: 'instant', block: 'center' });
			} else if (browser && rowStride > 0) {
				const postIndex = filteredPosts.findIndex((post) => String(post.id) === String(activeSlideshowPostId));
				if (postIndex >= 0) {
					const row = Math.floor(postIndex / columnCount);
					const targetTop = Math.max(0, gridTop + row * rowStride - 120);
					window.scrollTo({ top: targetTop, behavior: 'instant' });
				}
			}
			activeSlideshowPostId = null;
		}
	});

	let currentFilter = $state('all');
	let isOffline = $state(false);

	let activeAccount = $derived($accounts.find((a) => a.active));

	let initialSearchDone = $state(false);

	// Handle initial query from URL
	$effect(() => {
		const q = $page.url.searchParams.get('q');
		if (q && activeAccount && !initialSearchDone) {
			untrack(() => {
				console.log(`[Search Debug] Initial URL query found: "${q}". activeAccount is ${activeAccount.blogName}. Performing search.`);
				query = q;
				initialSearchDone = true;
				performSearch(true);
			});
		}
	});

	// Derived filtering using shared postFilter utility
	let filteredPosts = $derived(filterPosts(posts, currentFilter as PostFilter));
	let columnCount = $derived.by(() => {
		const configured = $settings.mediaColumns;
		if (configured !== 'auto') {
			const parsed = Number.parseInt(configured, 10);
			if (Number.isFinite(parsed) && parsed > 0) return parsed;
		}
		const width = viewportWidth || (browser ? window.innerWidth : 1024);
		return getAutoColumnCount(width);
	});

	let rowCount = $derived(Math.ceil(filteredPosts.length / columnCount));
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
			return [] as { row: number; posts: any[] }[];
		}

		const rows: { row: number; posts: any[] }[] = [];
		for (let row = visibleStartRow; row <= visibleEndRow; row++) {
			const startIndex = row * columnCount;
			const postsInRow = filteredPosts.slice(startIndex, startIndex + columnCount);
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

	let downloadingAll = $state(false);
	let downloadProgress = $state({ done: 0, total: 0 });

	async function startCacheAll() {
		if (downloadingAll) return;
		downloadingAll = true;
		await cacheAllVisible(filteredPosts, (p) => { downloadProgress = p; });
		downloadingAll = false;
	}

	function openSlideshowFromPost(post: any, _mediaUrl?: string) {
		slideshowStartPostId = post?.id ?? null;
		slideshowActive = true;
	}

	async function performSearch(reset = false) {
		console.log(`[Search Debug] performSearch() called. reset=${reset}, query="${query}", loading=${loading}, activeAccount=${activeAccount?.blogName}`);
		if (!activeAccount || !query) {
			console.log(`[Search Debug] Aborting: Missing activeAccount or query.`);
			return;
		}
		if (loading) {
			console.log(`[Search Debug] Aborting: Already loading.`);
			return;
		}

		if (reset) {
			posts = [];
			paginationValue = null;
			hasMore = true;
			error = '';
		}

		if (!hasMore) {
			console.log(`[Search Debug] Aborting: hasMore is false.`);
			return;
		}
		loading = true;

		try {
			console.log(`[Search Debug] Sending request to /api/search with query="${query}", before=${paginationValue}, type=${currentFilter}`);
			const res = await fetch('/api/search', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					account: activeAccount,
					query,
					before: paginationValue,
					type: currentFilter
				})
			});

			if (!res.ok) {
				const errText = await res.text();
				console.error(`[Search Debug] Request failed with status ${res.status}:`, errText);
				throw new Error('Search failed: ' + errText);
			}
			const payload = await res.json();
			const newPosts = Array.isArray(payload) ? payload : (payload.posts || []);
			console.log(`[Search Debug] Received ${newPosts.length} posts from API.`);

			if (newPosts.length === 0) {
				hasMore = false;
				console.log(`[Search Debug] hasMore set to false because 0 posts were returned.`);
			} else {
				posts = [...posts, ...newPosts];
				
				// All searches are now tag searches, use timestamp
				const lastPost = newPosts[newPosts.length - 1];
				paginationValue = lastPost.featured_timestamp || lastPost.timestamp;
				console.log(`[Search Debug] Pagination updated to timestamp: ${paginationValue}`);
			}
		} catch (err: any) {
			console.error(`[Search Debug] Caught error during search:`, err);
			error = err.message;
		} finally {
			loading = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			performSearch(true);
		}
	}

	onMount(() => {
		if (!browser) return;

		const onResize = () => refreshVirtualMetrics();
		const onScroll = () => {
			scrollY = window.scrollY;
		};

		window.addEventListener('resize', onResize);
		window.addEventListener('scroll', onScroll, { passive: true });

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
			resizeObserver.disconnect();
		};
	});

	$effect(() => {
		gridContainer;
		filteredPosts.length;
		columnCount;
		if (!browser) return;
		requestAnimationFrame(() => {
			updateGridMetrics();
		});
	});
</script>

<div class="min-h-screen p-4 md:p-8 bg-black text-white pb-20">
	<!-- Header -->
	<header class="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h1 class="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
				<Search size={32} class="text-blue-500" />
				Search
			</h1>
			<p class="text-gray-400 mt-1">Search Tumblr tags. <span class="text-blue-400/80 text-xs font-bold block mt-1 uppercase tracking-wider">Note: Global keyword search is unsupported by the Tumblr API.</span></p>
		</div>

		<!-- Central Search Bar -->
		<div class="flex-1 max-w-xl mx-8 hidden lg:block">
			<div class="relative group">
				<Search class="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-primary transition-colors" size={18} />
				<input 
					type="text" 
					bind:value={query}
					onkeydown={handleKeydown}
					placeholder="Enter tag or keyword..." 
					class="w-full bg-gray-900 border border-gray-800 focus:border-primary rounded-xl py-2 pl-11 pr-10 text-sm transition-all outline-none"
				/>
				{#if query}
					<button 
						class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
						onclick={() => { query = ''; posts = []; }}
					>
						<X size={16} />
					</button>
				{/if}
			</div>
		</div>

		<div class="flex flex-col items-end gap-3">
			<div class="flex flex-wrap items-center gap-2">
				{#each $accounts as account}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div 
						role="button"
						tabindex="0"
						class="badge badge-lg gap-2 cursor-pointer transition-colors {account.active ? 'badge-primary' : 'badge-ghost'}" 
						onclick={() => {
							$accounts = $accounts.map(a => ({ ...a, active: a.blogName === account.blogName }));
						}}
						onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') {
							$accounts = $accounts.map(a => ({ ...a, active: a.blogName === account.blogName }));
						}}}
					>
						<Search size={12} />
						{account.blogName}
					</div>
				{/each}
			</div>

			<div class="flex items-center gap-4">
				<div class="tabs tabs-boxed bg-gray-900 border border-gray-800 p-1 w-fit flex-wrap">
					<button class="tab {currentFilter === 'all' ? 'tab-active bg-primary text-white' : 'text-gray-400'}" onclick={() => { currentFilter = 'all'; if (posts.length > 0) performSearch(true); }}>All</button>
					<button class="tab {currentFilter === 'photo' ? 'tab-active bg-primary text-white' : 'text-gray-400'}" onclick={() => { currentFilter = 'photo'; if (posts.length > 0) performSearch(true); }}>Photos</button>
					<button class="tab {currentFilter === 'video' ? 'tab-active bg-primary text-white' : 'text-gray-400'}" onclick={() => { currentFilter = 'video'; if (posts.length > 0) performSearch(true); }}>Videos</button>
					<button class="tab {currentFilter === 'audio' ? 'tab-active bg-primary text-white' : 'text-gray-400'}" onclick={() => { currentFilter = 'audio'; if (posts.length > 0) performSearch(true); }}>Audio</button>
					<button class="tab {currentFilter === 'text' ? 'tab-active bg-primary text-white' : 'text-gray-400'}" onclick={() => { currentFilter = 'text'; if (posts.length > 0) performSearch(true); }}>Text</button>
				</div>

				<div class="flex items-center gap-2">
					<button 
						class="btn btn-sm btn-outline gap-2 border-gray-600 hover:bg-gray-800 text-gray-300"
						onclick={() => { slideshowStartPostId = null; slideshowActive = true; }}
						disabled={filteredPosts.length === 0}
					>
						<Play size={16} /> Play Slideshow
					</button>

					<button 
						class="btn btn-sm btn-primary gap-2"
						onclick={startCacheAll}
						disabled={downloadingAll || isOffline || filteredPosts.length === 0}
					>
						{#if downloadingAll}
							<Loader2 size={16} class="animate-spin" />
							{downloadProgress.done}/{downloadProgress.total}
						{:else}
							<Download size={16} /> Cache Visible
						{/if}
					</button>
				</div>
			</div>
		</div>
	</header>

	<!-- Mobile Search Bar -->
	<div class="lg:hidden mb-6 relative group">
		<Search class="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-primary transition-colors" size={18} />
		<input 
			type="text" 
			bind:value={query}
			onkeydown={handleKeydown}
			placeholder="Search tags, posts..." 
			class="w-full bg-gray-900 border border-gray-800 focus:border-primary rounded-xl py-3 pl-11 pr-10 text-base transition-all outline-none"
		/>
	</div>

	{#if error && !isOffline}
		<div class="alert alert-error mb-8 rounded-3xl shadow-xl">
			<span class="font-bold">{error}</span>
		</div>
	{/if}

	<!-- Results Grid -->
	{#if posts.length > 0}
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
										<LazyRender>
											<PostCard {post} onMediaClick={openSlideshowFromPost} />
										</LazyRender>
									</div>
								{/each}
							</div>
						</div>
					{/each}
				{/if}
			</div>
		</main>

		<InfiniteScroll 
			hasMore={hasMore && !loading} 
			onload={() => performSearch(false)} 
		/>
	{:else if !loading && query}
		<div class="flex flex-col items-center justify-center py-20 text-gray-500">
			<Search size={64} class="mb-4 opacity-20" />
			<p class="text-xl font-bold">No posts found for "{query}"</p>
			<p class="text-sm">Try different tags or keywords.</p>
		</div>
	{:else if !loading}
		<div class="flex flex-col items-center justify-center py-20 text-gray-600">
			<Search size={64} class="mb-4 opacity-10" />
			<p class="text-xl font-black uppercase tracking-[0.2em]">Enter a query to start searching</p>
		</div>
	{/if}

	{#if loading && posts.length === 0}
		<div class="flex justify-center py-20">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{/if}
</div>

{#if slideshowActive}
	<Slideshow 
		bind:active={slideshowActive} 
		bind:activePostId={activeSlideshowPostId}
		startPostId={slideshowStartPostId}
		posts={filteredPosts} 
		onReachEnd={() => performSearch(false)} 
	/>
{/if}
