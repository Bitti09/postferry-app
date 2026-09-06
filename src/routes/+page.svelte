<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { browser } from '$app/environment';
	import { settings } from '$lib/stores/settings';
	import { accounts, accountsReady } from '$lib/stores/accounts';
	import { bulkSetPosts } from '$lib/cache';
	import { refreshUnreferencedPosts } from '$lib/stores/unreferencedPosts';
	import { cacheAllVisible } from '$lib/cacheUtils';
	import { filterPosts, type PostFilter } from '$lib/postFilter';
	import PostCard from '$lib/components/PostCard.svelte';
	import InfiniteScroll from '$lib/components/InfiniteScroll.svelte';
	import Slideshow from '$lib/components/Slideshow.svelte';
	import type { TumblrPost, TumblrAccount } from '$lib/types';
	import { Plus, User, LogOut, Download, Loader2, Play, Home, Heart, Layers, Image as ImageIcon, Video, Music, Quote, Link as LinkIcon, MessageSquare, HelpCircle, FileText } from '@lucide/svelte';

	const FILTERS: { value: PostFilter; label: string; icon: any }[] = [
		{ value: 'all', label: 'All', icon: Layers },
		{ value: 'photo', label: 'Photos', icon: ImageIcon },
		{ value: 'video', label: 'Videos', icon: Video },
		{ value: 'audio', label: 'Audio', icon: Music },
		{ value: 'quote', label: 'Quotes', icon: Quote },
		{ value: 'link', label: 'Links', icon: LinkIcon },
		{ value: 'chat', label: 'Chat', icon: MessageSquare },
		{ value: 'answer', label: 'Asks', icon: HelpCircle },
		{ value: 'text', label: 'Text', icon: FileText }
	];

	let posts: TumblrPost[] = $state([]);
	let loading = $state(false);
	let hasMore = $state(true);
	let accountOffsets: Record<string, string> = $state({});
	let newestSinceIds: Record<string, string> = $state({});
	let error = $state('');
	let isOffline = $state(false);
	let downloadingAll = $state(false);
	let downloadProgress = $state({ done: 0, total: 0 });
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
	let filteredPosts = $derived(filterPosts(posts, currentFilter));

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
			return [] as { row: number; posts: TumblrPost[] }[];
		}

		const rows: { row: number; posts: TumblrPost[] }[] = [];
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
	
	let fetchController: AbortController | null = null;
	
	let activeAccounts = $derived<TumblrAccount[]>($accounts.filter((a) => a.active));

	async function startCacheAll() {
		if (downloadingAll) return;
		downloadingAll = true;
		await cacheAllVisible(filteredPosts, (p) => { downloadProgress = p; });
		downloadingAll = false;
	}

	function openSlideshowFromPost(post: TumblrPost, mediaUrl?: string) {
		slideshowStartPostId = post?.id ?? null;
		slideshowStartMediaUrl = mediaUrl ?? null;
		slideshowActive = true;
	}

	async function loadPosts(reset = false, topUp = false) {
		if (activeAccounts.length === 0) {
			posts = [];
			loading = false;
			return;
		}

		if (isOffline) {
			loading = false;
			return;
		}

		if (loading) {
			if (reset && fetchController) {
				fetchController.abort();
			} else {
				return;
			}
		}

		fetchController = new AbortController();
		loading = true;
		error = '';

		if (reset) {
			accountOffsets = {};
			newestSinceIds = {};
			posts = [];
			hasMore = true;
		}

		try {
			const res = await fetch('/api/posts/dashboard', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				signal: fetchController.signal,
				body: JSON.stringify({
					accounts: activeAccounts,
					offsets: accountOffsets,
					type: currentFilter === 'all' ? null : currentFilter,
					// Top-up refresh: only fetch posts newer than the newest we
					// already hold, instead of re-pulling page 1 for every account.
					since_id: topUp ? newestSinceIds[topKey()] : undefined
				})
			});

			if (!res.ok) throw new Error('Failed to load posts');

			const data = await res.json();
			const newPosts: TumblrPost[] = data.posts;
			const newSinceIds: Record<string, string> = data.newSinceIds ?? {};
			const newOffsets: Record<string, string> = data.newOffsets ?? {};

			if (newPosts.length === 0) {
				if (!topUp) hasMore = false;
			} else {
				const existingIds = new Set(posts.map((p) => p.id));
				const uniqueNewPosts = newPosts.filter((p) => !existingIds.has(p.id));

				if (uniqueNewPosts.length === 0 && newPosts.length > 0) {
					// Duplicates, continue if more pages
				} else if (uniqueNewPosts.length === 0) {
					if (!topUp) hasMore = false;
				} else if (topUp) {
					// New posts land on top, deduping against what we have.
					posts = [...uniqueNewPosts, ...posts];
					for (const [k, v] of Object.entries(newSinceIds)) {
						newestSinceIds[k] = v;
					}
				} else {
					posts = [...posts, ...uniqueNewPosts];
					accountOffsets = { ...accountOffsets, ...newOffsets };
					for (const [k, v] of Object.entries(newSinceIds)) {
						newestSinceIds[k] = v;
					}
					bulkSetPosts(uniqueNewPosts)
						.then(() => refreshUnreferencedPosts());
				}
			}
		} catch (err: any) {
			if (err.name === 'AbortError') return;
			error = err.message;
		} finally {
			if (fetchController && !fetchController.signal.aborted) {
				loading = false;
			}
		}
	}

	function topKey(): string {
		return activeAccounts.map((a) => a.blogName).sort().join(',');
	}

	export const snapshot = {
		capture: () => ({
			posts,
			accountOffsets,
			newestSinceIds,
			hasMore,
			currentFilter
		}),
		restore: (value: any) => {
			posts = value.posts || [];
			accountOffsets = value.accountOffsets || {};
			newestSinceIds = value.newestSinceIds || {};
			hasMore = value.hasMore ?? true;
			currentFilter = value.currentFilter || 'all';
		}
	};

	// Filter is server-side: abort any in-flight fetch then reload with new filter
	$effect(() => {
		const _filter = currentFilter; // track
		untrack(() => {
			if (fetchController && !fetchController.signal.aborted) {
				fetchController.abort();
				loading = false;
			}
			if (browser && activeAccounts.length > 0) {
				loadPosts(true);
			}
		});
	});

	// Reactive reload when active accounts change
	$effect(() => {
		const _accounts = activeAccounts; // track
		untrack(() => {
			if (browser) {
				if (fetchController && !fetchController.signal.aborted) {
					fetchController.abort();
					loading = false;
				}
				if (activeAccounts.length > 0) {
					loadPosts(true);
				} else {
					posts = [];
					loading = false;
					hasMore = false;
					accountOffsets = {};
				}
			}
		});
	});

	function handleAddAccount() {
		window.location.href = '/api/auth/tumblr';
	}

	function toggleAccount(blogName: string) {
		accounts.toggleActive(blogName);
	}

	function removeAccount(blogName: string) {
		accounts.removeAccount(blogName);
	}

	onMount(() => {
		if (browser) {
			isOffline = !navigator.onLine;
			const onOnline = () => { isOffline = false; loadPosts(false); };
			const onOffline = () => { isOffline = true; };
			const onResize = () => refreshVirtualMetrics();
			const onScroll = () => { scrollY = window.scrollY; };

			window.addEventListener('online', onOnline);
			window.addEventListener('offline', onOffline);
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
				window.removeEventListener('online', onOnline);
				window.removeEventListener('offline', onOffline);
				window.removeEventListener('resize', onResize);
				window.removeEventListener('scroll', onScroll);
				resizeObserver.disconnect();
			};
		}
		// $effect above handles initial load on activeAccounts/currentFilter change
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

<div class="min-h-screen p-4 md:p-8 bg-black">
	{#if isOffline}
		<div class="alert alert-warning shadow-lg mb-6">
			<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
			<span>You are offline. Only the <a href="/caches" class="font-bold underline text-primary">Media Cache</a> is available right now.</span>
		</div>
	{/if}

	<header class="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h1 class="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
				<Home size={32} class="text-blue-500" />
				Dashboard
			</h1>
			<p class="text-gray-400 mt-1">Your merged chronological feed.</p>
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
						onclick={() => toggleAccount(account.blogName)}
						onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleAccount(account.blogName); }}
					>
						<User size={14} />
						{account.blogName}
					</div>
				{/each}
				
				<button class="btn btn-sm btn-outline btn-info gap-2" onclick={handleAddAccount}>
					<Plus size={16} /> Add Account
				</button>
			</div>

			{#if activeAccounts.length > 0}
				<div class="flex flex-col sm:flex-row items-end sm:items-center gap-4 w-full max-w-full">
					<div class="tabs tabs-boxed bg-gray-900 border border-gray-800 p-1 flex-nowrap overflow-x-auto w-full sm:w-auto max-w-full hide-scrollbar justify-start">
						{#each FILTERS as f}
							{@const Icon = f.icon}
							<button
								class="tab flex-1 whitespace-nowrap flex items-center justify-center gap-2 {currentFilter === f.value ? 'tab-active bg-primary text-white' : 'text-gray-400'}"
								onclick={() => { currentFilter = f.value; loadPosts(true); }}
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
							disabled={filteredPosts.length === 0}
						>
							<Play size={16} /> <span class="hidden sm:inline">Play Slideshow</span><span class="sm:hidden">Play</span>
						</button>
						<button 
							class="btn btn-sm btn-primary gap-1 flex-1 sm:flex-none"
							onclick={startCacheAll}
							disabled={downloadingAll || isOffline}
						>
							{#if downloadingAll}
								<Loader2 size={16} class="animate-spin" />
								{downloadProgress.done}/{downloadProgress.total}
							{:else}
								<Download size={16} /> <span class="hidden sm:inline">Cache Visible</span><span class="sm:hidden">Cache</span>
							{/if}
						</button>
					</div>
				</div>
			{/if}
		</div>
	</header>

	{#if activeAccounts.length > 0 && downloadingAll}
		<div class="mb-6 bg-gray-900 rounded-full h-2 overflow-hidden border border-gray-800">
			<div 
				class="h-full bg-primary transition-all duration-300 rounded-full"
				style="width: {downloadProgress.total > 0 ? (downloadProgress.done / downloadProgress.total * 100) : 0}%"
			></div>
		</div>
	{/if}

	{#if $accountsReady && $accounts.length === 0}
		<div class="hero min-h-[50vh] rounded-3xl bg-base-200">
			<div class="hero-content text-center">
				<div class="max-w-md">
					<h1 class="text-5xl font-bold text-white">Welcome!</h1>
					<p class="py-6">Connect your Tumblr account to see your merged chronological dashboard.</p>
					<button class="btn btn-primary" onclick={handleAddAccount}>Connect Tumblr</button>
				</div>
			</div>
		</div>
	{:else if activeAccounts.length === 0}
		<div class="flex items-center justify-center h-64 text-gray-500">
			Please activate at least one account to view the dashboard.
		</div>
	{:else}
				{#if error && !isOffline}
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

		<InfiniteScroll {hasMore} {loading} onload={() => loadPosts(false)} />
	{/if}
</div>

<Slideshow
	bind:active={slideshowActive}
	bind:activePostId={activeSlideshowPostId}
	startPostId={slideshowStartPostId}
	startMediaUrl={slideshowStartMediaUrl}
	posts={filteredPosts}
	onReachEnd={async () => { await loadPosts(false); }}
/>
