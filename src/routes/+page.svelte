<script lang="ts">
	import { snapshot } from '$app/navigation';
	import { onMount, onDestroy, untrack } from 'svelte';
	import { browser } from '$app/env';
	import { settings } from '#lib/stores/settings';
	import { accounts, accountsReady } from '#lib/stores/accounts';
	import { bulkSetPosts } from '#lib/cache';
	import { refreshUnreferencedPosts } from '#lib/stores/unreferencedPosts';
	import { cacheAllVisible } from '#lib/cacheUtils';
	import PostGrid from '#lib/components/PostGrid.svelte';
	import InfiniteScroll from '#lib/components/InfiniteScroll.svelte';
	import Slideshow from '#lib/components/Slideshow.svelte';
	import { postId, type TumblrPost, type TumblrAccount } from '#lib/types';
	import {
		Plus,
		Download,
		Loader2,
		Play,
		Home,
		Layers,
		Image as ImageIcon,
		Video,
		Music,
		Quote,
		Link as LinkIcon,
		MessageSquare,
		HelpCircle,
		FileText,
		RefreshCw,
		ChevronLeft,
		ChevronRight,
		Settings
	} from '@lucide/svelte';

	const FILTERS: { value: string; label: string; icon: any }[] = [
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

	interface FeedState {
		posts: TumblrPost[];
		cursor: number | null;
		since: string | null;
		hasMore: boolean;
		loading: boolean;
		loaded: boolean;
		error: string;
		emptyPages: number;
	}

	function emptyFeed(): FeedState {
		return {
			posts: [],
			cursor: null,
			since: null,
			hasMore: true,
			loading: false,
			loaded: false,
			error: '',
			emptyPages: 0
		};
	}

	let currentFilter = $state('all');
	let isOffline = $state(false);
	let downloadingAll = $state(false);
	let downloadProgress = $state({ done: 0, total: 0 });
	let slideshowActive = $state(false);
	let activeSlideshowPostId = $state<string | null>(null);
	let slideshowStartPostId = $state<string | null>(null);
	let slideshowStartMediaUrl = $state<string | null>(null);
	let newPostsAvailable = $state(false);
	let lastRefreshAt = 0;
	let activeBlog = $state('');
	let feeds = $state<Record<string, FeedState>>({});
	let tabStrip = $state<HTMLElement | null>(null);

	let activeAccounts = $derived<TumblrAccount[]>($accounts.filter((account) => account.active));
	let activeFeed = $derived(feeds[activeBlog] ?? emptyFeed());
	let activePosts = $derived(activeFeed.posts);
	let loadingActive = $derived(activeFeed.loading);

	const generations = new Map<string, number>();
	const controllers = new Map<string, AbortController>();
	let lastKey = '';
	let restored = false;

	function accountTabId(blogName: string): string {
		return `account-tab-${blogName}`;
	}

	function feedKey(): string {
		return `${activeAccounts.map((account) => account.blogName).sort().join('|')}|${currentFilter}`;
	}

	function ensureFeed(blogName: string): FeedState {
		let feed = feeds[blogName];
		if (!feed) {
			feed = emptyFeed();
			feeds[blogName] = feed;
		}
		return feed;
	}

	async function loadFeed(
		blogName: string,
		options: { reset?: boolean; topUp?: boolean } = {}
	): Promise<void> {
		const account = activeAccounts.find((candidate) => candidate.blogName === blogName);
		if (!account || typeof navigator === 'undefined') return;

		const feed = ensureFeed(blogName);
		if (feed.loading && !options.reset && !options.topUp) return;
		if (!options.reset && !options.topUp && !feed.hasMore) return;

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
			feed.cursor = null;
			feed.since = null;
			feed.hasMore = true;
			feed.loaded = false;
			feed.emptyPages = 0;
		}

		try {
			const response = await fetch('/api/posts/dashboard', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				signal: controller.signal,
				body: JSON.stringify({
					accounts: [account],
					offsets: !options.topUp && feed.cursor !== null ? { [blogName]: feed.cursor } : {},
					since_ids: options.topUp && feed.since ? { [blogName]: feed.since } : {},
					type: currentFilter === 'all' ? null : currentFilter
				})
			});
			if (!response.ok) throw new Error(`Failed to load posts (${response.status})`);

			const data = await response.json();
			if (generation !== generations.get(blogName)) return;

			const group = (data.groups ?? []).find(
				(candidate: { blogName: string }) => candidate.blogName === blogName
			) ?? data.groups?.[0];
			if (!group) throw new Error('The server returned no account stream');
			if (!group.ok) {
				feed.error = group.error ?? 'Could not load this account';
				feed.loaded = true;
				feed.hasMore = false;
				return;
			}

			const incoming = (group.posts ?? []) as TumblrPost[];
			const existing = new Set(feed.posts.map(postId));

			if (options.topUp) {
				const fresh = incoming.filter((post) => !existing.has(postId(post)));
				feed.posts = [...fresh, ...feed.posts];
				if (group.newSinceId) feed.since = group.newSinceId;
			} else {
				const fresh = incoming.filter((post) => !existing.has(postId(post)));
				feed.posts = [...feed.posts, ...fresh];
				if (group.newOffset !== undefined) feed.cursor = group.newOffset;
				if (group.newSinceId) feed.since = group.newSinceId;

				if (incoming.length === 0) {
					feed.hasMore = false;
				} else if (fresh.length === 0) {
					feed.emptyPages++;
					if (feed.emptyPages >= 2) feed.hasMore = false;
				} else {
					feed.emptyPages = 0;
				}
			}

			feed.loaded = true;
			lastRefreshAt = Date.now();
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
		newPostsAvailable = false;
		const feed = feeds[blogName];
		if (!feed?.loaded && !feed?.loading) void loadFeed(blogName);
	}

	function scrollTabs(direction: number): void {
		tabStrip?.scrollBy({ left: direction * 240, behavior: 'smooth' });
	}

	$effect(() => {
		const key = feedKey();
		if (!browser) return;

		untrack(() => {
			if (restored) {
				if (!$accountsReady) return;
				if (!activeAccounts.some((account) => account.blogName === activeBlog)) {
					activeBlog = activeAccounts[0]?.blogName ?? '';
				}
				restored = false;
				lastKey = key;
				return;
			}
			if (key === lastKey) return;
			lastKey = key;

			// Account set or filter changed: discard per-account pages and start
			// fresh for the active account. Other tabs load when selected.
			for (const controller of controllers.values()) controller.abort();
			controllers.clear();
			feeds = {};
			if (!activeAccounts.some((account) => account.blogName === activeBlog)) {
				activeBlog = activeAccounts[0]?.blogName ?? '';
			}
			if (activeBlog) void loadFeed(activeBlog, { reset: true });
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
		await cacheAllVisible(activePosts, (progress) => {
			downloadProgress = progress;
		});
		downloadingAll = false;
	}

	function openSlideshowFromPost(post: TumblrPost, mediaUrl?: string): void {
		slideshowStartPostId = postId(post);
		slideshowStartMediaUrl = mediaUrl ?? null;
		slideshowActive = true;
	}

	async function refreshFeed(): Promise<void> {
		newPostsAvailable = false;
		if (!activeBlog) return;
		await loadFeed(activeBlog, { topUp: feeds[activeBlog]?.loaded === true });
	}

	function maybeTopUp(): void {
		if (!activeBlog || isOffline) return;
		if (Date.now() - lastRefreshAt < 60_000) return;
		if (browser && window.scrollY > 400) {
			newPostsAvailable = true;
			return;
		}
		void loadFeed(activeBlog, { topUp: true });
	}

	function showNewPosts(): void {
		newPostsAvailable = false;
		window.scrollTo({ top: 0, behavior: 'smooth' });
		void loadFeed(activeBlog, { topUp: true });
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
			void refreshFeed();
		};
		const onOffline = () => {
			isOffline = true;
		};
		const onVisible = () => {
			if (document.visibilityState === 'visible') maybeTopUp();
		};

		window.addEventListener('online', onOnline);
		window.addEventListener('offline', onOffline);
		document.addEventListener('visibilitychange', onVisible);

		return () => {
			window.removeEventListener('online', onOnline);
			window.removeEventListener('offline', onOffline);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});

	onDestroy(() => {
		for (const controller of controllers.values()) controller.abort();
	});

	function handleAddAccount(): void {
		window.location.href = '/api/auth/tumblr';
	}
</script>

<div class="min-h-dvh p-4 md:p-8 bg-black">
	{#if isOffline}
		<div class="alert alert-warning shadow-lg mb-6">
			<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
			<span>You are offline. Only the <a href="/caches" class="font-bold underline text-primary">Media Cache</a> is available right now.</span>
		</div>
	{/if}

	<header class="mb-8 flex flex-col gap-4">
		<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
			<div>
				<h1 class="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
					<Home size={32} class="text-blue-500" />
					Feed
				</h1>
				<p class="text-gray-400 mt-1">Per-account streams in the order Tumblr returns them.</p>
			</div>
			<div class="flex items-center gap-2">
				<button class="btn btn-sm btn-outline btn-info gap-2" onclick={handleAddAccount}>
					<Plus size={16} /> Add Account
				</button>
				<a class="btn btn-sm btn-outline gap-2 border-gray-600 hover:bg-gray-800 text-gray-300" href="/accounts">
					<Settings size={16} /> Manage
				</a>
			</div>
		</div>

		{#if activeAccounts.length > 0}
			<div class="flex items-center gap-2 w-full">
				<button
					class="btn btn-ghost btn-sm btn-square text-gray-400 shrink-0"
					onclick={() => scrollTabs(-1)}
					aria-label="Scroll accounts left"
				>
					<ChevronLeft size={18} />
				</button>
				<div
					bind:this={tabStrip}
					class="flex min-w-0 flex-1 gap-2 overflow-x-auto scroll-smooth hide-scrollbar py-1"
					role="tablist"
					aria-label="Accounts"
				>
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
				<button
					class="btn btn-ghost btn-sm btn-square text-gray-400 shrink-0"
					onclick={() => scrollTabs(1)}
					aria-label="Scroll accounts right"
				>
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

				<div class="flex items-center gap-2 w-full sm:w-auto justify-end">
					<button
						class="btn btn-sm btn-outline gap-1 border-gray-600 hover:bg-gray-800 text-gray-300"
						onclick={() => void refreshFeed()}
						disabled={loadingActive || isOffline}
						title="Refresh account"
					>
						<RefreshCw size={16} class={loadingActive ? 'animate-spin' : ''} />
					</button>
					<button
						class="btn btn-sm btn-outline gap-1 border-gray-600 hover:bg-gray-800 text-gray-300 flex-1 sm:flex-none"
						onclick={() => { slideshowStartPostId = null; slideshowStartMediaUrl = null; slideshowActive = true; }}
						disabled={activePosts.length === 0}
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
	</header>

	{#if newPostsAvailable}
		<button class="btn btn-sm btn-primary mb-4 mx-auto flex" onclick={showNewPosts}>
			<RefreshCw size={14} /> New posts available
		</button>
	{/if}

	{#if downloadingAll}
		<div class="mb-6 bg-gray-900 rounded-full h-2 overflow-hidden border border-gray-800">
			<div
				class="h-full bg-primary transition-all duration-300 rounded-full"
				style="width: {downloadProgress.total > 0 ? (downloadProgress.done / downloadProgress.total * 100) : 0}%"
			></div>
		</div>
	{/if}

	{#if $accountsReady && $accounts.length === 0}
		<div class="hero min-h-[50dvh] rounded-3xl bg-base-200">
			<div class="hero-content text-center">
				<div class="max-w-md">
					<h1 class="text-5xl font-bold text-white">Welcome!</h1>
					<p class="py-6">Connect an account to see your chronological feed.</p>
					<button class="btn btn-primary" onclick={handleAddAccount}>Connect account</button>
				</div>
			</div>
		</div>
	{:else if activeAccounts.length === 0}
		<div class="flex items-center justify-center h-64 text-gray-500">
			Please activate at least one account to view the feed.
		</div>
	{:else if !activeBlog}
		<div class="flex items-center justify-center h-64 text-gray-500">
			Select an account to view its feed.
		</div>
	{:else}
		{#if activeFeed.error && !isOffline}
			<div class="alert alert-error shadow-lg mb-6">
				<span>{activeFeed.error}</span>
			</div>
		{/if}

		{#if activeFeed.loading && activePosts.length === 0}
			<div class="flex justify-center py-20">
				<span class="loading loading-spinner loading-lg text-primary"></span>
			</div>
		{:else if activeFeed.loaded && activePosts.length === 0}
			<div class="py-20 text-center text-gray-500">
				No posts in this account’s feed.
			</div>
		{:else}
			<main>
				<PostGrid
					posts={activePosts}
					columnSetting={$settings.mediaColumns}
					onMediaClick={openSlideshowFromPost}
				/>
			</main>
		{/if}

		<InfiniteScroll
			hasMore={activeFeed.hasMore}
			loading={activeFeed.loading}
			onload={() => void loadFeed(activeBlog)}
		/>
	{/if}
</div>

<Slideshow
	bind:active={slideshowActive}
	bind:activePostId={activeSlideshowPostId}
	startPostId={slideshowStartPostId}
	startMediaUrl={slideshowStartMediaUrl}
	posts={activePosts}
	onReachEnd={async () => { await loadFeed(activeBlog); }}
/>
