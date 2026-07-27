<script lang="ts">
	import { onMount, onDestroy, untrack } from "svelte";
	import { settings } from "$lib/stores/settings";
	import {
		clearCache,
		getMediaCacheStats,
	} from "$lib/stores/db";
	import { getCachedPostsPage } from "$lib/stores/postCache";
	import {
		refreshUnreferencedPosts,
		unreferencedPosts,
	} from "$lib/stores/unreferencedPosts";
	import PostCard from "$lib/components/PostCard.svelte";
	import InfiniteScroll from "$lib/components/InfiniteScroll.svelte";
	import Slideshow from "$lib/components/Slideshow.svelte";
	import type { TumblrPost, PostFilter } from "$lib/types";
	import {
		ArrowLeft,
		Trash2,
		HardDrive,
		Play,
		Filter,
	} from "@lucide/svelte";

	// Page rows over the cursor. 100 keeps a single IDB cursor walk small;
	// the page never holds more than `cachedPosts` worth of rows in JS.
	const PAGE_SIZE = 100;

type PostCursor = { cachedAt: number; id: number } | null;

	let cachedPosts = $state<TumblrPost[]>([]);
	let total = $state(0);
	let loading = $state(true);
	let loadingMore = $state(false);
	let error = $state<string | null>(null);
	let currentFilter = $state("all");
	let nextCursor = $state<PostCursor>(null);
	// Per-request token so out-of-order responses can't clobber state when the
	// user changes filters (or scrolls) faster than the DB replies.
	let loadToken = 0;

	let cacheStats = $state({ count: 0, estimatedMb: 0 });
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

	// Filters are evaluated at the storage layer, so the loaded subset is
	// already the filtered set. No in-memory JS filter loop anymore.
	let hasMore = $derived(nextCursor !== null);

async function loadPage(opts: { before?: PostCursor | null; append: boolean; filter: string }) {
	const token = ++loadToken;
	// `before` is `KeysetCursor | undefined`; passing `null` is a type error,
	// so we collapse it to `undefined` here.
	const result = await getCachedPostsPage({
		limit: PAGE_SIZE,
		before: opts.before ?? undefined,
		filter: opts.filter as PostFilter
	});
	// A newer request (filter change, refresh, etc.) has been issued; drop
	// this stale result so we don't intermix pages from different filters.
	if (token !== loadToken) return;

	if (opts.append) {
		cachedPosts = [...cachedPosts, ...result.entries.map((e) => e.post)];
	} else {
		cachedPosts = result.entries.map((e) => e.post);
	}
	total = result.total;
	nextCursor = (result.nextCursor as PostCursor | null) ?? null;
}

async function refreshAll() {
	loading = true;
	error = null;
	try {
		// Run the page load + the media stats query in parallel. The page
		// query goes through loadPage() so the loadToken guard rejects any
		// stale response (e.g. if a filter change raced with mount).
		await Promise.all([
			loadPage({ before: null, append: false, filter: currentFilter }),
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
		await loadPage({ before: nextCursor, append: true, filter: currentFilter });
	} catch (e) {
		error = e instanceof Error ? e.message : String(e);
	} finally {
		loadingMore = false;
	}
}

// Filter change: drop the loaded window, ask storage for the first page
// under the new filter. The total at the top of the page reflects the
// storage-side count, so the user sees the real filtered size.
$effect(() => {
	// Only re-run when the filter changes; `untrack` keeps the body off the
	// `loading`/`cachedPosts` reactive graph so the effect doesn't re-fire
	// when refreshAll() finishes its first load.
	const filter = untrack(() => currentFilter);
	const stillLoading = untrack(() => loading);
	if (stillLoading) return;
	loading = true;
	error = null;
	(async () => {
		try {
			await loadPage({ before: null, append: false, filter });
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	})();
});

let slideshowActive = $state(false);

let activeSlideshowPostId = $state<string | number | null>(null);
let slideshowStartPostId = $state<string | number | null>(null);
let slideshowStartMediaUrl = $state<string | null>(null);
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
	cachedPosts = [];
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
	void refreshAll();
	document.addEventListener("visibilitychange", onVisibilityChange);
});

onDestroy(() => {
	document.removeEventListener("visibilitychange", onVisibilityChange);
});
</script>


{#if error}
	<div class="alert alert-error shadow-lg mb-6 mx-4 mt-4">
		<span>Cache error: {error}</span>
	</div>
{/if}

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
									? (storageQuota.usageMb / 1024).toFixed(1) + " GB"
									: storageQuota.usageMb + " MB"} /
								{storageQuota.quotaMb >= 1024
									? (storageQuota.quotaMb / 1024).toFixed(0) + " GB"
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

			{#if total > 0}
				<div class="flex items-center gap-4">
					<div class="tabs tabs-boxed bg-gray-900 border border-gray-800 p-1 w-fit">
						<button
							class="tab {currentFilter === 'all' ? 'tab-active bg-primary text-white' : 'text-gray-400'}"
							onclick={() => (currentFilter = "all")}
						>All</button>
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
							slideshowStartMediaUrl = null;
							slideshowActive = true;
						}}
						disabled={cachedPosts.length === 0}
					>
						<Play size={16} /> Play Slideshow
					</button>
				</div>
			{/if}
		</div>
	</header>

	{#if loading && cachedPosts.length === 0}
		<div class="flex justify-center py-20 items-center">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:else if total === 0}
		<div class="hero py-20 rounded-3xl bg-base-200">
			<div class="hero-content text-center">
				<div class="max-w-md">
					<HardDrive size={48} class="mx-auto mb-4 text-gray-600" />
					<h2 class="text-3xl font-bold text-white">Cache is empty</h2>
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
			{#each cachedPosts as post (post.id)}
				<a
					id={"post-" + post.id}
					href={offlineHref(post)}
					data-sveltekit-preload-data="off"
					class="block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-xl"
					title="Open from offline cache"
				>
					<PostCard {post} mode="cache" onMediaClick={openSlideshowFromPost} />
				</a>
			{/each}
		</main>

		{#if cachedPosts.length === 0 && total > 0}
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
	posts={cachedPosts}
	onReachEnd={async () => {
		await loadMore();
	}}
/>
