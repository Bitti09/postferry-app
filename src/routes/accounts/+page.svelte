<script lang="ts">
	import { onMount } from 'svelte';
	import { accounts } from '#lib/stores/accounts';
	import { Heart, User, RefreshCw, CheckCircle2, Circle, Download, Loader2 } from '@lucide/svelte';
	import { bulkIsMediaCached, loadAllAccountInfos, setAccountInfo } from '#lib/cache';
	import { bulkSetPosts } from '#lib/cache/posts';
	import { requestMediaDownload } from '#lib/stores/downloads';
	import { getAllMediaUrls } from '#lib/mediaUrls';
	import type { TumblrAccount, TumblrPost, TumblrUser } from '#lib/types';

	let accountInfos = $state<Record<string, TumblrUser>>({});
	let loading = $state(false);
	let error = $state('');
	let isOffline = $state(false);
	let downloadingFavs = $state<Record<string, { fetchedPosts: number, newMedia: number, skippedMedia: number, active: boolean }>>({});

	async function fetchAccountInfos() {
		const cached = await loadAllAccountInfos();
		if (Object.keys(cached).length > 0) accountInfos = cached;

		if (typeof navigator !== 'undefined' && !navigator.onLine) {
			return; // Don't attempt to fetch if offline
		}

		loading = true;
		error = '';
		try {
			// Single multi-account round trip: the route returns one result per
			// account, in request order, with per-account error isolation.
			const res = await fetch('/api/user/info', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ accounts: $accounts })
			});
			if (!res.ok) throw new Error(`user/info failed: ${res.status}`);
			const payload = await res.json();
			const results: { accountBlogName: string; ok: boolean; user?: TumblrUser; error?: string }[] =
				payload.results ?? [];

			// Strip reactivity BEFORE the IDB write: $state proxies cannot be
			// structured-cloned (DataCloneError).
			for (const r of results) {
				if (!r.ok || !r.user) continue;
				const plain: TumblrUser = JSON.parse(JSON.stringify(r.user));
				accountInfos[r.accountBlogName] = plain;
				await setAccountInfo(r.accountBlogName, plain);
			}

			const failed = results.filter((r) => !r.ok);
			if (failed.length > 0) {
				error = `Some accounts failed: ${failed.map((f) => f.accountBlogName).join(', ')}`;
			}
		} catch (err: any) {
			error = 'Failed to fetch some account information.';
			console.error(err);
		} finally {
			loading = false;
		}
	}

	async function cacheAllFavs(account: TumblrAccount) {
		if (downloadingFavs[account.blogName]?.active) return;
		
		downloadingFavs[account.blogName] = { fetchedPosts: 0, newMedia: 0, skippedMedia: 0, active: true };
		let beforeTimestamp: number | null = null;
		
		try {
			while (true) {
				const res = await fetch('/api/blog/likes', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ accounts: [account], blogName: account.blogName, before: beforeTimestamp })
				});

				if (!res.ok) {
					if (res.status === 429) {
						error = 'Tumblr API Rate Limit Exceeded. Cycle your VPN IP and click "Cache Favs" to resume.';
					} else {
						const msg = await res.text();
						error = `Failed to fetch likes: ${msg}`;
					}
					break;
				}

				const data = await res.json();
				const posts = data.liked_posts;
				
				if (!posts || posts.length === 0) break; // Reached the end!

				// Cache the raw post metadata directly into IndexedDB (supports text-only posts!)
				const likeUpdates = Object.fromEntries(posts.map((p: any) => [String(p.id_string ?? p.id), { [account.blogName]: true }]));
				await bulkSetPosts(posts, { likedBy: likeUpdates });
				
				const { refreshUnreferencedPosts } = await import('#lib/stores/unreferencedPosts');
				void refreshUnreferencedPosts();

			// Extract and download media for this batch
			const urlMeta = new Map<string, { postId: string, blogName: string, timestamp: number; post: any }>();
			for (const post of posts) {
				const meta = { postId: String(post.id_string ?? post.id), blogName: post.blog_name, timestamp: post.timestamp, post };
				for (const u of getAllMediaUrls(post)) {
					if (!urlMeta.has(u)) urlMeta.set(u, meta);
				}
			}

				const entries = Array.from(urlMeta.entries());
				const cachedSet = await bulkIsMediaCached(entries.map(([url]) => url));

				// Batch downloads (fire and forget to Service Worker)
				const toDownload = entries.filter(([url]) => !cachedSet.has(url));
				for (const [url, meta] of toDownload) {
					requestMediaDownload(url, meta);
					if (downloadingFavs[account.blogName]) {
						downloadingFavs[account.blogName].newMedia++;
					}
				}

				// Count skipped
				if (downloadingFavs[account.blogName]) {
					downloadingFavs[account.blogName].skippedMedia += entries.filter(([url]) => cachedSet.has(url)).length;
				}

				downloadingFavs[account.blogName].fetchedPosts += posts.length;
				
				// Get oldest timestamp for next batch
				beforeTimestamp = Math.min(...posts.map((p: any) => p.liked_timestamp));
				
				// Optional: wait a tiny bit to not completely slam the network stack
				await new Promise(r => setTimeout(r, 500));
			}
		} catch (err: any) {
			console.error("Error caching favourites:", err);
			error = err.message || 'An unexpected error occurred during caching.';
		} finally {
			if (downloadingFavs[account.blogName]) {
				downloadingFavs[account.blogName].active = false;
			}
		}
	}

	onMount(() => {
		if (typeof window !== 'undefined') {
			isOffline = !navigator.onLine;
			window.addEventListener('online', () => isOffline = false);
			window.addEventListener('offline', () => isOffline = true);
		}
		fetchAccountInfos();
	});

	function toggleActive(blogName: string) {
		accounts.toggleActive(blogName);
	}
