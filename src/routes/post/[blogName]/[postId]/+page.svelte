<script lang="ts">
	import { onMount } from "svelte";
	import { accounts } from "$lib/stores/accounts";
	import NPFRenderer from "$lib/components/NPFRenderer.svelte";
	import { ArrowLeft, User, Heart, MessageSquare, Repeat2, Clock, Grid, Image as ImageIcon, Heart as HeartIcon, Check, Loader2, Repeat2 as RepeatIcon, ListFilter, Quote } from "lucide-svelte";
	import InfiniteScroll from "$lib/components/InfiniteScroll.svelte";

	let { data } = $props();
	let blogName = $derived(data.blogName);
	let postId = $derived(data.postId);

	let post = $state<any>(null);
	let notes = $state<any[]>([]);
	let loading = $state(true);
	let error = $state("");
	let useGrid = $state(true);

	// Tracking like/reblog status for active accounts
	let accountLikes = $state<Record<string, boolean>>({});
	let rebloggedAccounts = $state<Record<string, boolean>>({});
	let likingAccount = $state<string | null>(null);
	let rebloggingAccount = $state<string | null>(null);

	async function loadPost() {
		const activeAccs = $accounts.filter(a => a.active);
		if (activeAccs.length === 0) {
			error = "Please activate at least one account to view details.";
			loading = false;
			return;
		}

		loading = true;
		error = "";
		try {
			// Fetch the post from ALL active accounts in parallel to get per-account liked state
			const results = await Promise.all(
				activeAccs.map(acc =>
					fetch(`/api/posts/detail`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ account: acc, blogName, postId })
					}).then(r => r.json())
				)
			);

			// Use the first result for the main post data & notes
			const primary = results[0];
			post = primary.post;
			notes = primary.notes || [];

			// Seed like/reblog state from each account's own response
			const initialLikes: Record<string, boolean> = {};
			const initialReblogs: Record<string, boolean> = {};

			results.forEach((result, i) => {
				const acc = activeAccs[i];
				// `liked` is per-authenticated-user — Tumblr returns this per OAuth token
				initialLikes[acc.blogName] = result.liked === true;
				// For reblogs, check the notes for this blog name
				initialReblogs[acc.blogName] = (result.notes || []).some(
					(n: any) => n.type === 'reblog' && n.blog_name === acc.blogName
				);
			});

			accountLikes = initialLikes;
			rebloggedAccounts = initialReblogs;
		} catch (err: any) {
			error = err.message;
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (blogName && postId) {
			loadPost();
		}
	});

	async function toggleLike(account: any) {
		if (likingAccount) return;
		const currentlyLiked = accountLikes[account.blogName] || false;
		const action = currentlyLiked ? "unlike" : "like";
		likingAccount = account.blogName;
		try {
			const res = await fetch("/api/posts/like", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					account,
					postId: post.id_string || post.id,
					reblogKey: post.reblog_key,
					action: currentlyLiked ? "unlike" : "like",
				}),
			});
			if (!res.ok) throw new Error(`Failed to ${action} post`);
			accountLikes[account.blogName] = !currentlyLiked;
		} catch (err: any) {
			console.error("Like error:", err);
		} finally {
			likingAccount = null;
		}
	}

	async function handleReblog(account: any) {
		if (rebloggingAccount || rebloggedAccounts[account.blogName]) return;
		rebloggingAccount = account.blogName;
		try {
			const res = await fetch("/api/posts/reblog", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					account,
					postId: post.id_string || post.id,
					reblogKey: post.reblog_key
				}),
			});
			if (!res.ok) throw new Error("Failed to reblog post");
			rebloggedAccounts[account.blogName] = true;
		} catch (err: any) {
			console.error("Reblog error:", err);
		} finally {
			rebloggingAccount = null;
		}
	}

	let activeAccounts = $derived($accounts.filter(a => a.active));
	
	// Right Column Tabs
	let activeTab = $state('trail'); // trail, reblog, notes, comments
	
	let replies = $derived(notes.filter(n => n.type === 'reply' || n.reply_text));
	let reblogNotes = $derived(notes.filter(n => n.type === 'reblog'));
	let likeNotes = $derived(notes.filter(n => n.type === 'like'));

	// Count total media blocks across trail + post content
	let mediaCount = $derived(() => {
		if (!post) return 0;
		const countBlocks = (blocks: any[]) =>
			(blocks || []).filter((b: any) => b.type === 'image' || b.type === 'video').length;
		const trailCount = (post.trail || []).reduce((sum: number, item: any) => sum + countBlocks(item.content || []), 0);
		return trailCount + countBlocks(post.content || []);
	});
