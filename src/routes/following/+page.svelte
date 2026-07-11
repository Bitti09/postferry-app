<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { browser } from '$app/environment';
	import { accounts } from '$lib/stores/accounts';
	import AvatarImage from '$lib/components/AvatarImage.svelte';
	import InfiniteScroll from '$lib/components/InfiniteScroll.svelte';
	import type { TumblrAccount } from '$lib/types';
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
	} from 'lucide-svelte';

	let loading = $state(false);
	let error = $state('');

	let followedBlogs: any[] = $state([]);
	let loadingFollowed = $state(false);
	let followedError = $state('');
	let hasMoreFollowed = $state(true);

	let accountOffsets: Record<string, number> = $state({});
	let activeAccounts = $derived<TumblrAccount[]>($accounts.filter((a) => a.active));

	let initialMount = $state(true);
	let prevAccountsStr = $state('');

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
			followedBlogs = [];
			accountOffsets = {};
			hasMoreFollowed = true;
		}

		try {
			const res = await fetch('/api/user/following', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					accounts: activeAccounts,
					offsets: accountOffsets,
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
				const existingIds = new Set(followedBlogs.map((b) => b.name));
				const uniqueNew = blogs.filter((b: any) => !existingIds.has(b.name));
				
				if (uniqueNew.length === 0 && blogs.length > 0) {
					accountOffsets = { ...accountOffsets, ...newOffsets };
				} else if (uniqueNew.length === 0) {
					hasMoreFollowed = false;
				} else {
					followedBlogs = reset ? uniqueNew : [...followedBlogs, ...uniqueNew];
					accountOffsets = { ...accountOffsets, ...newOffsets };
				}
			}
		} catch (err: any) {
			followedError = err.message;
		} finally {
			loadingFollowed = false;
		}
	}
</script>

<div class="h-[calc(100dvh-5rem)] flex flex-col p-4 md:p-8 overflow-hidden">
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

				<button class="btn btn-sm btn-outline btn-info gap-2" onclick={handleAddAccount}>
					<Users size={16} /> Add Account
				</button>
			</div>
		</div>
	</header>

	<div class="flex-1 overflow-y-auto pr-2 pb-20">
		{#if $accounts.length === 0}
			<div class="hero min-h-[50vh] rounded-3xl bg-base-200">
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
				<div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
					{#each followedBlogs as blog (blog.name)}
						<a
							href={`/blog/${blog.name}`}
							class="flex items-center gap-4 bg-gray-900 border border-gray-800 rounded-2xl p-4 hover:border-primary/50 transition-all group"
						>
							<div class="avatar shrink-0">
								<div class="w-12 h-12 rounded-xl overflow-hidden bg-gray-800">
									<AvatarImage blogName={blog.name} size={64} class="w-full h-full object-cover group-hover:scale-110 transition-transform" />
								</div>
							</div>
							<div class="min-w-0 flex-1">
								<div class="text-white font-semibold truncate group-hover:text-primary transition-colors">
									{blog.title || blog.name}
								</div>
								<div class="text-xs text-gray-500 truncate">{blog.name}</div>
								{#if blog.description}
									<div class="text-xs text-gray-600 truncate mt-0.5">{blog.description.replace(/<[^>]*>/g, '')}</div>
								{/if}
							</div>
						</a>
					{/each}
				</div>

				<InfiniteScroll hasMore={hasMoreFollowed} loading={loadingFollowed} onload={() => loadFollowed(false)} />
			{/if}
		{/if}
	</div>
</div>
