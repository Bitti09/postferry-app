<script lang="ts">
	import { page } from '$app/stores';
	import { onMount, untrack } from 'svelte';
	import { accounts } from '$lib/stores/accounts';
	import PostCard from '$lib/components/PostCard.svelte';
	import InfiniteScroll from '$lib/components/InfiniteScroll.svelte';
	import { ArrowLeft, Filter } from 'lucide-svelte';
	import { settings } from '$lib/stores/settings';

	let blogName = $page.params.blogName;
	
	let likes: any[] = $state([]);
	let loading = $state(false);
	let hasMore = $state(true);
	let beforeTimestamp: number | null = $state(null);
	let error = $state('');
	let fetchController: AbortController | null = null;
	
	let currentFilter = $state('all');

	$effect(() => {
		const _filter = currentFilter; // track
		untrack(() => {
			if (fetchController && !fetchController.signal.aborted) {
				fetchController.abort();
				loading = false;
			}
		});
	});

	let activeAccount = $derived($accounts.find((a) => a.active));
	
	// Filter logic
	let filteredLikes = $derived(likes.filter(post => {
		if (currentFilter === 'all') return true;
		if (currentFilter === 'photo') return post.type === 'photo';
		if (currentFilter === 'video') return post.type === 'video';
		if (currentFilter === 'text') return post.type === 'text';
		return true;
	}));

	onMount(() => {
		if (!activeAccount) {
			error = 'No active account. Please activate an account to view likes.';
			return;
		}
		loadLikes();
	});

	async function loadLikes() {
		if (!activeAccount || loading || !hasMore) return;
		loading = true;
		fetchController = new AbortController();

		try {
			const res = await fetch('/api/blog/likes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				signal: fetchController.signal,
				body: JSON.stringify({ account: activeAccount, blogName, before: beforeTimestamp })
			});

			if (!res.ok) {
				const errorMsg = await res.text();
				throw new Error(errorMsg || 'Failed to load likes');
			}

			const data = await res.json();
			const newLikes = data.liked_posts;

			if (!newLikes || newLikes.length === 0) {
				hasMore = false;
			} else {
				const existingIds = new Set(likes.map((p) => p.id));
				const uniqueNew = newLikes.filter((p: any) => !existingIds.has(p.id));
				
				if (uniqueNew.length === 0) {
					hasMore = false;
				} else {
					likes = [...likes, ...uniqueNew];
					// The "before" timestamp for likes is the `liked_timestamp` of the oldest post in the batch
					beforeTimestamp = Math.min(...uniqueNew.map((p: any) => p.liked_timestamp));
				}
			}
		} catch (err: any) {
			if (err.name === 'AbortError') return;
			error = err.message;
			hasMore = false;
		} finally {
			if (fetchController && !fetchController.signal.aborted) {
				loading = false;
			}
		}
	}
</script>

<div class="min-h-screen p-4 md:p-8 bg-black">
	<a href={`/blog/${blogName}`} class="btn btn-ghost mb-6 gap-2 text-white">
		<ArrowLeft size={20} /> Back to {blogName}
	</a>

	<header class="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h1 class="text-3xl font-bold text-white tracking-tight">{blogName}'s Favourites</h1>
			<p class="text-gray-400 mt-1">Explore what this blog has favorited.</p>
		</div>

		<div class="tabs tabs-boxed bg-gray-900 border border-gray-800 p-1 w-fit">
			<button class="tab {currentFilter === 'all' ? 'tab-active bg-primary text-white' : 'text-gray-400'}" onclick={() => currentFilter = 'all'}>All</button>
			<button class="tab {currentFilter === 'photo' ? 'tab-active bg-primary text-white' : 'text-gray-400'}" onclick={() => currentFilter = 'photo'}>Photos</button>
			<button class="tab {currentFilter === 'video' ? 'tab-active bg-primary text-white' : 'text-gray-400'}" onclick={() => currentFilter = 'video'}>Videos</button>
			<button class="tab {currentFilter === 'text' ? 'tab-active bg-primary text-white' : 'text-gray-400'}" onclick={() => currentFilter = 'text'}>Text</button>
		</div>
	</header>

	{#if error && (typeof navigator === 'undefined' || navigator.onLine)}
		<div class="alert alert-error mb-6">{error}</div>
	{/if}

	{#if filteredLikes.length === 0 && !loading && likes.length > 0}
		<div class="py-20 text-center text-gray-500">
			No posts match the current filter.
		</div>
	{:else}
		<main 
			class="grid gap-4 items-start {$settings.mediaColumns === 'auto' ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7' : ''}"
			style={$settings.mediaColumns !== 'auto' ? `grid-template-columns: repeat(${$settings.mediaColumns}, minmax(0, 1fr));` : ''}
		>
			{#each filteredLikes as post (post.id)}
				<PostCard {post} />
			{/each}
		</main>
	{/if}

	<InfiniteScroll {hasMore} {loading} onload={loadLikes} />
</div>