</script>

<svelte:head>
	<style>
		body { overflow: hidden !important; }
	</style>
</svelte:head>

<div class="flex flex-col bg-black" style="height: calc(100vh - 64px); overflow: hidden;">
	<!-- Global Navigation -->
	<div class="sticky top-0 z-50 bg-black/80 backdrop-blur-md border-b border-gray-800 px-4 py-3 flex items-center justify-between">
		<button onclick={() => history.back()} class="btn btn-ghost btn-sm gap-2 text-white hover:bg-gray-800">
			<ArrowLeft size={18} /> Back
		</button>

		<!-- Post title in the centre -->
		<div class="absolute left-1/2 -translate-x-1/2 pointer-events-none max-w-sm truncate text-center">
			{#if post?.summary}
				<span class="text-sm font-bold text-white">{post.summary}</span>
			{/if}
		</div>

		<div class="flex items-center gap-2">
			<span class="text-xs font-bold text-gray-500 uppercase tracking-widest">Viewing Post</span>
			<span class="text-xs font-black text-white px-2 py-1 bg-gray-800 rounded-lg">{postId}</span>
		</div>
	</div>

	{#if loading}
		<div class="flex h-[80vh] items-center justify-center">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:else if error}
		<div class="p-8 max-w-2xl mx-auto">
			<div class="alert alert-error shadow-2xl rounded-3xl">
				<span class="font-bold text-lg">Error: {error}</span>
			</div>
		</div>
	{:else if post}
		<div class="flex-1 grid grid-cols-1 xl:grid-cols-[350px_1fr_400px] overflow-hidden">
			
			<!-- LEFT COLUMN: Account & Primary Actions -->
			<aside class="bg-gray-900 border-r border-gray-800 flex flex-col h-full overflow-y-auto custom-scrollbar">
				<div class="p-8">
					<!-- Author Card -->
					<div class="bg-black/40 rounded-3xl p-6 border border-gray-800 mb-8 shadow-inner">
						<div class="flex items-center gap-3 mb-6">
							<a href="/blog/{post.blog_name}" class="avatar hover:opacity-80 transition-opacity">
								<div class="w-12 h-12 rounded-xl ring-2 ring-gray-800">
									<img src={`https://api.tumblr.com/v2/blog/${post.blog_name}/avatar/128`} alt={post.blog_name} />
								</div>
							</a>
							<div>
								<a href="/blog/{post.blog_name}" class="text-sm font-black text-white truncate hover:text-primary transition-colors block">{post.blog_name}</a>
								<div class="flex items-center gap-1.5 text-gray-500">
									<Clock size={12} />
									<span class="text-xs font-bold">{new Date(post.timestamp * 1000).toLocaleDateString()}</span>
								</div>
							</div>
						</div>

						<!-- Layout Switcher Tabs — only when more than 1 media item -->
						{#if mediaCount() > 1}
						<div class="flex p-1 bg-gray-900 rounded-2xl border border-gray-800 mb-2">
							<button 
								class="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl transition-all font-black text-xs {useGrid ? 'bg-primary text-white shadow-lg' : 'text-gray-400 hover:text-white'}"
								onclick={() => useGrid = true}
							>
								<Grid size={16} /> Grid
							</button>
							<button 
								class="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl transition-all font-black text-xs {!useGrid ? 'bg-primary text-white shadow-lg' : 'text-gray-400 hover:text-white'}"
								onclick={() => useGrid = false}
							>
								<ImageIcon size={16} /> Carousel
							</button>
						</div>
						{/if}

						<!-- Tags -->
						{#if post.tags && post.tags.length > 0}
							<div class="mt-4 flex flex-wrap gap-2">
								{#each post.tags as tag}
									<a 
										href="/search?q=%23{encodeURIComponent(tag)}"
										class="text-[10px] font-black uppercase tracking-wider text-gray-500 bg-black/40 border border-gray-800 px-2 py-1 rounded-lg hover:bg-primary hover:text-white hover:border-primary transition-all"
									>
										#{tag}
									</a>
								{/each}
							</div>
						{/if}
					</div>

					<!-- Interaction Section -->
					<div class="space-y-4">
						<h3 class="text-[10px] font-black uppercase text-gray-600 tracking-[0.2em] px-4">Interactions</h3>
						
						<div class="space-y-6">
							{#each activeAccounts as account}
								{@const isLiked = accountLikes[account.blogName]}
								{@const isReblogged = rebloggedAccounts[account.blogName]}
								<div class="bg-black/30 rounded-3xl p-5 border border-gray-800/50">
									<div class="flex items-center gap-3 mb-4">
										<div class="w-8 h-8 rounded-lg overflow-hidden border border-gray-800">
											<img src={`https://api.tumblr.com/v2/blog/${account.blogName}/avatar/64`} alt="" />
										</div>
										<span class="text-sm font-black text-white truncate">{account.blogName}</span>
									</div>
									<div class="grid grid-cols-2 gap-3">
										<button 
											class="btn btn-sm h-11 rounded-2xl border-gray-800 gap-2 transition-all {isLiked ? 'bg-pink-500/10 border-pink-500/50 text-pink-500' : 'bg-gray-800/50 hover:bg-gray-800 text-gray-400'}"
											onclick={() => toggleLike(account)}
											disabled={likingAccount === account.blogName}
										>
											{#if likingAccount === account.blogName}
												<Loader2 size={16} class="animate-spin" />
											{:else}
												<HeartIcon size={16} fill={isLiked ? "currentColor" : "none"} />
											{/if}
											<span class="font-bold">{isLiked ? 'Liked' : 'Like'}</span>
										</button>

										<button 
											class="btn btn-sm h-11 rounded-2xl border-gray-800 gap-2 transition-all {isReblogged ? 'bg-green-500/10 border-green-500/50 text-green-500 pointer-events-none' : 'bg-gray-800/50 hover:bg-gray-800 text-gray-400'}"
											onclick={() => handleReblog(account)}
											disabled={rebloggingAccount === account.blogName}
										>
											{#if rebloggingAccount === account.blogName}
												<Loader2 size={16} class="animate-spin" />
											{:else if isReblogged}
												<Check size={16} />
											{:else}
												<RepeatIcon size={16} />
											{/if}
											<span class="font-bold">{isReblogged ? 'Reblogged' : 'Reblog'}</span>
										</button>
									</div>
								</div>
							{/each}
						</div>
					</div>
				</div>
			</aside>

			<!-- MIDDLE COLUMN: Content Stage — fills entire height, no scrollbar -->
			<main class="h-full bg-black flex flex-col overflow-hidden">
				<div class="flex-1 flex flex-col min-h-0">
					<!-- Reblog Trail Content -->
					{#if post.trail && post.trail.length > 0}
						{#each post.trail as item}
							{#if item.content && item.content.length > 0}
								<div class="flex-1 flex flex-col min-h-0">
									<NPFRenderer content={item.content} {useGrid} fillHeight={true} />
								</div>
							{/if}
						{/each}
					{/if}

					<!-- This Post's Added Content (if any) -->
					{#if post.content && post.content.length > 0}
						<div class="flex-1 flex flex-col min-h-0">
							<NPFRenderer content={post.content} {useGrid} fillHeight={true} />
						</div>
					{/if}
				</div>
			</main>

			<!-- RIGHT COLUMN: Trail, Reblogs, Notes, Comments Tabs -->
			<aside class="bg-gray-900 border-l border-gray-800 flex flex-col h-full overflow-hidden">
				<!-- Detailed Tab Switcher -->
				<div class="grid grid-cols-4 bg-black/40 border-b border-gray-800">
					<button 
						class="flex flex-col items-center justify-center py-4 font-black text-[9px] uppercase tracking-tighter transition-all border-b-2 {activeTab === 'trail' ? 'border-primary text-white bg-white/5' : 'border-transparent text-gray-500 hover:text-white'}"
						onclick={() => activeTab = 'trail'}
					>
						<Quote size={14} class="mb-1" /> Trail
					</button>
					<button 
						class="flex flex-col items-center justify-center py-4 font-black text-[9px] uppercase tracking-tighter transition-all border-b-2 {activeTab === 'reblog' ? 'border-primary text-white bg-white/5' : 'border-transparent text-gray-500 hover:text-white'}"
						onclick={() => activeTab = 'reblog'}
					>
						<Repeat2 size={14} class="mb-1" /> Reblogs
					</button>
					<button 
						class="flex flex-col items-center justify-center py-4 font-black text-[9px] uppercase tracking-tighter transition-all border-b-2 {activeTab === 'notes' ? 'border-primary text-white bg-white/5' : 'border-transparent text-gray-500 hover:text-white'}"
						onclick={() => activeTab = 'notes'}
					>
						<Heart size={14} class="mb-1" /> Likes
					</button>
					<button 
						class="flex flex-col items-center justify-center py-4 font-black text-[9px] uppercase tracking-tighter transition-all border-b-2 {activeTab === 'comments' ? 'border-primary text-white bg-white/5' : 'border-transparent text-gray-500 hover:text-white'}"
						onclick={() => activeTab = 'comments'}
					>
						<MessageSquare size={14} class="mb-1" /> Comments
					</button>
				</div>

				<div class="flex-1 overflow-y-auto custom-scrollbar p-6">
					{#if activeTab === 'trail'}
						<!-- Pure text trail for context -->
						{#if post.trail && post.trail.length > 0}
							<div class="space-y-6">
								{#each post.trail as item}
									<div class="border-l-2 border-gray-800 pl-4 py-1">
										<a href="/blog/{item.blog?.name}" class="text-xs font-black text-primary mb-2 uppercase hover:underline block">{item.blog?.name}</a>
										<div class="text-xs text-gray-400 italic line-clamp-4">
											{#each item.content || [] as block}
												{#if block.type === 'text'}{block.text} {/if}
											{/each}
										</div>
									</div>
								{/each}
							</div>
						{:else}
							<div class="h-full flex items-center justify-center text-gray-600 italic text-sm">No trail available.</div>
						{/if}

					{:else if activeTab === 'reblog'}
						<div class="space-y-3">
							{#each reblogNotes as note}
								<div class="flex items-center gap-3 p-2 bg-black/20 rounded-xl border border-gray-800/50">
									<img src={`https://api.tumblr.com/v2/blog/${note.blog_name}/avatar/64`} class="w-6 h-6 rounded-md" alt="" />
									<a href="/blog/{note.blog_name}" class="text-xs font-bold text-white hover:text-primary transition-colors flex-1 truncate">{note.blog_name}</a>
									{#if note.post_id}
										<a href="/post/{note.blog_name}/{note.post_id}" class="text-green-500 hover:text-green-400 transition-colors" title="View reblog">
											<Repeat2 size={14} />
										</a>
									{:else}
										<Repeat2 size={10} class="text-green-500" />
									{/if}
								</div>
							{/each}
							{#if reblogNotes.length === 0}
								<div class="py-12 text-center text-gray-600 italic text-sm">No reblogs yet.</div>
							{/if}
						</div>

					{:else if activeTab === 'notes'}
						<div class="space-y-3">
							{#each likeNotes as note}
								<div class="flex items-center gap-3 p-2 bg-black/20 rounded-xl border border-gray-800/50">
									<img src={`https://api.tumblr.com/v2/blog/${note.blog_name}/avatar/64`} class="w-6 h-6 rounded-md" alt="" />
									<a href="/blog/{note.blog_name}" class="text-xs font-bold text-white hover:text-primary transition-colors flex-1 truncate">{note.blog_name}</a>
									<Heart size={10} class="text-pink-500" fill="currentColor" />
								</div>
							{/each}
							{#if likeNotes.length === 0}
								<div class="py-12 text-center text-gray-600 italic text-sm">No likes yet.</div>
							{/if}
						</div>

					{:else if activeTab === 'comments'}
						<div class="space-y-4">
							{#each replies as note}
								<div class="p-4 bg-black/40 rounded-2xl border border-gray-800">
									<div class="flex items-center gap-3 mb-3">
										<img src={`https://api.tumblr.com/v2/blog/${note.blog_name}/avatar/64`} class="w-8 h-8 rounded-lg" alt="" />
									<a href="/blog/{note.blog_name}" class="text-xs font-black text-white hover:text-primary transition-colors">{note.blog_name}</a>
									</div>
									<p class="text-sm text-gray-300 bg-gray-900/50 p-3 rounded-xl border border-gray-800/50">
										{note.reply_text || note.added_text || "Left a comment."}
									</p>
								</div>
							{/each}
							{#if replies.length === 0}
								<div class="py-12 text-center text-gray-600 italic text-sm">No comments found.</div>
							{/if}
						</div>
					{/if}
				</div>
			</aside>
		</div>
	{/if}
</div>

<style>
	.custom-scrollbar::-webkit-scrollbar {
		width: 4px;
	}
	.custom-scrollbar::-webkit-scrollbar-track {
		background: transparent;
	}
	.custom-scrollbar::-webkit-scrollbar-thumb {
		background: #1f2937;
		border-radius: 10px;
	}
	.custom-scrollbar::-webkit-scrollbar-thumb:hover {
		background: #374151;
	}
</style>
