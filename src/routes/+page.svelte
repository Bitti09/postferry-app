<script lang="ts">
	import { snapshot } from '$app/navigation';
	import { onMount, onDestroy, untrack } from 'svelte';
	import { browser } from '$app/env';
	import { settings } from '#lib/stores/settings';
	import { accounts, accountsReady } from '#lib/stores/accounts';
	import { bulkSetPosts } from '#lib/cache';
	import { refreshUnreferencedPosts } from '#lib/stores/unreferencedPosts';
	import { cacheAllVisible } from '#lib/cacheUtils';
	import { filterPosts, type PostFilter } from '#lib/postFilter';
	import PostGrid from '#lib/components/PostGrid.svelte';
	import InfiniteScroll from '#lib/components/InfiniteScroll.svelte';
	import Slideshow from '#lib/components/Slideshow.svelte';
	import { createPagedFeed } from '#lib/feed/pagedFeed.svelte';
	import { combineFeedPosts } from 'postferry';
	import { postId, type TumblrPost, type TumblrAccount } from '#lib/types';
	import { Plus, User, Download, Loader2, Play, Home, Heart, Layers, Image as ImageIcon, Video, Music, Quote, Link as LinkIcon, MessageSquare, HelpCircle, FileText, RefreshCw } from '@lucide/svelte';

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

	let currentFilter = $state<PostFilter>('all');
	let error = $state('');
	let isOffline = $state(false);
	let downloadingAll = $state(false);
	let downloadProgress = $state({ done: 0, total: 0 });
	let slideshowActive = $state(false);
	let activeSlideshowPostId = $state<string | null>(null);
	let slideshowStartPostId = $state<string | null>(null);
	let slideshowStartMediaUrl = $state<string | null>(null);
	let newPostsAvailable = $state(false);
	let lastRefreshAt = 0;

	let activeAccounts = $derived<TumblrAccount[]>($accounts.filter((a) => a.active));

	const feed = createPagedFeed<TumblrPost>({
		idOf: postId,
		// The server already merged per-account state; a later copy is fresher.
		merge: combineFeedPosts,
		loadPage: async ({ cursors, since, topUp, signal }) => {
			if (activeAccounts.length === 0) return { items: [] };
			if (typeof navigator !== 'undefined' && !navigator.onLine) {
				throw new Error('Offline');
			}

			const response = await fetch('/api/posts/dashboard', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				signal,
				body: JSON.stringify({
					accounts: activeAccounts,
					offsets: cursors,
					// The dashboard API paginates with offset and since_id; there
					// is no before_id parameter.
					since_ids: since,
					type: currentFilter === 'all' ? null : currentFilter
				})
			});
			if (!response.ok) throw new Error(`Failed to load posts (${response.status})`);

			const data = await response.json();
			const items = (data.posts ?? []) as TumblrPost[];
			if (items.length > 0) {
				void bulkSetPosts(items).then(() => refreshUnreferencedPosts());
			}
			lastRefreshAt = Date.now();

			return {
				items,
				// A top-up must never move the downward cursor.
				cursors: topUp ? undefined : data.newOffsets,
				since: data.newSinceIds,
				accountResponses: data.accountResponses
			};
		}
	});

	let filteredPosts = $derived(filterPosts(feed.items, currentFilter));
	let loading = $derived(feed.loading);

	let lastKey = '';
	let restoredFromSnapshot = false;

	function accountKey(): string {
		return `${activeAccounts.map((account) => account.blogName).sort().join(',')}|${currentFilter}`;
	}

	$effect(() => {
		const key = accountKey();
		if (!browser) return;

		untrack(() => {
			if (restoredFromSnapshot) {
				restoredFromSnapshot = false;
				lastKey = key;
				return;
			}
			if (key === lastKey) return;
			lastKey = key;
			void feed.reset();
		});
	});

	snapshot({
		capture: () => ({ feed: feed.snapshot(), filter: currentFilter }),
		restore: (value: any) => {
			if (value?.filter) currentFilter = value.filter;
			feed.restore(value?.feed ?? value);
			restoredFromSnapshot = true;
			lastKey = accountKey();
		}
	});

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

	async function refreshFeed() {
		newPostsAvailable = false;
		if (feed.items.length === 0) await feed.reset();
		else await feed.refresh();
	}

	function maybeTopUp() {
		if (activeAccounts.length === 0 || isOffline) return;
		if (Date.now() - lastRefreshAt < 60_000) return;
		if (browser && window.scrollY > 400) {
			newPostsAvailable = true;
			return;
		}
		void feed.refresh();
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

	onDestroy(() => feed.destroy());

	function handleAddAccount() {
		window.location.href = '/api/auth/tumblr';
	}

	function toggleAccount(blogName: string) {
		accounts.toggleActive(blogName);
	}

	function showNewPosts() {
		newPostsAvailable = false;
		window.scrollTo({ top: 0, behavior: 'smooth' });
		void feed.refresh();
	}
</script>

<div class="min-h-dvh p-4 md:p-8 bg-black">
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
				Feed
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
							class="btn btn-sm btn-outline gap-1 border-gray-600 hover:bg-gray-800 text-gray-300"
							onclick={() => void refreshFeed()}
							disabled={loading || isOffline}
							title="Refresh feed"
						>
							<RefreshCw size={16} class={loading ? 'animate-spin' : ''} />
						</button>
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

	{#if newPostsAvailable}
		<button class="btn btn-sm btn-primary mb-4 mx-auto flex" onclick={showNewPosts}>
			<RefreshCw size={14} /> New posts available
		</button>
	{/if}

	{#if feed.partialErrors.length > 0 && !isOffline}
		<div class="alert alert-warning shadow-lg mb-6">
			<span>
				{feed.partialErrors.length} of {activeAccounts.length} account{feed.partialErrors.length === 1 ? '' : 's'} failed:
				{feed.partialErrors.map((account) => account.accountBlogName).join(', ')}
			</span>
		</div>
	{/if}

	{#if activeAccounts.length > 0 && downloadingAll}
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
					<p class="py-6">Connect an account to see your merged chronological feed.</p>
					<button class="btn btn-primary" onclick={handleAddAccount}>Connect account</button>
				</div>
			</div>
		</div>
	{:else if activeAccounts.length === 0}
		<div class="flex items-center justify-center h-64 text-gray-500">
			Please activate at least one account to view the dashboard.
		</div>
	{:else}
		{#if feed.error && !isOffline}
			<div class="alert alert-error shadow-lg mb-6">
				<span>{feed.error}</span>
			</div>
		{/if}

		<main>
			<PostGrid
				posts={filteredPosts}
				columnSetting={$settings.mediaColumns}
				onMediaClick={openSlideshowFromPost}
			/>
		</main>

		{#if filteredPosts.length === 0 && feed.items.length > 0}
			<div class="py-20 text-center text-gray-500">
				No posts match the current filter.
			</div>
		{/if}

		<InfiniteScroll hasMore={feed.hasMore} loading={feed.loading} onload={feed.loadMore} />
	{/if}
</div>

<Slideshow
	bind:active={slideshowActive}
	bind:activePostId={activeSlideshowPostId}
	startPostId={slideshowStartPostId}
	startMediaUrl={slideshowStartMediaUrl}
	posts={filteredPosts}
	onReachEnd={async () => { await feed.loadMore(); }}
/>
