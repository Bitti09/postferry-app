<script lang="ts">
	import { browser } from '$app/env';
	import { page } from '$app/state';
	import { onMount, onDestroy, untrack } from 'svelte';
	import { accounts } from '#lib/stores/accounts';
	import PostGrid from '#lib/components/PostGrid.svelte';
	import InfiniteScroll from '#lib/components/InfiniteScroll.svelte';
	import Slideshow from '#lib/components/Slideshow.svelte';
	import { ArrowLeft, Heart, Play, Layers, Image as ImageIcon, Video, Music, Quote, Link as LinkIcon, MessageSquare, HelpCircle, FileText } from '@lucide/svelte';
	import { settings } from '#lib/stores/settings';
	import { getCachedBlogInfo, setCachedBlogInfo, bulkSetPosts } from '#lib/cache';
	import { refreshUnreferencedPosts } from '#lib/stores/unreferencedPosts';
	import { filterPosts, type PostFilter } from '#lib/postFilter';
	import { createPagedFeed } from '#lib/feed/pagedFeed.svelte';
	import { combineFeedPosts } from 'postferry';
	import { postId, type TumblrPost, type TumblrAccount } from '#lib/types';

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

	let blogName = $derived(page.params.blogName ?? '');
	let info = $state<any>(null);
	let loadingInfo = $state(true);
	let currentFilter = $state<PostFilter>('all');
	let error = $state('');
	let isOffline = $state(false);
	let slideshowActive = $state(false);
	let activeSlideshowPostId = $state<string | null>(null);
	let slideshowStartPostId = $state<string | null>(null);
	let slideshowStartMediaUrl = $state<string | null>(null);

	let activeAccount = $derived<TumblrAccount | undefined>($accounts.find((account) => account.active));

	const feed = createPagedFeed<TumblrPost>({
		idOf: postId,
		merge: combineFeedPosts,
		loadPage: async ({ cursors, topUp, signal }) => {
			if (!activeAccount) return { items: [] };
			if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('Offline');

			const response = await fetch('/api/blog/posts', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				signal,
				body: JSON.stringify({
					accounts: [activeAccount],
					blogName,
					// The posts endpoint paginates by publish timestamp (`before`),
					// not by post id.
					before: topUp ? undefined : cursors.before
				})
			});
			if (!response.ok) throw new Error(`Failed to load posts (${response.status})`);

			const data = await response.json();
			const items = (data.posts ?? []) as TumblrPost[];
			if (items.length > 0) {
				void bulkSetPosts(items).then(() => refreshUnreferencedPosts());
			}
			return {
				items,
				cursors: topUp || data.newBefore === undefined ? undefined : { before: data.newBefore },
				accountResponses: data.accountResponses
			};
		}
	});

	let filteredPosts = $derived(filterPosts(feed.items, currentFilter));
	let loading = $derived(feed.loading);

	let lastKey = '';
	$effect(() => {
		const key = `${blogName}|${activeAccount?.blogName ?? ''}`;
		if (!browser) return;
		untrack(() => {
			if (key === lastKey) return;
			lastKey = key;
			void feed.reset();
		});
	});

	async function loadInfo() {
		if (!blogName) return;
		loadingInfo = true;

		const cached = await getCachedBlogInfo(blogName);
		if (cached?.full) info = cached.full;

		if (typeof navigator !== 'undefined' && !navigator.onLine) {
			loadingInfo = false;
			return;
		}
		if (!activeAccount) {
			loadingInfo = false;
			return;
		}

		try {
			const response = await fetch('/api/blog/info', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ accounts: [activeAccount], blogName })
			});
			if (response.ok) {
				const data = await response.json();
				info = data.info;
				if (info) {
					await setCachedBlogInfo(blogName, {
						blogName,
						share_likes: info.share_likes ?? false,
						likes: info.likes,
						updated: info.updated,
						full: info,
						cachedAt: Date.now()
					});
				}
			}
		} catch (caught) {
			console.error(caught);
		} finally {
			loadingInfo = false;
		}
	}

	$effect(() => {
		if (!browser) return;
		const name = blogName;
		const account = activeAccount;
		if (!name) return;
		if (!account) {
			loadingInfo = false;
			return;
		}
		untrack(() => void loadInfo());
	});

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
			void feed.refresh();
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

<div class="min-h-dvh p-4 md:p-8 bg-black">
	<a href="/" class="btn btn-ghost mb-6 gap-2 text-white">
		<ArrowLeft size={20} /> Back to Feed
	</a>

	{#if feed.error && (typeof navigator === 'undefined' || navigator.onLine)}
		<div class="alert alert-error">{feed.error}</div>
	{/if}

	<!-- Blog Header -->
	{#if loadingInfo && !info}
		<div class="flex justify-center py-10">
			<span class="loading loading-spinner text-primary"></span>
		</div>
	{:else if info}
		<div class="bg-gray-900 rounded-3xl p-6 md:p-10 mb-8 shadow-xl flex flex-col md:flex-row gap-8 items-start">
			<div class="avatar">
				<div class="w-32 rounded-xl">
					<img src={`/api/avatar?blog=${encodeURIComponent(blogName)}&size=128`} alt="Avatar" />
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
		<div class="flex items-center gap-2 flex-wrap">
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
			<button
				class="btn btn-sm btn-outline gap-2 border-gray-600 hover:bg-gray-800 text-gray-300"
				onclick={() => { slideshowStartPostId = null; slideshowStartMediaUrl = null; slideshowActive = true; }}
				disabled={filteredPosts.length === 0}
			>
				<Play size={16} /> Play Slideshow
			</button>
		</div>
	</div>

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

	<InfiniteScroll hasMore={feed.hasMore} {loading} onload={feed.loadMore} />
</div>

<Slideshow
	bind:active={slideshowActive}
	bind:activePostId={activeSlideshowPostId}
	startPostId={slideshowStartPostId}
	startMediaUrl={slideshowStartMediaUrl}
	posts={filteredPosts}
	onReachEnd={async () => { await feed.loadMore(); }}
/>
