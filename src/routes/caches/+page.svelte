<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { browser } from '$app/env';
	import { settings } from '#lib/stores/settings';
	import { getCachedPostsPage, clearCache, getMediaCacheStats } from '#lib/cache';
	import { refreshUnreferencedPosts } from '#lib/stores/unreferencedPosts';
	import type { PostFilter } from '#lib/postFilter';
	import PostGrid from '#lib/components/PostGrid.svelte';
	import InfiniteScroll from '#lib/components/InfiniteScroll.svelte';
	import Slideshow from '#lib/components/Slideshow.svelte';
	import { postId, type TumblrPost } from '#lib/types';
	import { ArrowLeft, Trash2, HardDrive, Play, Filter, Layers, Image as ImageIcon, Video, Music, Quote, Link as LinkIcon, MessageSquare, HelpCircle, FileText, Heart, UserSquare, Library } from '@lucide/svelte';

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

	const SOURCE_FILTERS: { value: 'all' | 'faves' | 'blogs'; label: string; icon: any }[] = [
		{ value: 'all', label: 'All Sources', icon: Library },
		{ value: 'faves', label: 'Faves', icon: Heart },
		{ value: 'blogs', label: 'Blogs', icon: UserSquare }
	];

	const PAGE_SIZE = 100;
	type PostCursor = { cachedAt: number; id: string; sortTimestamp?: number } | null;

	let posts: TumblrPost[] = $state([]);
	let loading = $state(true);
	let loadingMore = $state(false);
	let total = $state(0);
	let nextCursor = $state<PostCursor>(null);
	let hasMore = $derived(nextCursor !== null);
	let error = $state('');
	let loadToken = 0;

	let cacheStats = $state({ count: 0, estimatedMb: 0 });
	let storageQuota = $state({ usageMb: 0, quotaMb: 0, pct: 0, persisted: false });

	let slideshowActive = $state(false);
	let activeSlideshowPostId = $state<string | null>(null);
	let slideshowStartPostId = $state<string | null>(null);
	let slideshowStartMediaUrl = $state<string | null>(null);

	let currentFilter = $state<PostFilter>('all');
	let currentSourceFilter = $state<'all' | 'faves' | 'blogs'>('all');

	async function refreshStorageQuota() {
		if (!navigator.storage?.estimate) return;
		const { usage = 0, quota = 1 } = await navigator.storage.estimate();
		const usageMb = Math.round((usage / 1024 / 1024) * 10) / 10;
		const quotaMb = Math.round((quota / 1024 / 1024) * 10) / 10;
		let persisted = false;
		try {
			persisted = (await navigator.storage.persisted?.()) ?? false;
		} catch {
			// persisted() unsupported
		}
		storageQuota = {
			usageMb,
			quotaMb,
			pct: Math.min(100, Math.round((usage / quota) * 100)),
			persisted
		};
	}

	async function loadPage(opts: {
		before?: PostCursor | null;
		append: boolean;
		filter: PostFilter;
		sourceFilter: 'all' | 'faves' | 'blogs';
	}) {
		const token = ++loadToken;
		const result = await getCachedPostsPage({
			limit: PAGE_SIZE,
			before: opts.before ?? undefined,
			filter: opts.filter,
			sourceFilter: opts.sourceFilter
		});

		if (token !== loadToken) return;

		if (opts.append) {
			posts = [...posts, ...result.entries.map((entry) => entry.post)];
		} else {
			posts = result.entries.map((entry) => entry.post);
		}
		total = result.total;
		nextCursor = (result.nextCursor as PostCursor | null) ?? null;
	}

	async function refreshAll() {
		loading = true;
		error = '';
		try {
			await Promise.all([
				loadPage({
					before: null,
					append: false,
					filter: currentFilter,
					sourceFilter: currentSourceFilter
				}),
				getMediaCacheStats().then((stats) => (cacheStats = stats))
			]);
			await refreshStorageQuota();
			await refreshUnreferencedPosts();
		} catch (caught) {
			error = caught instanceof Error ? caught.message : String(caught);
		} finally {
			loading = false;
		}
	}

	async function loadMore() {
		if (loadingMore || !hasMore || nextCursor === null) return;
		loadingMore = true;
		try {
			await loadPage({
				before: nextCursor,
				append: true,
				filter: currentFilter,
				sourceFilter: currentSourceFilter
			});
		} catch (caught) {
			error = caught instanceof Error ? caught.message : String(caught);
		} finally {
			loadingMore = false;
		}
	}

	$effect(() => {
		const filter = currentFilter;
		const source = currentSourceFilter;
		untrack(() => {
			if (browser) {
				loadPage({ before: null, append: false, filter, sourceFilter: source }).catch((caught) => {
					error = caught instanceof Error ? caught.message : String(caught);
				});
			}
		});
	});

	function openSlideshowFromPost(post: TumblrPost, mediaUrl?: string) {
		slideshowStartPostId = postId(post);
		slideshowStartMediaUrl = mediaUrl ?? null;
		slideshowActive = true;
	}

	function offlineHref(post: TumblrPost): string {
		const blog = post?.blog_name;
		if (!blog) return '#';
		return `/post/${blog}/${postId(post)}?offline=1`;
	}

	async function handleClear() {
		if (!confirm('Clear all cached posts and blobs?')) return;
		await clearCache();
		posts = [];
		total = 0;
		nextCursor = null;
		cacheStats = { count: 0, estimatedMb: 0 };
		storageQuota = {
			usageMb: 0,
			quotaMb: storageQuota.quotaMb,
			pct: 0,
			persisted: storageQuota.persisted
		};
		await refreshStorageQuota();
		await refreshUnreferencedPosts();
	}

	function onVisibilityChange() {
		if (document.visibilityState === 'visible') void refreshAll();
	}

	$effect(() => {
		if (!slideshowActive && activeSlideshowPostId) {
			const element = document.getElementById(`post-${activeSlideshowPostId}`);
			element?.scrollIntoView({ behavior: 'instant', block: 'center' });
			activeSlideshowPostId = null;
		}
	});

	onMount(() => {
		if (!browser) return;
		void refreshAll();
		document.addEventListener('visibilitychange', onVisibilityChange);
		return () => {
			document.removeEventListener('visibilitychange', onVisibilityChange);
		};
	});
</script>

<div class="min-h-dvh p-4 md:p-8 bg-black">
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
							<span class="text-sm font-black text-white leading-none">
								{storageQuota.pct}%{#if storageQuota.persisted}<span class="ml-1 text-[10px] text-green-500" title="Storage is persisted — protected from eviction">◆</span>{/if}
							</span>
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
					<a href="/" class="btn btn-primary">Go to Feed</a>
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
			<PostGrid
				posts={posts}
				columnSetting={$settings.mediaColumns}
				mode="cache"
				hrefFor={offlineHref}
				onMediaClick={openSlideshowFromPost}
			/>
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
