<script lang="ts">
	import { onMount, untrack } from "svelte";
	import { browser } from "$app/environment";
	import { accounts } from "$lib/stores/accounts";
	import { settings } from "$lib/stores/settings";
	import { cacheAllVisible } from "$lib/cacheUtils";
	import { filterPosts, type PostFilter } from "$lib/postFilter";
	import { getAllMediaUrls } from '$lib/mediaUrls';
	import { bulkIsMediaCached } from '$lib/stores/db';
	import PostCard from "$lib/components/PostCard.svelte";
	import LazyRender from "$lib/components/LazyRender.svelte";
	import InfiniteScroll from "$lib/components/InfiniteScroll.svelte";
	import Slideshow from "$lib/components/Slideshow.svelte";
	import type { TumblrPost, TumblrAccount } from "$lib/types";
	import {
		Heart,
		User,
		Download,
		Loader2,
		Play,
		Home,
		Search,
	} from "lucide-svelte";

	let likes: TumblrPost[] = $state([]);
	let loading = $state(false);
	let hasMore = $state(true);
	let accountOffsets: Record<string, number> = $state({});
	let error = $state("");
	let isOffline = $state(false);
	let slideshowActive = $state(false);
	let activeSlideshowPostId = $state<string | number | null>(null);
	let slideshowStartPostId = $state<string | number | null>(null);
	let likesScrollContainer = $state<HTMLElement | null>(null);
	let gridContainer = $state<HTMLElement | null>(null);

	const GRID_GAP_PX = 16;
	const VIRTUAL_OVERSCAN_ROWS = 8;

	let containerWidth = $state(0);
	let viewportHeight = $state(0);
	let scrollTop = $state(0);

	function getAutoColumnCount(width: number): number {
		if (width >= 1536) return 7;
		if (width >= 1280) return 6;
		if (width >= 1024) return 5;
		if (width >= 768) return 4;
		if (width >= 640) return 3;
		return 2;
	}

	let columnCount = $derived.by(() => {
		const configured = $settings.mediaColumns;
		if (configured !== 'auto') {
			const parsed = Number.parseInt(configured, 10);
			if (Number.isFinite(parsed) && parsed > 0) return parsed;
		}
		const width = containerWidth || (browser ? window.innerWidth : 1024);
		return getAutoColumnCount(width);
	});

	let currentFilter = $state<PostFilter>("all");
	let filteredLikes = $derived(filterPosts(likes, currentFilter));

	let rowCount = $derived(Math.ceil(filteredLikes.length / columnCount));
	let cardWidth = $derived.by(() => {
		if (columnCount <= 0 || containerWidth <= 0) return 0;
		return Math.max(0, (containerWidth - GRID_GAP_PX * (columnCount - 1)) / columnCount);
	});
	let rowHeight = $derived(cardWidth > 0 ? cardWidth * (4 / 3) : 0);
	let rowStride = $derived(rowHeight + GRID_GAP_PX);
	let virtualHeight = $derived(rowCount > 0 ? rowCount * rowStride - GRID_GAP_PX : 0);

	let visibleStartRow = $derived.by(() => {
		if (rowStride <= 0) return 0;
		return Math.max(0, Math.floor(scrollTop / rowStride) - VIRTUAL_OVERSCAN_ROWS);
	});

	let visibleEndRow = $derived.by(() => {
		if (rowStride <= 0) return -1;
		const viewportBottom = scrollTop + viewportHeight;
		return Math.min(rowCount - 1, Math.ceil(viewportBottom / rowStride) + VIRTUAL_OVERSCAN_ROWS);
	});

	let visibleRows = $derived.by(() => {
		if (visibleEndRow < visibleStartRow || columnCount <= 0) {
			return [] as { row: number; posts: TumblrPost[] }[];
		}

		const rows: { row: number; posts: TumblrPost[] }[] = [];
		for (let row = visibleStartRow; row <= visibleEndRow; row++) {
			const startIndex = row * columnCount;
			const postsInRow = filteredLikes.slice(startIndex, startIndex + columnCount);
			if (postsInRow.length > 0) rows.push({ row, posts: postsInRow });
		}
		return rows;
	});

	function updateContainerMetrics() {
		if (!likesScrollContainer) return;
		containerWidth = likesScrollContainer.clientWidth;
		viewportHeight = likesScrollContainer.clientHeight;
		scrollTop = likesScrollContainer.scrollTop;
	}

	$effect(() => {
		if (!slideshowActive && activeSlideshowPostId) {
			const el = document.getElementById(`post-${activeSlideshowPostId}`);
			if (el) {
				el.scrollIntoView({ behavior: 'instant', block: 'center' });
			} else if (likesScrollContainer && rowStride > 0) {
				const postIndex = filteredLikes.findIndex((post) => String(post.id) === String(activeSlideshowPostId));
				if (postIndex >= 0) {
					const row = Math.floor(postIndex / columnCount);
					likesScrollContainer.scrollTo({ top: Math.max(0, row * rowStride - 120), behavior: 'instant' });
				}
			}
			activeSlideshowPostId = null;
		}
	});
	
	let fetchController: AbortController | null = null;

	const FILTERS: { value: PostFilter; label: string }[] = [
		{ value: "all", label: "All" },
		{ value: "photo", label: "Photos" },
		{ value: "video", label: "Videos" },
		{ value: "audio", label: "Audio" },
		{ value: "quote", label: "Quotes" },
		{ value: "link", label: "Links" },
		{ value: "chat", label: "Chat" },
		{ value: "answer", label: "Asks" },
		{ value: "text", label: "Text" }
	];

	let activeAccounts = $derived<TumblrAccount[]>($accounts.filter((a) => a.active));

	let initialMount = $state(true);
	let prevAccountsStr = $state("");

	export const snapshot = {
		capture: () => ({
			likes,
			accountOffsets,
			hasMore,
			currentFilter,
			prevAccountsStr,
		}),
		restore: (value: any) => {
			likes = value.likes || [];
			accountOffsets = value.accountOffsets || {};
			hasMore = value.hasMore ?? true;
			currentFilter = value.currentFilter || "all";
			prevAccountsStr = value.prevAccountsStr || "";
		},
	};
	let downloadingAll = $state(false);
	let downloadProgress = $state({ done: 0, total: 0 });
	let consecutiveAutoFetches = 0;

	// Pre-compute all cached URLs in a single batch check for all visible posts
	let cachedUrlSet = $state<Set<string>>(new Set());
	let cachedUrlsReady = $state(false);

	$effect(() => {
		const urls = filteredLikes.flatMap(p => getAllMediaUrls(p));
		if (urls.length === 0) {
			cachedUrlSet = new Set();
			cachedUrlsReady = true;
			return;
		}
	
		bulkIsMediaCached(urls).then(found => {
			cachedUrlSet = new Set([...cachedUrlSet, ...found]);
			cachedUrlsReady = true;
		}).catch(() => {
			cachedUrlsReady = true;
		});
	});

	// Final cached URLs for PostCard consumption
	let cachedUrlsFinal = $derived(cachedUrlsReady ? Array.from(cachedUrlSet) : []);

	async function startCacheAll() {
		if (downloadingAll) return;
		downloadingAll = true;
		await cacheAllVisible(filteredLikes, (p) => { downloadProgress = p; });
		downloadingAll = false;
	}

	function openSlideshowFromPost(post: TumblrPost, _mediaUrl?: string) {
		slideshowStartPostId = post?.id ?? null;
		slideshowActive = true;
	}

	function handleCardCachedUrl(url: string) {
		if (cachedUrlSet.has(url)) return;
		cachedUrlSet = new Set([...cachedUrlSet, url]);
	}

	async function loadLikes(reset = false) {
		if (activeAccounts.length === 0) {
			likes = [];
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
		error = "";

		if (reset) {
			accountOffsets = {};
			likes = [];
			hasMore = true;
		}

		try {
			const res = await fetch("/api/user/likes", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				signal: fetchController.signal,
				body: JSON.stringify({
					accounts: activeAccounts,
					before: accountOffsets,
				}),
			});

			if (!res.ok) throw new Error("Failed to load likes");

			const data = await res.json();
			const newLikes: TumblrPost[] = data.liked_posts;
			const newBefore = data.newBefore;

			if (!newLikes || newLikes.length === 0) {
				hasMore = false;
			} else {
				const existingIds = new Set(likes.map((p) => p.id));
				const uniqueNew = newLikes.filter(
					(p) => !existingIds.has(p.id),
				);

				if (uniqueNew.length === 0 && newLikes.length > 0) {
					// All duplicates, but we might have more pages
				} else if (uniqueNew.length === 0) {
					hasMore = false;
				} else {
					likes = [...likes, ...uniqueNew];
					accountOffsets = { ...accountOffsets, ...newBefore };
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

	// Auto-fetch to ensure the last row is perfectly filled
	$effect(() => {
		if ($settings.mediaColumns !== "auto" && !loading && hasMore && filteredLikes.length > 0) {
			const cols = parseInt($settings.mediaColumns);
			if (filteredLikes.length % cols !== 0) {
				if (consecutiveAutoFetches < 2) {
					consecutiveAutoFetches++;
					loadLikes();
				}
			} else {
				consecutiveAutoFetches = 0;
			}
		}
	});

	// Abort any in-flight fetch immediately when the filter changes
	$effect(() => {
		const _filter = currentFilter; // track
		untrack(() => {
			if (fetchController && !fetchController.signal.aborted) {
				fetchController.abort();
				loading = false;
			}
			consecutiveAutoFetches = 0;
		});
	});

	// Reactive reload only when active accounts change
	$effect(() => {
		const currentAccountsStr = activeAccounts
			.map((a) => a.blogName)
			.sort()
			.join(",");

		untrack(() => {
			if (browser) {
				if (initialMount) {
					initialMount = false;
					if (
						likes.length > 0 &&
						currentAccountsStr === prevAccountsStr
					) {
						return; // Skip reload on initial mount if snapshot was restored and matches
					}
				}

				prevAccountsStr = currentAccountsStr;

				if (activeAccounts.length > 0) {
					loadLikes(true);
				} else {
					// Clear results
					likes = [];
					loading = false;
					hasMore = false;
					accountOffsets = {};
				}
			}
		});
	});

	function toggleAccount(blogName: string) {
		accounts.toggleActive(blogName);
	}

	onMount(() => {
		if (browser) {
			isOffline = !navigator.onLine;
			const onOnline = () => {
				isOffline = false;
				loadLikes();
			};
			const onOffline = () => (isOffline = true);
			const onWindowResize = () => updateContainerMetrics();
			const onContainerScroll = () => {
				if (!likesScrollContainer) return;
				scrollTop = likesScrollContainer.scrollTop;
			};

			window.addEventListener("online", onOnline);
			window.addEventListener("offline", onOffline);
			window.addEventListener("resize", onWindowResize);

			if (likesScrollContainer) {
				likesScrollContainer.addEventListener('scroll', onContainerScroll, { passive: true });
			}

			const resizeObserver = new ResizeObserver(() => {
				updateContainerMetrics();
			});
			if (likesScrollContainer) {
				resizeObserver.observe(likesScrollContainer);
			}

			requestAnimationFrame(() => {
				updateContainerMetrics();
			});

			return () => {
				window.removeEventListener("online", onOnline);
				window.removeEventListener("offline", onOffline);
				window.removeEventListener("resize", onWindowResize);
				if (likesScrollContainer) {
					likesScrollContainer.removeEventListener('scroll', onContainerScroll);
				}
				resizeObserver.disconnect();
			};
		}
	});

	$effect(() => {
		likesScrollContainer;
		filteredLikes.length;
		columnCount;
		if (!browser) return;
		requestAnimationFrame(() => {
			updateContainerMetrics();
		});
	});
</script>

<div class="h-[calc(100dvh-5rem)] flex flex-col p-4 md:p-8 bg-black overflow-hidden">
	{#if isOffline}
		<div class="alert alert-warning shadow-lg mb-6">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="stroke-current shrink-0 h-6 w-6"
				fill="none"
				viewBox="0 0 24 24"
				><path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
				/></svg
			>
			<span
				>You are offline. Only the <a
					href="/caches"
					class="font-bold underline text-primary">Media Cache</a
				> is available right now.</span
			>
		</div>
	{/if}

	<header
		class="mb-8 shrink-0 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
	>
		<div>
			<h1
				class="text-3xl font-bold text-white tracking-tight flex items-center gap-3"
			>
				<Heart size={32} class="text-pink-500" />
				Your Favourites
			</h1>
			<p class="text-gray-400 mt-1">Posts you've favorited on Tumblr.</p>
		</div>

		<div class="flex flex-col items-end gap-3">
			<div class="flex flex-wrap items-center gap-2">
				{#each $accounts as account}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						role="button"
						tabindex="0"
						class="badge badge-lg gap-2 cursor-pointer transition-colors {account.active
							? 'badge-primary'
							: 'badge-ghost'}"
						onclick={() => toggleAccount(account.blogName)}
						onkeydown={(e) => {
							if (e.key === "Enter" || e.key === " ")
								toggleAccount(account.blogName);
						}}
					>
						<User size={14} />
						{account.blogName}
					</div>
				{/each}
			</div>

			<div class="flex items-center gap-4">
				<div
					class="tabs tabs-boxed bg-gray-900 border border-gray-800 p-1 w-fit flex-wrap"
				>
					{#each FILTERS as f}
						<button
							class="tab {currentFilter === f.value
								? 'tab-active bg-primary text-white'
								: 'text-gray-400'}"
							onclick={() => { currentFilter = f.value; }}
						>{f.label}</button>
					{/each}
				</div>
				<div class="flex items-center gap-2">
					<select class="select select-bordered select-sm bg-gray-900 text-white border-gray-800" bind:value={$settings.mediaColumns}>
						<option value="auto">Auto Columns</option>
						<option value="2">2 Columns</option>
						<option value="3">3 Columns</option>
						<option value="4">4 Columns</option>
						<option value="5">5 Columns</option>
						<option value="6">6 Columns</option>
						<option value="8">8 Columns</option>
						<option value="10">10 Columns</option>
						<option value="12">12 Columns</option>
						<option value="15">15 Columns</option>
						<option value="18">18 Columns</option>
						<option value="20">20 Columns</option>
					</select>
					<button
						class="btn btn-sm btn-outline gap-2 border-gray-600 hover:bg-gray-800 text-gray-300"
						onclick={() => { slideshowStartPostId = null; slideshowActive = true; }}
						disabled={filteredLikes.length === 0}
					>
						<Play size={16} /> Play Slideshow
					</button>
					<button
						class="btn btn-sm btn-primary gap-2"
						onclick={startCacheAll}
						disabled={downloadingAll || isOffline}
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

	{#if downloadingAll}
		<div
			class="mb-6 bg-gray-900 rounded-full h-2 overflow-hidden border border-gray-800"
		>
			<div
				class="h-full bg-primary transition-all duration-300 rounded-full"
				style="width: {downloadProgress.total > 0
					? (downloadProgress.done / downloadProgress.total) * 100
					: 0}%"
			></div>
		</div>
	{/if}

	{#if activeAccounts.length === 0}
		<div class="flex items-center justify-center h-64 text-gray-500">
			Please activate an account to view your favourites.
		</div>
	{:else}
		{#if error && !isOffline}
			<div class="alert alert-error mb-6">{error}</div>
		{/if}

		{#if filteredLikes.length === 0 && !loading && likes.length > 0}
			<div class="py-20 flex-1 flex items-center justify-center text-gray-500">
				No favourited posts match the current filter.
			</div>
		{:else}
			<div bind:this={likesScrollContainer} class="flex-1 overflow-y-auto pr-2 pb-20">
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
											<div id={"post-" + post.id} class="shadow-lg rounded-lg overflow-hidden transition-transform hover:scale-[1.02]">
												<LazyRender>
													<PostCard {post} preCheckedUrls={cachedUrlsFinal} onMediaClick={openSlideshowFromPost} onCachedUrl={handleCardCachedUrl} />
												</LazyRender>
											</div>
										{/each}
									</div>
								</div>
							{/each}
						{/if}
					</div>
				</main>
				<InfiniteScroll {hasMore} {loading} onload={loadLikes} />
			</div>
		{/if}
	{/if}
</div>

<Slideshow
	bind:active={slideshowActive}
	bind:activePostId={activeSlideshowPostId}
	startPostId={slideshowStartPostId}
	posts={filteredLikes}
	onReachEnd={async () => {
		await loadLikes();
	}}
/>
