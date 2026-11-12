<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { browser } from '$app/env';
	import { page } from '$app/state';
	import { accounts } from '#lib/stores/accounts';
	import { cacheAllVisible } from '#lib/cacheUtils';
	import { bulkSetPosts } from '#lib/cache';
	import { settings } from '#lib/stores/settings';
	import { filterPosts, type PostFilter } from '#lib/postFilter';
	import { createPagedFeed } from '#lib/feed/pagedFeed.svelte';
	import { combineFeedPosts } from 'postferry';
	import { postId, type TumblrPost } from '#lib/types';
	import PostGrid from '#lib/components/PostGrid.svelte';
	import InfiniteScroll from '#lib/components/InfiniteScroll.svelte';
	import Slideshow from '#lib/components/Slideshow.svelte';
	import { Search, Loader2, Play, Download, Layers, Image as ImageIcon, Video, Music, Quote, Link as LinkIcon, MessageSquare, HelpCircle, FileText } from '@lucide/svelte';

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

	let query = $state('');
	let submittedQuery = $state('');
	let searchNonce = $state(0);
	let currentFilter = $state<PostFilter>('all');
	let error = $state('');
	let isOffline = $state(false);
	let slideshowActive = $state(false);
	let activeSlideshowPostId = $state<string | null>(null);
	let slideshowStartPostId = $state<string | null>(null);
	let slideshowStartMediaUrl = $state<string | null>(null);
	let downloadingAll = $state(false);
	let downloadProgress = $state({ done: 0, total: 0 });

	let activeAccount = $derived($accounts.find((account) => account.active));

	const feed = createPagedFeed<TumblrPost>({
		idOf: postId,
		merge: combineFeedPosts,
		loadPage: async ({ cursors, signal }) => {
			if (!activeAccount || !submittedQuery) return { items: [] };
			if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('Offline');

			const response = await fetch('/api/search', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				signal,
				body: JSON.stringify({
					accounts: [activeAccount],
					query: submittedQuery,
					// /tagged paginates by timestamp; the endpoint has no `type`
					// parameter, so filtering happens locally.
					before: cursors.before
				})
			});
			if (!response.ok) {
				throw new Error(`Search failed (${response.status}): ${await response.text()}`);
			}

			const payload = await response.json();
			const items = (Array.isArray(payload) ? payload : (payload.posts ?? [])) as TumblrPost[];
			if (items.length > 0) void bulkSetPosts(items);

			const last = items[items.length - 1] as (TumblrPost & { featured_timestamp?: number }) | undefined;
			const before = last?.featured_timestamp ?? last?.timestamp;
			return {
				items,
				cursors: before !== undefined ? { before } : undefined
			};
		}
	});

	let filteredPosts = $derived(filterPosts(feed.items, currentFilter));
	let loading = $derived(feed.loading);

	let lastKey = '';
	let lastUrlQuery = '';
	$effect(() => {
		const key = `${submittedQuery}|${activeAccount?.blogName ?? ''}|${searchNonce}`;
		if (!browser) return;
		untrack(() => {
			if (!submittedQuery) {
				lastKey = key;
				return;
			}
			if (key === lastKey) return;
			lastKey = key;
			void feed.reset();
		});
	});

	// Handle a query supplied via the URL (`/search?q=tag`).
	$effect(() => {
		const q = page.url.searchParams.get('q') ?? '';
		if (!q || !activeAccount || q === lastUrlQuery) return;
		untrack(() => {
			lastUrlQuery = q;
			query = q;
			submittedQuery = q;
			searchNonce++;
		});
	});

	function performSearch(reset = true): void {
		const next = query.trim();
		if (!next) return;
		if (!reset) {
			void feed.loadMore();
			return;
		}
		submittedQuery = next;
		searchNonce++;
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter') performSearch(true);
	}

	async function startCacheAll() {
		if (downloadingAll) return;
		downloadingAll = true;
		await cacheAllVisible(filteredPosts, (progress) => {
			downloadProgress = progress;
		});
		downloadingAll = false;
	}

	function openSlideshowFromPost(post: TumblrPost, mediaUrl?: string) {
		slideshowStartPostId = postId(post);
		slideshowStartMediaUrl = mediaUrl ?? null;
		slideshowActive = true;
	}

	$effect(() => {
		if (!slideshowActive && activeSlideshowPostId) {
			const element = document.getElementById(`post-${activeSlideshowPostId}`);
			element?.scrollIntoView({ behavior: 'instant', block: 'center' });
			activeSlideshowPostId = null;
		}
	});

	onMount(() => {
		isOffline = !navigator.onLine;
		const onOnline = () => {
			isOffline = false;
		};
		const onOffline = () => {
			isOffline = true;
		};
		window.addEventListener('online', onOnline);
		window.addEventListener('offline', onOffline);
		return () => {
			window.removeEventListener('online', onOnline);
			window.removeEventListener('offline', onOffline);
		};
	});

	onDestroy(() => feed.destroy());
</script>

<div class="min-h-dvh p-4 md:p-8 bg-black text-white pb-20">
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
							$accounts = $accounts.map((a) => ({ ...a, active: a.blogName === account.blogName }));
						}}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								$accounts = $accounts.map((a) => ({ ...a, active: a.blogName === account.blogName }));
							}
						}}
					>
						<Search size={12} />
						{account.blogName}
					</div>
				{/each}
			</div>

			<div class="flex items-center gap-4">
				<div class="tabs tabs-boxed bg-gray-900 border border-gray-800 p-1 flex-nowrap overflow-x-auto max-w-full hide-scrollbar justify-start">
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

				<div class="flex items-center gap-2">
					<button
						class="btn btn-sm btn-outline gap-2 border-gray-600 hover:bg-gray-800 text-gray-300"
						onclick={() => { slideshowStartPostId = null; slideshowStartMediaUrl = null; slideshowActive = true; }}
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

	{#if (feed.error || error) && !isOffline}
		<div class="alert alert-error mb-8 rounded-3xl shadow-xl">
			<span class="font-bold">{feed.error || error}</span>
		</div>
	{/if}

	<!-- Results Grid -->
	{#if filteredPosts.length > 0}
		<main>
			<PostGrid
				posts={filteredPosts}
				columnSetting={$settings.mediaColumns}
				onMediaClick={openSlideshowFromPost}
			/>
		</main>

		<InfiniteScroll hasMore={feed.hasMore} {loading} onload={feed.loadMore} />
	{:else if !loading && submittedQuery && feed.items.length > 0}
		<div class="flex flex-col items-center justify-center py-20 text-gray-500">
			<Search size={64} class="mb-4 opacity-20" />
			<p class="text-xl font-bold">No posts match this filter</p>
		</div>
	{:else if !loading && submittedQuery}
		<div class="flex flex-col items-center justify-center py-20 text-gray-500">
			<Search size={64} class="mb-4 opacity-20" />
			<p class="text-xl font-bold">No posts found for "{submittedQuery}"</p>
			<p class="text-sm">Try different tags or keywords.</p>
		</div>
	{:else if !loading}
		<div class="flex flex-col items-center justify-center py-20 text-gray-600">
			<Search size={64} class="mb-4 opacity-10" />
			<p class="text-xl font-black uppercase tracking-[0.2em]">Enter a query to start searching</p>
		</div>
	{/if}

	{#if loading && feed.items.length === 0 && submittedQuery}
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
		startMediaUrl={slideshowStartMediaUrl}
		posts={filteredPosts}
		onReachEnd={() => feed.loadMore()}
	/>
{/if}
