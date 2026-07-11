<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { browser } from '$app/environment';
	import { settings } from '$lib/stores/settings';
	import { accounts, accountsReady } from '$lib/stores/accounts';
	import { addPostsToCache, bulkIsMediaCached } from '$lib/stores/db';
	import { cacheAllVisible } from '$lib/cacheUtils';
	import { filterPosts, type PostFilter } from '$lib/postFilter';
	import { getAllMediaUrls } from '$lib/mediaUrls';
	import PostCard from '$lib/components/PostCard.svelte';
	import LazyRender from '$lib/components/LazyRender.svelte';
	import InfiniteScroll from '$lib/components/InfiniteScroll.svelte';
	import Slideshow from '$lib/components/Slideshow.svelte';
	import type { TumblrPost, TumblrAccount } from '$lib/types';
	import { Plus, User, LogOut, Download, Loader2, Play, Home, Heart } from 'lucide-svelte';

	const FILTERS: { value: PostFilter; label: string }[] = [
		{ value: 'all', label: 'All' },
		{ value: 'photo', label: 'Photos' },
		{ value: 'video', label: 'Videos' },
		{ value: 'audio', label: 'Audio' },
		{ value: 'quote', label: 'Quotes' },
		{ value: 'link', label: 'Links' },
		{ value: 'chat', label: 'Chat' },
		{ value: 'answer', label: 'Asks' },
		{ value: 'text', label: 'Text' }
	];

	let posts: TumblrPost[] = $state([]);
	let loading = $state(false);
	let hasMore = $state(true);
	let accountOffsets: Record<string, string> = $state({});
	let error = $state('');
	let isOffline = $state(false);
	let downloadingAll = $state(false);
	let downloadProgress = $state({ done: 0, total: 0 });
	let slideshowActive = $state(false);
	let activeSlideshowPostId = $state<string | number | null>(null);

	$effect(() => {
		if (!slideshowActive && activeSlideshowPostId) {
			const el = document.getElementById(`post-${activeSlideshowPostId}`);
			if (el) {
				el.scrollIntoView({ behavior: 'instant', block: 'center' });
			}
			activeSlideshowPostId = null;
		}
	});
	
	let fetchController: AbortController | null = null;
	
	let currentFilter = $state<PostFilter>('all');

	// Reactive active accounts
	let activeAccounts = $derived<TumblrAccount[]>($accounts.filter((a) => a.active));

	let filteredPosts = $derived(filterPosts(posts, currentFilter));

	// Async computed cached URLs
	let cachedUrlSet = $state<Set<string>>(new Set());
	let cachedUrlsReady = $state(false);

	$effect(() => {
		const urls = filteredPosts.flatMap(p => getAllMediaUrls(p));
		if (urls.length === 0) {
			cachedUrlSet = new Set();
			cachedUrlsReady = true;
			return;
		}
	
		bulkIsMediaCached(urls).then(found => {
			cachedUrlSet = found;
			cachedUrlsReady = true;
		}).catch(() => {
			cachedUrlSet = new Set();
			cachedUrlsReady = true;
		});
	});

	// Final cached URLs for PostCard consumption
	let cachedUrlsFinal = $derived(cachedUrlsReady ? Array.from(cachedUrlSet) : []);

	async function startCacheAll() {
		if (downloadingAll) return;
		downloadingAll = true;
		await cacheAllVisible(filteredPosts, (p) => { downloadProgress = p; });
		downloadingAll = false;
	}

	async function loadPosts(reset = false) {
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
					type: currentFilter === 'all' ? null : currentFilter
				})
			});

			if (!res.ok) throw new Error('Failed to load posts');

			const data = await res.json();
			const newPosts: TumblrPost[] = data.posts;
			const newOffsets = data.newOffsets;

			if (newPosts.length === 0) {
				hasMore = false;
			} else {
				const existingIds = new Set(posts.map((p) => p.id));
				const uniqueNewPosts = newPosts.filter((p) => !existingIds.has(p.id));

				if (uniqueNewPosts.length === 0 && newPosts.length > 0) {
					// Duplicates, continue if more pages
				} else if (uniqueNewPosts.length === 0) {
					hasMore = false;
				} else {
					posts = [...posts, ...uniqueNewPosts];
					accountOffsets = { ...accountOffsets, ...newOffsets };
					addPostsToCache(uniqueNewPosts);
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
			window.addEventListener('online', () => { isOffline = false; loadPosts(false); });
			window.addEventListener('offline', () => isOffline = true);
		}
		// $effect above handles initial load on activeAccounts/currentFilter change
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
				<div class="flex items-center gap-4">
					<div class="tabs tabs-boxed bg-gray-900 border border-gray-800 p-1 w-fit flex-wrap">
						{#each FILTERS as f}
							<button
								class="tab {currentFilter === f.value ? 'tab-active bg-primary text-white' : 'text-gray-400'}"
								onclick={() => { currentFilter = f.value; loadPosts(true); }}
							>
								{f.label}
							</button>
						{/each}
					</div>

					<div class="flex items-center gap-2">
						<button 
							class="btn btn-sm btn-outline gap-2 border-gray-600 hover:bg-gray-800 text-gray-300"
							onclick={() => slideshowActive = true}
							disabled={filteredPosts.length === 0}
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

				<main 
					class="grid gap-4 items-start {$settings.mediaColumns === 'auto' ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7' : ''}"
					style={$settings.mediaColumns !== 'auto' ? `grid-template-columns: repeat(${$settings.mediaColumns}, minmax(0, 1fr));` : ''}
				>
									{#each filteredPosts as post (post.id)}
										<div id={"post-" + post.id}>
											<LazyRender>
												<PostCard {post} preCheckedUrls={cachedUrlsFinal} />
											</LazyRender>
										</div>
									{/each}
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
	posts={filteredPosts} 
	onReachEnd={async () => { await loadPosts(false); }} 
/>
