<script lang="ts">
	import { browser } from '$app/env';
	import { page } from '$app/state';
	import { onMount, onDestroy, untrack } from 'svelte';
	import { accounts, accountsReady } from '#lib/stores/accounts';
	import PostGrid from '#lib/components/PostGrid.svelte';
	import InfiniteScroll from '#lib/components/InfiniteScroll.svelte';
	import Slideshow from '#lib/components/Slideshow.svelte';
	import { ArrowLeft, Play, Layers, Image as ImageIcon, Video, Music, Quote, Link as LinkIcon, MessageSquare, HelpCircle, FileText } from '@lucide/svelte';
	import { settings } from '#lib/stores/settings';
	import { bulkSetPosts } from '#lib/cache';
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

			const response = await fetch('/api/blog/likes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				signal,
				body: JSON.stringify({
					accounts: [activeAccount],
					blogName,
					// Likes paginate by liked_timestamp; a refresh starts from
					// the newest page rather than the oldest cursor.
					before: topUp ? undefined : cursors.before
				})
			});
			if (!response.ok) {
				throw new Error((await response.text()) || 'Failed to load likes');
			}

			const data = await response.json();
			const items = (data.liked_posts ?? []) as TumblrPost[];
			// This endpoint returns the *blog's* public likes, not the active
			// account's favourites, so it must not write likedBy flags.
			if (items.length > 0) void bulkSetPosts(items);
			const oldest = items.length > 0 ? items[items.length - 1]?.liked_timestamp : undefined;
			return {
				items,
				cursors: topUp || oldest === undefined ? undefined : { before: oldest },
				accountResponses: data.accountResponses
			};
		}
	});

	let filteredLikes = $derived(filterPosts(feed.items, currentFilter));
	let loading = $derived(feed.loading);

	let lastKey = '';
	$effect(() => {
		const key = `${blogName}|${activeAccount?.blogName ?? ''}`;
		if (!browser || !$accountsReady) return;
		untrack(() => {
			if (key === lastKey) return;
			lastKey = key;
			if (!activeAccount) {
				error = 'No active account. Please activate an account to view likes.';
				return;
			}
			error = '';
			void feed.reset();
		});
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
	<a href={`/blog/${blogName}`} class="btn btn-ghost mb-6 gap-2 text-white">
		<ArrowLeft size={20} /> Back to {blogName}
	</a>

	<header class="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h1 class="text-3xl font-bold text-white tracking-tight">{blogName}'s Favourites</h1>
			<p class="text-gray-400 mt-1">Explore what this blog has favorited.</p>
		</div>

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
				disabled={filteredLikes.length === 0}
			>
				<Play size={16} /> Play Slideshow
			</button>
		</div>
	</header>

	{#if !$accountsReady}
		<div class="flex justify-center py-20 items-center">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:else if error && (typeof navigator === 'undefined' || navigator.onLine)}
		<div class="alert alert-error mb-6">{error}</div>
	{:else if feed.error && !isOffline}
		<div class="alert alert-error mb-6">{feed.error}</div>
	{/if}

	{#if filteredLikes.length === 0 && !loading && feed.items.length > 0}
		<div class="py-20 text-center text-gray-500">
			No posts match the current filter.
		</div>
	{:else}
		<main>
			<PostGrid
				posts={filteredLikes}
				columnSetting={$settings.mediaColumns}
				onMediaClick={openSlideshowFromPost}
			/>
		</main>
	{/if}

	<InfiniteScroll hasMore={feed.hasMore} {loading} onload={feed.loadMore} />
</div>

<Slideshow
	bind:active={slideshowActive}
	bind:activePostId={activeSlideshowPostId}
	startPostId={slideshowStartPostId}
	startMediaUrl={slideshowStartMediaUrl}
	posts={filteredLikes}
	onReachEnd={async () => { await feed.loadMore(); }}
/>
