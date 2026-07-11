<script lang="ts">
	import { page } from '$app/stores';
	import { onMount, untrack } from 'svelte';
	import { accounts } from '$lib/stores/accounts';
	import { getAllMediaUrls } from '$lib/mediaUrls';
	import { bulkIsMediaCached } from '$lib/stores/db';
	import PostCard from '$lib/components/PostCard.svelte';
	import InfiniteScroll from '$lib/components/InfiniteScroll.svelte';
	import { ArrowLeft, Heart } from 'lucide-svelte';
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

	// Pre-compute all cached URLs in a single batch check for all visible posts
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

	onMount(async () => {
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
		<div class="tabs tabs-boxed bg-gray-900 border border-gray-800 p-1 w-fit">
			<button class="tab {currentFilter === 'all' ? 'tab-active bg-primary text-white' : 'text-gray-400'}" onclick={() => currentFilter = 'all'}>All</button>
			<button class="tab {currentFilter === 'photo' ? 'tab-active bg-primary text-white' : 'text-gray-400'}" onclick={() => currentFilter = 'photo'}>Photos</button>
			<button class="tab {currentFilter === 'video' ? 'tab-active bg-primary text-white' : 'text-gray-400'}" onclick={() => currentFilter = 'video'}>Videos</button>
			<button class="tab {currentFilter === 'text' ? 'tab-active bg-primary text-white' : 'text-gray-400'}" onclick={() => currentFilter = 'text'}>Text</button>
		</div>
	</div>
	<main 
		class="grid gap-4 items-start {$settings.mediaColumns === 'auto' ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7' : ''}"
		style={$settings.mediaColumns !== 'auto' ? `grid-template-columns: repeat(${$settings.mediaColumns}, minmax(0, 1fr));` : ''}
	>
			{#each filteredPosts as post (post.id)}
				<PostCard {post} preCheckedUrls={cachedUrlsFinal} />
			{/each}
		</main>

	{#if filteredPosts.length === 0 && posts.length > 0}
		<div class="py-20 text-center text-gray-500">
			No posts match the current filter.
		</div>
	{/if}

	<InfiniteScroll {hasMore} loading={loadingPosts} onload={loadPosts} />
</div>
