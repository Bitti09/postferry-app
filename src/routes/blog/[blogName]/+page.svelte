<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { onMount, untrack } from 'svelte';
	import { accounts } from '$lib/stores/accounts';
	import PostCard from '$lib/components/PostCard.svelte';
	import InfiniteScroll from '$lib/components/InfiniteScroll.svelte';
	import Slideshow from '$lib/components/Slideshow.svelte';
	import { ArrowLeft, Heart, Play } from 'lucide-svelte';
	import { settings } from '$lib/stores/settings';

	let blogName = $page.params.blogName;
	
	let info: any = $state(null);
	let posts: any[] = $state([]);
	let loadingInfo = $state(true);
	let loadingPosts = $state(false);
	let hasMore = $state(true);
	let beforeId: number | null = $state(null);
	let error = $state('');
	let fetchController: AbortController | null = null;
	let gridContainer = $state<HTMLElement | null>(null);
	let slideshowActive = $state(false);
	let activeSlideshowPostId = $state<string | number | null>(null);
	let slideshowStartPostId = $state<string | number | null>(null);

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
	
	let currentFilter = $state('all');

	$effect(() => {
		const _filter = currentFilter; // track
		untrack(() => {
			if (fetchController && !fetchController.signal.aborted) {
				fetchController.abort();
				loadingPosts = false;
			}
		});
	});

	let activeAccount = $derived($accounts.find((a) => a.active));

	let filteredPosts = $derived(posts.filter(post => {
		if (currentFilter === 'all') return true;
		if (currentFilter === 'photo') return post.type === 'photo';
		if (currentFilter === 'video') return post.type === 'video';
		if (currentFilter === 'text') return post.type === 'text';
		return true;
	}));

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

	function openSlideshowFromPost(post: any, _mediaUrl?: string) {
		slideshowStartPostId = post?.id ?? null;
		slideshowActive = true;
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

	onMount(() => {
		let cleanup: (() => void) | undefined;

		void (async () => {
		// Accounts load async from IndexedDB; wait for them before proceeding
		if ($accounts.length === 0) {
			// Wait briefly for accounts to load from IndexedDB, retry up to 2s
			let attempts = 0;
			while ($accounts.length === 0 && attempts < 20) {
				await new Promise(r => setTimeout(r, 100));
				attempts++;
			}
		}

		if (!activeAccount) {
			error = 'No active account. Please activate an account to view details.';
			loadingInfo = false;
			return;
		}

		// LocalStorage caching for offline support
		if (typeof localStorage !== 'undefined') {
			const cached = localStorage.getItem(`tumblr_blog_info_${blogName}`);
			if (cached) info = JSON.parse(cached);
		}

		if (typeof navigator !== 'undefined' && !navigator.onLine) {
			loadingInfo = false;
			loadPosts();
			return; // Skip fetch
		}

		// Fetch Info
		try {
			const resInfo = await fetch('/api/blog/info', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ account: activeAccount, blogName })
			});
			if (resInfo.ok) {
				const data = await resInfo.json();
				info = data.info;
				if (typeof localStorage !== 'undefined') {
					localStorage.setItem(`tumblr_blog_info_${blogName}`, JSON.stringify(info));
				}
			}
		} catch (e) {
			console.error(e);
		} finally {
			loadingInfo = false;
		}

		// Initial load of posts
		loadPosts();

		if (browser) {
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

			cleanup = () => {
				window.removeEventListener('resize', onResize);
				window.removeEventListener('scroll', onScroll);
				resizeObserver.disconnect();
			};
		}
		})();

		return () => cleanup?.();
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

	async function loadPosts() {
		if (!activeAccount || loadingPosts || !hasMore) return;
		loadingPosts = true;
		fetchController = new AbortController();

		try {
			const res = await fetch('/api/blog/posts', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				signal: fetchController.signal,
				body: JSON.stringify({ account: activeAccount, blogName, before_id: beforeId })
			});

			if (!res.ok) throw new Error('Failed to load posts');

			const data = await res.json();
			const newPosts = data.posts;

			if (!newPosts || newPosts.length === 0) {
				hasMore = false;
			} else {
				const existingIds = new Set(posts.map((p) => p.id));
				const uniqueNew = newPosts.filter((p: any) => !existingIds.has(p.id));
				
				if (uniqueNew.length === 0) {
					hasMore = false;
				} else {
					posts = [...posts, ...uniqueNew];
					beforeId = Math.min(...uniqueNew.map((p: any) => p.id));
				}
			}
		} catch (err: any) {
			if (err.name === 'AbortError') return;
			error = err.message;
		} finally {
			if (fetchController && !fetchController.signal.aborted) {
				loadingPosts = false;
			}
		}
	}