</script>

<div class="min-h-dvh bg-black p-4 md:p-8">
	<div class="mx-auto w-full">
		<header class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
			<div>
				<h1 class="text-4xl font-black text-white tracking-tight flex items-center gap-3">
					<User class="text-primary" size={36} />
					Managed Accounts
				</h1>
				<p class="text-gray-400 mt-2">Manage and monitor all your connected Tumblr blogs.</p>
			</div>
			<div class="flex items-center gap-3">
				<a 
					href="/api/auth/tumblr" 
					class="btn btn-outline border-gray-800 text-gray-400 hover:bg-gray-800 gap-2"
					title="Right-click and select 'Open in Incognito' to add a different account"
				>
					Add Account (Incognito)
				</a>
				<button 
					class="btn btn-primary gap-2 shadow-lg shadow-primary/20" 
					onclick={fetchAccountInfos}
					disabled={loading}
				>
					<RefreshCw size={18} class={loading ? 'animate-spin' : ''} />
					Refresh Stats
				</button>
			</div>
		</header>

		{#if error && (typeof navigator === 'undefined' || navigator.onLine)}
			<div class="alert alert-error mb-8 shadow-xl">
				<span>{error}</span>
			</div>
		{/if}

		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
			{#each $accounts as account}
				{@const info = accountInfos[account.blogName]}
				<div class="card bg-gray-900 border border-gray-800 shadow-xl hover:border-primary/50 transition-all group">
					<div class="card-body p-6">
						<div class="flex items-start justify-between mb-4">
							<div class="flex items-center gap-4">
								<div class="avatar">
									<div class="w-16 h-16 rounded-2xl ring-2 ring-gray-800 ring-offset-2 ring-offset-gray-900 overflow-hidden bg-gray-800">
										{#if info}
											<img src={`/api/avatar?blog=${encodeURIComponent(account.blogName)}&size=512`} alt={account.blogName} />
										{:else}
											<div class="flex items-center justify-center h-full w-full">
												<User size={32} class="text-gray-700" />
											</div>
										{/if}
									</div>
								</div>
							<div class="min-w-0">
								<h2 class="card-title text-white text-xl font-bold">{account.blogName}</h2>
								<p class="text-xs text-gray-500 font-mono uppercase tracking-widest mt-1 truncate">
									{info?.name || 'Loading...'}
								</p>
								{#if info?.email}
									<p class="text-[11px] text-gray-400 font-mono mt-0.5 truncate" title={info.email}>
										{info.email}
									</p>
								{/if}
							</div>
							</div>
							<button 
								class="btn btn-ghost btn-circle btn-sm {account.active ? 'text-green-500' : 'text-gray-600'}"
								onclick={() => toggleActive(account.blogName)}
								title={account.active ? 'Deactivate' : 'Activate'}
							>
								{#if account.active}
									<CheckCircle2 size={24} />
								{:else}
									<Circle size={24} />
								{/if}
							</button>
						</div>

						<div class="grid grid-cols-2 gap-4 mt-4">
							<div class="bg-gray-800/50 rounded-xl p-4 border border-gray-800 flex flex-col items-center justify-center">
								<Heart class="text-pink-500 mb-2" size={20} />
								<span class="text-2xl font-black text-white">{info?.likes || '0'}</span>
								<span class="text-[10px] text-gray-500 uppercase font-bold tracking-tighter">Liked Posts</span>
							</div>
							<div class="bg-gray-800/50 rounded-xl p-4 border border-gray-800 flex flex-col items-center justify-center">
								<RefreshCw class="text-green-500 mb-2" size={20} />
								<span class="text-2xl font-black text-white">{info?.following || '0'}</span>
								<span class="text-[10px] text-gray-500 uppercase font-bold tracking-tighter">Following</span>
							</div>
						</div>

						<div class="card-actions justify-end mt-6">
							<a href={`/blog/${account.blogName}`} class="btn btn-sm btn-ghost gap-2 text-gray-400 hover:text-white group-hover:bg-gray-800">
								View Blog
							</a>
							<a href={`/blog/${account.blogName}/likes`} class="btn btn-sm btn-outline border-gray-800 hover:bg-gray-800 text-gray-400">
								See Likes
							</a>
							{#if !isOffline}
								<button 
									class="btn btn-sm btn-primary gap-2" 
									onclick={() => cacheAllFavs(account)}
									disabled={downloadingFavs[account.blogName]?.active}
								>
									{#if downloadingFavs[account.blogName]?.active}
										<Loader2 size={16} class="animate-spin" />
										<span class="flex flex-col items-start leading-tight">
											<span class="text-xs">Posts: {downloadingFavs[account.blogName].fetchedPosts}</span>
											<span class="text-[10px] text-gray-200">New: {downloadingFavs[account.blogName].newMedia} | Cached: {downloadingFavs[account.blogName].skippedMedia}</span>
										</span>
									{:else}
										<Download size={16} />
										Cache Favs
									{/if}
								</button>
							{/if}
						</div>
					</div>
				</div>
			{:else}
				<div class="col-span-full py-20 flex flex-col items-center justify-center bg-gray-900/50 rounded-3xl border-2 border-dashed border-gray-800">
					<User size={48} class="text-gray-700 mb-4" />
					<p class="text-gray-400">No accounts connected yet.</p>
					<button class="btn btn-primary btn-sm mt-4">Connect Account</button>
				</div>
			{/each}
		</div>
	</div>
</div>

<style>
	:global(.card) {
		perspective: 1000px;
	}
</style>
