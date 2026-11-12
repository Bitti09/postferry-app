<script lang="ts">
	import { snapshot } from '$app/navigation';
	import { onMount, onDestroy, untrack } from 'svelte';
	import { browser } from '$app/env';
	import { accounts, accountsReady } from '#lib/stores/accounts';
	import { settings } from '#lib/stores/settings';
	import { cacheAllVisible } from '#lib/cacheUtils';
	import { filterPosts, type PostFilter } from '#lib/postFilter';
	import { bulkSetPosts } from '#lib/cache';
	import { refreshUnreferencedPosts } from '#lib/stores/unreferencedPosts';
	import { postId, type TumblrPost, type TumblrAccount } from '#lib/types';
	import InfiniteScroll from '#lib/components/InfiniteScroll.svelte';
	import PostGrid from '#lib/components/PostGrid.svelte';
	import Slideshow from '#lib/components/Slideshow.svelte';
	import {
		Heart,
		Download,
		Loader2,
		Play,
		Layers, Image as ImageIcon, Video, Music, Quote, Link as LinkIcon, MessageSquare, HelpCircle, FileText,
		Settings,
		ChevronLeft,
		ChevronRight,
		RefreshCw
	} from '@lucide/svelte';

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

	interface LikesFeed {
		posts: TumblrPost[];
		before: number | null;
		hasMore: boolean;
		loading: boolean;
		loaded: boolean;
		error: string;
		emptyPages: number;
	}

	function emptyFeed(): LikesFeed {
		return {
			posts: [],
			before: null,
			hasMore: true,
			loading: false,
			loaded: false,
			error: '',
			emptyPages: 0
		};
	}

	let currentFilter = $state<PostFilter>('all');
	let isOffline = $state(false);
	let slideshowActive = $state(false);
	let activeSlideshowPostId = $state<string | null>(null);
	let slideshowStartPostId = $state<string | null>(null);
	let slideshowStartMediaUrl = $state<string | null>(null);
	let likesScrollContainer = $state<HTMLElement | null>(null);
	let tabStrip = $state<HTMLElement | null>(null);
	let activeBlog = $state('');
	let feeds = $state<Record<string, LikesFeed>>({});
	let downloadingAll = $state(false);
	let downloadProgress = $state({ done: 0, total: 0 });

	let activeAccounts = $derived<TumblrAccount[]>($accounts.filter((account) => account.active));
	let activeFeed = $derived(feeds[activeBlog] ?? emptyFeed());
	let activePosts = $derived(activeFeed.posts);
	let filteredLikes = $derived(filterPosts(activePosts, currentFilter));
	let loading = $derived(activeFeed.loading);

	const generations = new Map<string, number>();
	const controllers = new Map<string, AbortController>();
	let lastKey = '';
	let restored = false;

	function accountTabId(blogName: string): string {
		return `likes-tab-${blogName}`;
	}

	function accountKey(): string {
		return activeAccounts.map((account) => account.blogName).sort().join('|');
	}

	function ensureFeed(blogName: string): LikesFeed {
		let feed = feeds[blogName];
		if (!feed) {
			feed = emptyFeed();
			feeds[blogName] = feed;
		}
		return feed;
	}

	async function loadLikes(
		blogName: string,
		options: { reset?: boolean } = {}
	): Promise<void> {
		const account = activeAccounts.find((candidate) => candidate.blogName === blogName);
		if (!account || typeof navigator === 'undefined') return;

		const feed = ensureFeed(blogName);
		if (feed.loading && !options.reset) return;
		if (!options.reset && !feed.hasMore) return;
		if (!navigator.onLine) {
			feed.error = 'Offline';
			feed.loading = false;
			return;
		}

		const generation = (generations.get(blogName) ?? 0) + 1;
		generations.set(blogName, generation);
		controllers.get(blogName)?.abort();
		const controller = new AbortController();
		controllers.set(blogName, controller);

		feed.loading = true;
		feed.error = '';
		if (options.reset) {
			feed.posts = [];
			feed.before = null;
			feed.hasMore = true;
			feed.loaded = false;
			feed.emptyPages = 0;
		}

		try {
			const response = await fetch('/api/user/likes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				signal: controller.signal,
				body: JSON.stringify({
					accounts: [account],
					before: feed.before !== null ? { [blogName]: feed.before } : {}
				})
			});
			if (!response.ok) throw new Error(`Failed to load likes (${response.status})`);

			const data = await response.json();
			if (generation !== generations.get(blogName)) return;

			const group = (data.groups ?? []).find(
				(candidate: { blogName: string }) => candidate.blogName === blogName
			) ?? data.groups?.[0];
			if (!group) throw new Error('The server returned no likes stream');
			if (!group.ok) {
				feed.error = group.error ?? 'Could not load this account';
				feed.loaded = true;
				feed.hasMore = false;
				return;
			}

			const incoming = (group.posts ?? []) as TumblrPost[];
			const existing = new Set(feed.posts.map(postId));
			const fresh = incoming.filter((post) => !existing.has(postId(post)));
			feed.posts = [...feed.posts, ...fresh];
			if (group.newBefore !== undefined) feed.before = Number(group.newBefore);
			if (incoming.length === 0) {
				feed.hasMore = false;
			} else if (fresh.length === 0 || group.newBefore === undefined) {
				feed.emptyPages++;
				if (feed.emptyPages >= 2 || group.newBefore === undefined) feed.hasMore = false;
			} else {
				feed.emptyPages = 0;
			}
			feed.loaded = true;
			if (incoming.length > 0) {
				void bulkSetPosts(incoming).then(() => refreshUnreferencedPosts());
			}
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') return;
			if (generation !== generations.get(blogName)) return;
			feed.error = error instanceof Error ? error.message : String(error);
		} finally {
			if (generation === generations.get(blogName)) feed.loading = false;
		}
	}

	function activateAccount(blogName: string): void {
		activeBlog = blogName;
		const feed = feeds[blogName];
		if (!feed?.loaded && !feed?.loading) void loadLikes(blogName);
	}

	function scrollTabs(direction: number): void {
		tabStrip?.scrollBy({ left: direction * 240, behavior: 'smooth' });
	}

	$effect(() => {
		const key = accountKey();
		if (!browser) return;
		untrack(() => {
			if (restored) {
				if (!$accountsReady) return;
				restored = false;
				lastKey = key;
				return;
			}
			if (key === lastKey) return;
			lastKey = key;
			for (const controller of controllers.values()) controller.abort();
			controllers.clear();
			feeds = {};
			if (!activeAccounts.some((account) => account.blogName === activeBlog)) {
				activeBlog = activeAccounts[0]?.blogName ?? '';
			}
			if (activeBlog) void loadLikes(activeBlog, { reset: true });
		});
	});

	snapshot({
		capture: () => ({
			activeBlog,
			filter: currentFilter,
			feeds: $state.snapshot(feeds)
		}),
		restore: (value: any) => {
			if (!value) return;
			activeBlog = value.activeBlog ?? '';
			currentFilter = value.filter ?? 'all';
			feeds = value.feeds ?? {};
			for (const feed of Object.values(feeds)) {
				feed.loading = false;
				feed.error = '';
			}
			restored = true;
		}
	});

	$effect(() => {
		if (!browser || !activeBlog) return;
		document
			.getElementById(accountTabId(activeBlog))
			?.scrollIntoView({ inline: 'center', block: 'nearest' });
	});

	async function startCacheAll(): Promise<void> {
		if (downloadingAll) return;
		downloadingAll = true;
		await cacheAllVisible(filteredLikes, (progress) => {
			downloadProgress = progress;
		});
		downloadingAll = false;
	}

	function openSlideshowFromPost(post: TumblrPost, mediaUrl?: string): void {
		slideshowStartPostId = postId(post);
		slideshowStartMediaUrl = mediaUrl ?? null;
		slideshowActive = true;
	}

	async function refreshActive(): Promise<void> {
		if (activeBlog) await loadLikes(activeBlog, { reset: true });
	}

	onMount(() => {
		isOffline = !navigator.onLine;
		const onOnline = () => {
			isOffline = false;
			void refreshActive();
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

	onDestroy(() => {
		for (const controller of controllers.values()) controller.abort();
	});
</script>

<div class="h-[calc(100dvh-7.5rem)] flex flex-col p-4 md:p-8 bg-black overflow-hidden">
	{#if isOffline}
		<div class="alert alert-warning shadow-lg mb-6">
			<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
			<span>You are offline. Only the <a href="/caches" class="font-bold underline text-primary">Media Cache</a> is available right now.</span>
		</div>
	{/if}

	<header class="mb-6 shrink-0 flex flex-col gap-3">
		<div class="flex items-start justify-between gap-4">
			<div>
				<h1 class="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
					<Heart size={32} class="text-pink-500" />
					Your Favourites
				</h1>
				<p class="text-gray-400 mt-1">Per-account likes, in the order Tumblr returns them.</p>
			</div>
			<a class="btn btn-sm btn-outline gap-2 border-gray-600 hover:bg-gray-800 text-gray-300" href="/accounts">
				<Settings size={16} /> Manage
			</a>
		</div>

		{#if activeAccounts.length > 0}
			<div class="flex items-center gap-2 w-full">
				<button class="btn btn-ghost btn-sm btn-square text-gray-400 shrink-0" onclick={() => scrollTabs(-1)} aria-label="Scroll accounts left">
					<ChevronLeft size={18} />
				</button>
				<div bind:this={tabStrip} class="flex min-w-0 flex-1 gap-2 overflow-x-auto scroll-smooth hide-scrollbar py-1" role="tablist" aria-label="Accounts">
					{#each activeAccounts as account}
						<button
							id={accountTabId(account.blogName)}
							role="tab"
							aria-selected={activeBlog === account.blogName}
							class="shrink-0 rounded-lg border px-3 py-2 text-sm font-bold transition-colors {activeBlog === account.blogName
								? 'border-primary bg-primary text-white'
								: 'border-gray-800 bg-gray-900 text-gray-400 hover:text-white'}"
							onclick={() => activateAccount(account.blogName)}
							title={account.blogName}
						>
							{account.blogName}
						</button>
					{/each}
				</div>
				<button class="btn btn-ghost btn-sm btn-square text-gray-400 shrink-0" onclick={() => scrollTabs(1)} aria-label="Scroll accounts right">
					<ChevronRight size={18} />
				</button>
			</div>

			<div class="flex flex-col sm:flex-row items-start sm:items-center gap-3 justify-between">
				<div class="tabs tabs-boxed bg-gray-900 border border-gray-800 p-1 flex-nowrap overflow-x-auto w-full sm:w-auto max-w-full hide-scrollbar justify-start">
					{#each FILTERS as filter}
						{@const Icon = filter.icon}
						<button
							class="tab flex-1 whitespace-nowrap flex items-center justify-center gap-2 {currentFilter === filter.value ? 'tab-active bg-primary text-white' : 'text-gray-400'}"
							onclick={() => { currentFilter = filter.value; }}
							title={filter.label}
						>
							<Icon size={14} />
							<span class="hidden sm:inline">{filter.label}</span>
						</button>
					{/each}
				</div>
				<div class="flex items-center gap-2 w-full sm:w-auto justify-end flex-wrap">
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
					<button class="btn btn-sm btn-outline gap-1 border-gray-600 hover:bg-gray-800 text-gray-300" onclick={() => void refreshActive()} disabled={loading || isOffline} title="Refresh account">
						<RefreshCw size={16} class={loading ? 'animate-spin' : ''} />
					</button>
					<button
						class="btn btn-sm btn-outline gap-1 border-gray-600 hover:bg-gray-800 text-gray-300 flex-1 sm:flex-none"
						onclick={() => { slideshowStartPostId = null; slideshowStartMediaUrl = null; slideshowActive = true; }}
						disabled={filteredLikes.length === 0}
					>
						<Play size={16} /> <span class="hidden sm:inline">Play Slideshow</span><span class="sm:hidden">Play</span>
					</button>
					<button class="btn btn-sm btn-primary gap-1 flex-1 sm:flex-none" onclick={startCacheAll} disabled={downloadingAll || isOffline}>
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
	</header>

	{#if downloadingAll}
		<div class="mb-6 bg-gray-900 rounded-full h-2 overflow-hidden border border-gray-800">
			<div class="h-full bg-primary transition-all duration-300 rounded-full" style="width: {downloadProgress.total > 0 ? (downloadProgress.done / downloadProgress.total) * 100 : 0}%"></div>
		</div>
	{/if}

	{#if activeAccounts.length === 0}
		<div class="flex items-center justify-center h-64 text-gray-500">
			Please activate an account to view your favourites.
		</div>
	{:else if !activeBlog}
		<div class="flex items-center justify-center h-64 text-gray-500">
			Select an account to view its favourites.
		</div>
	{:else}
		{#if activeFeed.error && !isOffline}
			<div class="alert alert-error mb-6">{activeFeed.error}</div>
		{/if}

		{#if filteredLikes.length === 0 && !loading && activeFeed.loaded}
			<div class="py-20 flex-1 flex items-center justify-center text-gray-500">
				No favourited posts match the current filter.
			</div>
		{:else if activeFeed.loading && activePosts.length === 0}
			<div class="flex-1 flex items-center justify-center">
				<span class="loading loading-spinner loading-lg text-primary"></span>
			</div>
		{:else}
			<div bind:this={likesScrollContainer} class="flex-1 overflow-y-auto pr-2 pb-20">
				<PostGrid
					posts={filteredLikes}
					columnSetting={$settings.mediaColumns}
					onMediaClick={openSlideshowFromPost}
					scroll="container"
					scrollElement={likesScrollContainer}
					cardClass="shadow-lg rounded-lg overflow-hidden transition-transform hover:scale-[1.02]"
				/>
				<InfiniteScroll hasMore={activeFeed.hasMore} {loading} onload={() => void loadLikes(activeBlog)} />
			</div>
		{/if}
	{/if}
</div>

<Slideshow
	bind:active={slideshowActive}
	bind:activePostId={activeSlideshowPostId}
	startPostId={slideshowStartPostId}
	startMediaUrl={slideshowStartMediaUrl}
	posts={filteredLikes}
	onReachEnd={async () => { if (activeBlog) await loadLikes(activeBlog); }}
/>