</script>

<div class="min-h-screen p-4 md:p-8 bg-black">
	<a href="/" class="btn btn-ghost mb-6 gap-2 text-white">
		<ArrowLeft size={20} /> Back to Dashboard
	</a>

	{#if error && (typeof navigator === 'undefined' || navigator.onLine)}
		<div class="alert alert-error">{error}</div>
	{/if}

	<!-- Blog Header -->
	{#if loadingInfo}
		<div class="flex justify-center py-10">
			<span class="loading loading-spinner text-primary"></span>
		</div>
	{:else if info}
		<div class="bg-gray-900 rounded-3xl p-6 md:p-10 mb-8 shadow-xl flex flex-col md:flex-row gap-8 items-start">
			<div class="avatar">
				<div class="w-32 rounded-xl">
					<img src={info.avatar[0]?.url || `https://api.tumblr.com/v2/blog/${blogName}/avatar/128`} alt="Avatar" />
				</div>
			</div>
			
			<div class="flex-1">
				<h1 class="text-4xl font-bold text-white tracking-tight">{info.title || info.name}</h1>
				<p class="text-gray-400 mt-1">@{info.name}</p>
				
				{#if info.description}
					<div class="mt-4 prose prose-invert prose-sm">
						{@html info.description}
					</div>
				{/if}

				<div class="mt-6 flex flex-wrap gap-4">
					<div class="stat bg-gray-800 rounded-2xl w-auto px-6 py-2">
						<div class="stat-title">Posts</div>
						<div class="stat-value text-2xl">{info.posts}</div>
					</div>
					
					{#if info.likes > 0}
						<a href={`/blog/${blogName}/likes`} class="stat bg-gray-800 rounded-2xl w-auto px-6 py-2 hover:bg-gray-700 transition-colors cursor-pointer group">
							<div class="stat-title group-hover:text-pink-400 transition-colors">Favourites</div>
							<div class="stat-value text-2xl flex items-center gap-2">
								{info.likes} <Heart size={18} class="text-pink-500 hidden group-hover:block" />
							</div>
						</a>
					{/if}
				</div>
			</div>
		</div>
	{/if}

	<!-- Posts Grid -->
	<div class="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between mb-6">
		<h2 class="text-2xl font-bold text-white">Recent Posts</h2>
		<div class="flex items-center gap-2 flex-wrap">
			<div class="tabs tabs-boxed bg-gray-900 border border-gray-800 p-1 w-fit">
				<button class="tab {currentFilter === 'all' ? 'tab-active bg-primary text-white' : 'text-gray-400'}" onclick={() => currentFilter = 'all'}>All</button>
				<button class="tab {currentFilter === 'photo' ? 'tab-active bg-primary text-white' : 'text-gray-400'}" onclick={() => currentFilter = 'photo'}>Photos</button>
				<button class="tab {currentFilter === 'video' ? 'tab-active bg-primary text-white' : 'text-gray-400'}" onclick={() => currentFilter = 'video'}>Videos</button>
				<button class="tab {currentFilter === 'text' ? 'tab-active bg-primary text-white' : 'text-gray-400'}" onclick={() => currentFilter = 'text'}>Text</button>
			</div>
			<button
				class="btn btn-sm btn-outline gap-2 border-gray-600 hover:bg-gray-800 text-gray-300"
				onclick={() => { slideshowStartPostId = null; slideshowActive = true; }}
				disabled={filteredPosts.length === 0}
			>
				<Play size={16} /> Play Slideshow
			</button>
		</div>
	</div>
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
									<PostCard {post} onMediaClick={openSlideshowFromPost} />
								</div>
							{/each}
						</div>
					</div>
				{/each}
			{/if}
		</div>
	</main>

	{#if filteredPosts.length === 0 && posts.length > 0}
		<div class="py-20 text-center text-gray-500">
			No posts match the current filter.
		</div>
	{/if}

	<InfiniteScroll {hasMore} loading={loadingPosts} onload={loadPosts} />
</div>

<Slideshow
	bind:active={slideshowActive}
	bind:activePostId={activeSlideshowPostId}
	startPostId={slideshowStartPostId}
	posts={filteredPosts}
	onReachEnd={async () => { await loadPosts(); }}
/>
