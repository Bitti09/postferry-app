<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { browser } from '$app/env';
	import { accounts } from '#lib/stores/accounts';
	import AvatarImage from '#lib/components/AvatarImage.svelte';
	import InfiniteScroll from '#lib/components/InfiniteScroll.svelte';

	import { getCachedBlogInfo, setCachedBlogInfo, loadAllFollowedBlogLists, saveFollowedBlogsForAccount } from '#lib/cache';

	import { settings } from '#lib/stores/settings';
	import type { TumblrAccount } from '#lib/types';
	import {
		Users,
		User,
		Bookmark,
		RefreshCw,
		Loader2,
		CheckCircle2,
		Circle,
		ChevronLeft,
		ChevronRight,
		Clock,
		Heart,
		Code
	} from '@lucide/svelte';

	let selectedDebugBlog = $state<any>(null);
	let showPageDebug = $state(false);

	function formatUpdated(timestamp?: number): string {
		if (!timestamp) return 'No data';
		const date = new Date(timestamp * 1000);
		return date.toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	let loading = $state(false);
	let error = $state('');

	let followedBlogs: any[] = $state([]);
	let loadingFollowed = $state(false);
	let followedError = $state('');
	let hasMoreFollowed = $state(true);
 
	type SortOption = 'default' | 'active_desc' | 'active_asc';
	let currentSort = $state<SortOption>('default');

	let sortedBlogs = $derived.by(() => {
		if (currentSort === 'default') {
			return followedBlogs;
		}
		return [...followedBlogs].sort((a, b) => {
			const timeA = a.updated || 0;
			const timeB = b.updated || 0;
			if (currentSort === 'active_desc') {
				return timeB - timeA;
			} else {
				return timeA - timeB;
			}
		});
	});

	let accountOffsets: Record<string, number> = $state({});
	let activeAccounts = $derived<TumblrAccount[]>($accounts.filter((a) => a.active));

	let initialMount = $state(true);
	let prevAccountsStr = $state('');

	onMount(async () => {
		if (browser) {
			const allEntries = await loadAllFollowedBlogLists();
			const merged = allEntries.flatMap((e) => e.blogs);
			if (merged.length > 0) followedBlogs = merged;
		}
	});

	$effect(() => {
		const currentAccountsStr = activeAccounts.map((a) => a.blogName).sort().join(',');

		untrack(() => {
			if (browser) {
				if (initialMount) {
					initialMount = false;
				}

				const accountsChanged = currentAccountsStr !== prevAccountsStr;
				prevAccountsStr = currentAccountsStr;

				if (activeAccounts.length > 0) {
					if (accountsChanged || followedBlogs.length === 0) {
						loadFollowed(true);
					}
				} else {
					followedBlogs = [];
					loadingFollowed = false;
					hasMoreFollowed = false;
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

	async function loadFollowed(reset = false) {
		if (activeAccounts.length === 0 || loadingFollowed || (!reset && !hasMoreFollowed)) return;
		loadingFollowed = true;
		followedError = '';

		if (reset) {
			accountOffsets = {};
			hasMoreFollowed = true;
		}

		try {
			// Find which blogs we already have public likes details for
			const cachedBlogNames = followedBlogs
				.filter(b => b.share_likes !== undefined)
				.map(b => b.name);

			const res = await fetch('/api/user/following', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					accounts: activeAccounts,
					offsets: accountOffsets,
					cachedBlogNames
				}),
			});

			if (!res.ok) {
				const msg = await res.text();
				throw new Error(msg || `Failed to load followed blogs (status ${res.status})`);
			}

			const data = await res.json();
			const blogs = data.blogs || [];
			const newOffsets = data.newOffsets || {};

			if (blogs.length === 0) {
				hasMoreFollowed = false;
			} else {
				// Process and enrich blogs (server-side enriched or client-side cached lookup)
				for (const blog of blogs) {
					if (blog.share_likes !== undefined) {
						// Server enriched it, cache it!
						await setCachedBlogInfo(blog.name, {
							blogName: blog.name,
							share_likes: blog.share_likes,
							likes: blog.likes,
							updated: blog.updated,
							cachedAt: Date.now()
						});
					} else {
						// Retrieve from client cache
						const cached = await getCachedBlogInfo(blog.name);
						if (cached) {
							blog.share_likes = cached.share_likes;
							blog.likes = cached.likes;
							if (cached.updated) blog.updated = cached.updated;
						}
					}
				}

				const existingIds = new Set(reset ? [] : followedBlogs.map((b) => b.name));
				const uniqueNew = blogs.filter((b: any) => !existingIds.has(b.name));
				
				if (uniqueNew.length === 0 && blogs.length > 0) {
					accountOffsets = { ...accountOffsets, ...newOffsets };
				} else if (uniqueNew.length === 0) {
					hasMoreFollowed = false;
				} else {
					followedBlogs = reset ? uniqueNew : [...followedBlogs, ...uniqueNew];
					accountOffsets = { ...accountOffsets, ...newOffsets };
					
					// Save the updated full list to IndexedDB (merged across accounts)
					await Promise.all(
						activeAccounts.map((acc) =>
							saveFollowedBlogsForAccount(acc.blogName, followedBlogs)
						)
					);
				}
			}
		} catch (err: any) {
			followedError = err.message;
		} finally {
			loadingFollowed = false;
		}
	}
</script>

<div class="h-[calc(100dvh-5rem)] flex flex-col p-4 md:p-8 bg-black overflow-hidden">
	<header class="mb-8 shrink-0 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h1 class="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
				<Bookmark size={32} class="text-primary" />
				Followed Blogs
			</h1>
			<p class="text-gray-400 mt-1">Blogs followed by your Tumblr accounts.</p>
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
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') toggleAccount(account.blogName);
						}}
					>
						<User size={14} />
						{account.blogName}
					</div>
				{/each}

				<select 
					class="select select-bordered select-sm bg-gray-900 text-white border-gray-800 font-mono text-[11px] font-bold w-44" 
					bind:value={currentSort}
				>
					<option value="default">Sort: Default</option>
					<option value="active_desc">Sort: Recent Active ↓</option>
					<option value="active_asc">Sort: Recent Active ↑</option>
				</select>
				<button 
					class="btn btn-sm btn-outline btn-success gap-2" 
					onclick={() => loadFollowed(true)}
					disabled={loadingFollowed || activeAccounts.length === 0}
				>
					<RefreshCw size={16} class={loadingFollowed ? "animate-spin" : ""} /> Refresh
				</button>
				<button class="btn btn-sm btn-outline btn-info gap-2" onclick={handleAddAccount}>
					<Users size={16} /> Add Account
				</button>
				<button 
					class="btn btn-sm btn-outline btn-warning gap-2" 
					onclick={() => showPageDebug = true}
					disabled={followedBlogs.length === 0}
				>
					<Code size={16} /> API Response
				</button>
			</div>
		</div>
	</header>

	<div class="flex-1 overflow-y-auto pr-2 pb-20">
		{#if $accounts.length === 0}
			<div class="hero min-h-[50dvh] rounded-3xl bg-base-200">
				<div class="hero-content text-center">
					<div class="max-w-md">
						<h1 class="text-5xl font-bold text-white">No accounts yet</h1>
						<p class="py-6">Connect a Tumblr account to see who you follow.</p>
						<button class="btn btn-primary" onclick={handleAddAccount}>Connect Tumblr</button>
					</div>
				</div>
			</div>
		{:else if activeAccounts.length === 0}
			<div class="flex items-center justify-center h-64 text-gray-500">
				Please activate an account to view its followed blogs.
			</div>
		{:else}
			{#if followedError}
				<div class="alert alert-error mb-6">{followedError}</div>
			{/if}

			{#if loadingFollowed && followedBlogs.length === 0}
				<div class="flex justify-center py-20">
					<span class="loading loading-spinner loading-lg text-primary"></span>
				</div>
			{:else if followedBlogs.length === 0 && !loadingFollowed}
				<div class="flex flex-col items-center justify-center py-20 text-gray-500">
					<Users size={64} class="mb-4 opacity-20" />
					<p class="text-xl font-bold">No followed blogs found</p>
					<p class="text-sm">None of your active accounts are following anyone, or the API didn't return results.</p>
				</div>
			{:else}
				<div 
					class="grid gap-6 {$settings.blogCardColumns === 'auto' ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : ''}"
					style={$settings.blogCardColumns !== 'auto' ? `grid-template-columns: repeat(${$settings.blogCardColumns}, minmax(0, 1fr));` : ''}
				>
					{#each sortedBlogs as blog (blog.name)}
						<!-- Card Wrapper -->
						<div class="relative flex flex-col bg-gray-900 border border-gray-800 rounded-3xl p-6 hover:border-primary/40 hover:shadow-[0_10px_30px_rgba(0,0,0,0.5)] transition-all duration-300 group">
							
							<!-- Debug Button (Top-Right) -->
							<button 
								class="opacity-0 group-hover:opacity-100 transition-opacity btn btn-xs btn-circle btn-ghost text-gray-500 hover:text-white absolute top-4 right-4 z-10"
								onclick={() => selectedDebugBlog = blog}
								title="View Raw API JSON"
							>
								<Code size={14} />
							</button>
							
							<!-- Main Blog Info Area -->
							<div class="flex items-start gap-4 mb-4 select-none">
								<div class="avatar shrink-0">
									<div class="w-16 h-16 rounded-2xl overflow-hidden bg-gray-800 ring-2 ring-gray-800 transition-all duration-300">
										<AvatarImage blogName={blog.name} size={128} class="w-full h-full object-cover" />
									</div>
								</div>
								<div class="min-w-0 flex-1">
									<div class="text-white font-black text-lg truncate tracking-tight leading-snug">
										{blog.title || blog.name}
									</div>
									<div class="text-xs text-gray-500 font-bold truncate mt-0.5">@{blog.name}</div>
								</div>
							</div>

							<!-- Description -->
							{#if blog.description}
								<div class="text-xs text-gray-400 line-clamp-3 leading-relaxed mb-4 flex-1 select-none">
									{blog.description.replace(/<[^>]*>/g, '')}
								</div>
							{:else}
								<div class="flex-1"></div>
							{/if}

							<!-- The Small Box (Stats & Links) -->
							<div class="bg-black/60 border border-gray-800/80 rounded-2xl p-3.5 space-y-2.5">
								<div class="flex items-center justify-between text-[11px] text-gray-400 font-bold font-mono">
									<div class="flex items-center gap-1.5">
										<Clock size={12} class="text-primary" />
										<span>Last Active:</span>
									</div>
									<span class="text-white font-black">{formatUpdated(blog.updated)}</span>
								</div>

								<div class="flex items-center justify-between pt-1 border-t border-gray-800/50">
									<div class="flex items-center gap-1.5 text-[11px] text-gray-400 font-bold font-mono">
										<Heart size={12} class="text-pink-500" />
										<span>Fav Count:</span>
									</div>
									{#if blog.likes !== undefined && blog.likes !== null}
										<span class="text-white font-black font-mono text-[11px]">{blog.likes.toLocaleString()}</span>
									{:else if blog.share_likes === false}
										<span class="text-gray-600 font-black font-mono text-[10px] uppercase">Private</span>
									{:else}
										<span class="text-gray-500 font-black font-mono text-[10px] uppercase">--</span>
									{/if}
								</div>

								<div class="pt-1.5 flex gap-2">
									<a 
										href={`/blog/${blog.name}`} 
										class="btn btn-xs btn-outline border-gray-800 hover:bg-gray-800 text-gray-300 font-bold font-mono text-[10px] uppercase tracking-wider rounded-xl py-1.5 h-auto min-h-0 {blog.share_likes ? 'flex-1' : 'w-full text-center'}"
									>
										Feed
									</a>
									{#if blog.share_likes}
										<a 
											href={`/blog/${blog.name}/likes`} 
											class="btn btn-xs btn-primary text-white font-bold font-mono text-[10px] uppercase tracking-wider rounded-xl flex-1 py-1.5 h-auto min-h-0 gap-1"
										>
											<Heart size={10} fill="currentColor" /> Favourites
										</a>
									{/if}
								</div>
							</div>

						</div>
					{/each}
				</div>

				<InfiniteScroll hasMore={hasMoreFollowed} loading={loadingFollowed} onload={() => loadFollowed(false)} />
			{/if}
		{/if}
	</div>
</div>

{#if selectedDebugBlog}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onclick={() => selectedDebugBlog = null}>
		<div class="bg-gray-900 border border-gray-800 rounded-3xl p-6 w-full max-w-2xl max-h-[80dvh] flex flex-col shadow-2xl" onclick={e => e.stopPropagation()}>
			<div class="flex items-center justify-between border-b border-gray-800 pb-4 mb-4">
				<h3 class="text-lg font-bold text-white font-mono">@{selectedDebugBlog.name} Raw API JSON</h3>
				<button class="btn btn-sm btn-circle btn-ghost text-gray-400 hover:text-white" onclick={() => selectedDebugBlog = null}>✕</button>
			</div>
			<div class="flex-1 overflow-auto rounded-xl bg-black p-4 text-xs font-mono text-green-400 custom-scrollbar select-text leading-relaxed">
				<pre class="whitespace-pre-wrap">{JSON.stringify(selectedDebugBlog, null, 2)}</pre>
			</div>
		</div>
	</div>
{/if}

{#if showPageDebug}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onclick={() => showPageDebug = false}>
		<div class="bg-gray-900 border border-gray-800 rounded-3xl p-6 w-full max-w-4xl max-h-[85dvh] flex flex-col shadow-2xl" onclick={e => e.stopPropagation()}>
			<div class="flex items-center justify-between border-b border-gray-800 pb-4 mb-4">
				<h3 class="text-lg font-bold text-white font-mono">Page API Response ({followedBlogs.length} Blogs)</h3>
				<button class="btn btn-sm btn-circle btn-ghost text-gray-400 hover:text-white" onclick={() => showPageDebug = false}>✕</button>
			</div>
			<div class="flex-1 overflow-auto rounded-xl bg-black p-4 text-xs font-mono text-green-400 custom-scrollbar select-text leading-relaxed">
				<pre class="whitespace-pre-wrap">{JSON.stringify(followedBlogs, null, 2)}</pre>
			</div>
		</div>
	</div>
{/if}
