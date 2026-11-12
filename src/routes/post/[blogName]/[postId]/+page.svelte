<script lang="ts">
	import { onMount } from "svelte";
	import { dev } from "$app/env";
	import { page } from "$app/state";
	import { accounts, accountsReady } from "#lib/stores/accounts";
	import NPFRenderer from "#lib/components/NPFRenderer.svelte";
	import AvatarImage from "#lib/components/AvatarImage.svelte";
	import { ArrowLeft, User, Heart, MessageSquare, Repeat2, Clock, Grid, Image as ImageIcon, Heart as HeartIcon, Check, Loader2, Repeat2 as RepeatIcon, ListFilter, Quote, Maximize, Minimize, WifiOff } from "@lucide/svelte";
	import { bulkSetPosts, getCachedPostById, mergeNotes } from '#lib/cache/posts';
	import { getMediaForPost, type MediaRef } from '#lib/cache/blobs';
	import InfiniteScroll from "#lib/components/InfiniteScroll.svelte";
	import LegacyPostContent from "#lib/components/LegacyPostContent.svelte";
	import { noteKey } from '#lib/notes';
	import { isNpfPost } from 'postferry';

	let { data }: { data: { blogName: string; postId: string } } = $props();
	let blogName = $derived(data.blogName);
	let postId = $derived(data.postId);

	let isOfflinePost = $derived(page.url.searchParams.get('offline') === '1');

	let post = $state<any>(null);
	let notes = $state<any[]>([]);
	let loading = $state(true);
	let error = $state("");
	let useGrid = $state(true);
	let showDebug = $state(false);
	// IndexedDB blobsByPost view; populated on offline load so media
	// metadata is available without re-extracting URLs from NPF content.
	let linkedMedia = $state<MediaRef[]>([]);
	// Notes pagination
	let notesLoading = $state(false);
	let notesHasMore = $state(false);
	let notesBeforeTimestamp = $state<number | null>(null);
	let noteTotalsLoading = $state(false);
	let noteTotals = $state({ likes: 0, reblogs: 0, comments: 0, processed: 0, complete: false });
	let noteTotalsRun = 0;

	function summarizeNotes(list: any[]) {
		let likes = 0;
		let reblogs = 0;
		let comments = 0;
		for (const note of list) {
			if (note?.type === 'like') likes++;
			if (note?.type === 'reblog') reblogs++;
			if (note?.type === 'reply' || note?.reply_text) comments++;
		}
		return { likes, reblogs, comments };
	}

	async function loadAllNoteTotals(account: any, initialNotes: any[], initialBeforeTimestamp: number | null) {
		if (!post || !account || !initialBeforeTimestamp) return;
		const runId = ++noteTotalsRun;
		noteTotalsLoading = true;

		const seen = new Set<string>(initialNotes.map((n) => noteKey(n)));
		const base = summarizeNotes(initialNotes);
		let likes = base.likes;
		let reblogs = base.reblogs;
		let comments = base.comments;
		let processed = initialNotes.length;
		let cursor = initialBeforeTimestamp;

		try {
			// Eagerly page through notes ONLY while the API keeps giving new
			// ones. Tumblr's notes pagination repeats the tail page once the
			// cursor passes the oldest note — an unbounded loop there burned
			// the rate limit (hundreds of identical requests per page view).
			// Three guards now: stall detection (no new notes), no cursor
			// advance, and a hard page budget. Totals stay approximate beyond
			// that; "load more notes" fetches the rest on demand.
			const MAX_NOTE_PAGES = 5;
			for (let page = 0; page < MAX_NOTE_PAGES; page++) {
				if (!cursor) break;
				const res = await fetch(`/api/posts/detail`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						accounts: [account],
						blogName,
						postId,
						before_timestamp: cursor
					})
				});
				if (!res.ok) break;
				const data = await res.json();
				const batch: any[] = data.notes || [];
				if (runId !== noteTotalsRun) return;
				if (batch.length === 0) break;

				let added = 0;
				for (const note of batch) {
					const key = noteKey(note);
					if (seen.has(key)) continue;
					seen.add(key);
					added++;
					processed++;
					if (note?.type === 'like') likes++;
					if (note?.type === 'reblog') reblogs++;
					if (note?.type === 'reply' || note?.reply_text) comments++;
				}

				// Stalled: the API returned only notes we already have — same
				// page would repeat forever. Stop instead of re-requesting.
				if (added === 0) break;

				const nextCursor = batch[batch.length - 1]?.timestamp ?? null;
				if (nextCursor === null || nextCursor >= cursor) break;
				cursor = nextCursor;

				noteTotals = {
					likes,
					reblogs,
					comments,
					processed,
					complete: processed >= (post?.note_count ?? processed)
				};

				if (processed >= (post?.note_count ?? processed)) break;
			}

			if (runId === noteTotalsRun) {
				// complete stays false when the budget/stall guards stopped us —
				// the UI keeps showing the "load more notes" affordance.
				noteTotals = {
					likes,
					reblogs,
					comments,
					processed,
					complete: processed >= (post?.note_count ?? processed)
				};
			}
		} catch (e) {
			console.error('Failed to aggregate note totals:', e);
		} finally {
			if (runId === noteTotalsRun) {
				noteTotalsLoading = false;
			}
		}
	}

	// Tracking like/reblog status for active accounts
	let accountLikes = $state<Record<string, boolean>>({});
	let rebloggedAccounts = $state<Record<string, boolean>>({});
	let likingAccount = $state<string | null>(null);
	let rebloggingAccount = $state<string | null>(null);

	async function loadPost() {
		if (!$accountsReady) {
			loading = true;
			error = "";
			return;
		}

		const activeAccs = $accounts.filter(a => a.active);
		if (activeAccs.length === 0) {
			error = "Please activate at least one account to view details.";
			loading = false;
			return;
		}

		loading = true;
		error = "";
		try {
			// One request: the server fans out to every active account, merges
			// per-account liked/reblogged state, and returns the post plus the
			// first page of notes.
			const response = await fetch('/api/posts/detail', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ accounts: activeAccs, blogName, postId })
			});
			const data = await response.json();
			if (!response.ok) throw new Error(data.error || 'Failed to fetch post details.');

			post = data.post;
			const initialNotes: any[] = data.notes || [];
			const totalNotes = Number(data.total_notes ?? post?.note_count ?? 0);
			notes = initialNotes;

			// Cache the post for offline reading. `bulkSetPosts` dedupes by id
			// and preserves the first-seen cachedAt, so this is idempotent.
			if (post?.id !== undefined && post?.id !== null) {
				void bulkSetPosts([post]);
			}

			if (initialNotes.length > 0) {
				void mergeNotes(postId, initialNotes);
			}

			if (notes.length > 0) {
				notesHasMore = notes.length < totalNotes;
				notesBeforeTimestamp = notes[notes.length - 1]?.timestamp ?? null;
			}

			noteTotals = {
				...summarizeNotes(notes),
				processed: notes.length,
				complete: totalNotes <= notes.length
			};

			// Per-account state comes from the merged response.
			const states = (data.accountStates ?? {}) as Record<string, { liked?: boolean; reblogged?: boolean }>;
			const initialLikes: Record<string, boolean> = {};
			const initialReblogs: Record<string, boolean> = {};
			for (const acc of activeAccs) {
				initialLikes[acc.blogName] = states[acc.blogName]?.liked === true;
				initialReblogs[acc.blogName] = states[acc.blogName]?.reblogged === true;
			}

			accountLikes = initialLikes;
			rebloggedAccounts = initialReblogs;

			if (notesHasMore && notesBeforeTimestamp) {
				loadAllNoteTotals(activeAccs[0], notes, notesBeforeTimestamp);
			}
		} catch (err: any) {
			error = err.message;
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		const ready = $accountsReady;
		const offline = isOfflinePost;

		// Offline mode skips the account/network path entirely.
		if (offline) {
			if (blogName && postId) loadOfflinePost();
			return;
		}

		if (!ready) {
			loading = true;
			error = "";
			return;
		}

		if (blogName && postId) {
			loadPost();
		}
	});

async function loadOfflinePost() {
	loading = true;
	error = "";
	post = null;
	notes = [];
	try {
		// Post ids are 64-bit; keep the route's string id, never Number() it.
		const entry = await getCachedPostById(postId);
		if (entry?.post) {
			post = entry.post;
			const embeddedNotes = Array.isArray(entry.notes) ? entry.notes : [];
			const seen = new Set<string>();
			const merged: any[] = [];
			for (const n of embeddedNotes) {
				if (!n) continue;
				const k = `${n.blog_name}_${n.timestamp}_${n.type}`;
				if (seen.has(k)) continue;
				seen.add(k);
				merged.push(n);
			}
			notes = merged;
			// Warm the linked-media index view. The byPost index now exposes
			// every blob key we wrote atomically with the post, so the UI can
			// hydrate offline with zero network calls.
			try {
				linkedMedia = await getMediaForPost(postId);
			} catch (e) {
				console.warn('[offline] failed to load linked media metadata', e);
				linkedMedia = [];
			}
			const totals = summarizeNotes(notes);
			noteTotals = {
				...totals,
				processed: notes.length,
				complete: notes.length >= (post?.note_count ?? 0)
			};
			notesHasMore = false;
			notesBeforeTimestamp = null;
			accountLikes = {};
			rebloggedAccounts = {};
		} else {
			error = "This post is not in your offline cache. Visit a feed while online to cache it.";
		}
	} catch (e) {
		error = e instanceof Error ? e.message : "Failed to read offline cache.";
	} finally {
		loading = false;
	}
}
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
					accounts: [account],
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
					accounts: [account],
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
	let reblogWithComment = $derived(reblogNotes.filter(n => n.added_text));
	let likeNotes = $derived(notes.filter(n => n.type === 'like'));
	// Comments = explicit reply notes.
	let commentNotes = $derived(replies.filter(
		(n, i, arr) => arr.findIndex(x => x.timestamp === n.timestamp && x.blog_name === n.blog_name) === i
	));

	async function loadMoreNotes() {
		if (notesLoading || !notesHasMore || !post) return;
		const activeAccs = $accounts.filter(a => a.active);
		if (activeAccs.length === 0) return;
		notesLoading = true;
		try {
			const res = await fetch(`/api/posts/detail`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					accounts: [activeAccs[0]],
					blogName,
					postId,
					before_timestamp: notesBeforeTimestamp
				})
			});
			const data = await res.json();
			const newNotes: any[] = data.notes || [];
			if (newNotes.length === 0) {
				notesHasMore = false;
			} else {
				const existingKeys = new Set(notes.map((n) => noteKey(n)));
				const unique = newNotes.filter((n) => !existingKeys.has(noteKey(n)));
				notes = [...notes, ...unique];
				if (unique.length > 0) {
					void mergeNotes(postId, unique);
					const add = summarizeNotes(unique);
					noteTotals = {
						likes: noteTotals.likes + add.likes,
						reblogs: noteTotals.reblogs + add.reblogs,
						comments: noteTotals.comments + add.comments,
						processed: noteTotals.processed + unique.length,
						complete: noteTotals.complete
					};
				}
				notesBeforeTimestamp = newNotes[newNotes.length - 1]?.timestamp ?? null;
				notesHasMore = unique.length > 0 && notes.length < (post?.note_count ?? 0);
			}
		} catch (e) {
			console.error('Failed to load more notes:', e);
		} finally {
			notesLoading = false;
		}
	}

	// Count total media blocks across trail + post content
	let reblogTextOnly = $state(false);
	let mediaCount = $derived(
		!post
			? 0
			: ((post.trail || []).reduce(
					(sum: number, item: any) =>
						sum +
						((item.content || []).filter((b: any) => b.type === 'image' || b.type === 'video').length),
					0
			  ) +
			  ((post.content || []).filter((b: any) => b.type === 'image' || b.type === 'video').length))
	);

	// Reblog header fallback values that gracefully handle broken trail items.
	let trailFirst = $derived(post?.trail?.[0]);
	let trailLast = $derived(post?.trail?.[post?.trail?.length - 1]);
	let fromBlogName = $derived(post?.reblogged_from_name || trailLast?.blog?.name);
	let fromName = $derived(fromBlogName || trailLast?.broken_blog_name || '[deleted blog]');
	let fromId = $derived(post?.reblogged_from_id || trailLast?.post?.id);
	let rootBlogName = $derived(post?.reblogged_root_name || trailFirst?.blog?.name);
	let rootName = $derived(rootBlogName || trailFirst?.broken_blog_name);
	let rootId = $derived(post?.reblogged_root_id || trailFirst?.post?.id);

	let publishedAt = $derived(post?.timestamp ? new Date(post.timestamp * 1000) : null);
	let publishedDateLabel = $derived(publishedAt ? publishedAt.toLocaleDateString() : 'Unknown');
	let publishedTimeLabel = $derived(publishedAt ? publishedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
	let loadedNotesCount = $derived(notes.length);
	let totalNotesCount = $derived(post?.note_count ?? 0);
	let effectiveReblogCount = $derived(noteTotals.complete ? noteTotals.reblogs : Math.max(post?.reblog_count ?? 0, noteTotals.reblogs, reblogNotes.length));
	let effectiveLikeCount = $derived(noteTotals.complete ? noteTotals.likes : Math.max(post?.like_count ?? 0, noteTotals.likes, likeNotes.length));
	let loadedCommentCount = $derived(noteTotals.complete ? noteTotals.comments : Math.max(noteTotals.comments, commentNotes.length));
	let postUrl = $derived(post?.post_url || post?.short_url || null);
	let sourceUrl = $derived(post?.source_url || null);
	let sourceTitle = $derived(post?.source_title || null);
	let npfTestLoading = $state(false);
	let npfTestResult = $state<any>(null);
	let npfTestRaw = $state<any>(null);

	async function runNpfTestFetch() {
		const activeAccs = $accounts.filter(a => a.active);
		if (activeAccs.length === 0) {
			npfTestResult = { ok: false, error: 'No active account selected.' };
			return;
		}

		npfTestLoading = true;
		npfTestResult = null;
		npfTestRaw = null;
		try {
			const payloadBase = {
				accounts: [activeAccs[0]],
				blogName,
				postId
			};

			const [resNpf, resLegacy] = await Promise.all([
				fetch('/api/posts/detail', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ ...payloadBase, npf: true })
				}),
				fetch('/api/posts/detail', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ ...payloadBase, npf: false })
				})
			]);

			const [dataNpf, dataLegacy] = await Promise.all([resNpf.json(), resLegacy.json()]);
			npfTestRaw = {
				npfTrue: dataNpf,
				npfFalse: dataLegacy
			};

			const testedPost = dataNpf?.post || dataNpf?.response?.posts?.[0] || null;
			const legacyPost = dataLegacy?.post || dataLegacy?.response?.posts?.[0] || null;
			const identical = JSON.stringify(dataNpf) === JSON.stringify(dataLegacy);
			npfTestResult = {
				ok: resNpf.ok && resLegacy.ok,
				statusNpf: resNpf.status,
				statusLegacy: resLegacy.status,
				identicalResponse: identical,
				hasPost: !!testedPost,
				hasNpfContent: Array.isArray(testedPost?.content),
				contentBlocks: Array.isArray(testedPost?.content) ? testedPost.content.length : 0,
				legacyHasContent: Array.isArray(legacyPost?.content),
				legacyContentBlocks: Array.isArray(legacyPost?.content) ? legacyPost.content.length : 0,
				hasTrail: Array.isArray(testedPost?.trail),
				trailItems: Array.isArray(testedPost?.trail) ? testedPost.trail.length : 0,
				notesReturned: Array.isArray(dataNpf?.notes) ? dataNpf.notes.length : 0
			};
		} catch (e: any) {
			npfTestResult = { ok: false, error: e?.message || 'NPF test fetch failed.' };
			npfTestRaw = { error: e?.message || 'NPF test fetch failed.' };
		} finally {
			npfTestLoading = false;
		}
	}
</script>

<svelte:head>
	<style>
		@media (min-width: 1280px) {
			body { overflow: hidden !important; }
		}
	</style>
</svelte:head>

<div class="flex flex-col bg-black min-h-dvh xl:h-[calc(100dvh-64px)] xl:overflow-hidden">
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
			{#if dev && post}
				<button class="btn btn-xs btn-outline btn-warning border-dashed uppercase tracking-widest text-[9px] font-black mr-2 hidden sm:flex" onclick={() => showDebug = true}>
					Debug API
				</button>
			{/if}
			<span class="hidden sm:inline text-xs font-bold text-gray-500 uppercase tracking-widest">Viewing Post</span>
			<span class="text-xs font-black text-white px-2 py-1 bg-gray-800 rounded-lg">{postId}</span>
			{#if post?.type}
				<span class="hidden sm:inline text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border border-primary/30 text-primary bg-primary/10">
					{post.type}
				</span>
			{/if}
			{#if isOfflinePost}
				<span
					title="Loaded from your local media cache — live notes disabled"
					class="hidden sm:flex items-center gap-1 text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border border-amber-500/40 text-amber-400 bg-amber-500/10"
				>
					<WifiOff size={12} /> Offline
				</span>
				{#if post}
					<a
						href={`/post/${post.blog_name}/${post.id_string || post.id}`}
						class="hidden sm:inline text-[10px] font-bold text-primary hover:underline uppercase tracking-widest"
					>Load live</a>
				{/if}
			{/if}
		</div>
	</div>

	{#if loading}
		<div class="flex h-[80dvh] items-center justify-center">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:else if error}
		<div class="p-8 max-w-2xl mx-auto">
			<div class="alert alert-error shadow-2xl rounded-3xl">
				<span class="font-bold text-lg">Error: {error}</span>
			</div>
		</div>
	{:else if post}
		<div class="flex-1 grid grid-cols-1 xl:grid-cols-[350px_1fr_400px] xl:overflow-hidden">
			
			<!-- LEFT COLUMN: Account & Primary Actions -->
			<aside class="bg-gray-900 xl:border-r border-gray-800 flex flex-col h-auto xl:h-full xl:overflow-y-auto custom-scrollbar order-2 xl:order-1">
				<div class="p-8">
					<!-- Author Card -->
					<div class="bg-black/40 rounded-3xl p-6 border border-gray-800 mb-8 shadow-inner">
						<div class="flex items-center gap-3 mb-6">
							<a href="/blog/{post.blog_name}" class="avatar hover:opacity-80 transition-opacity">
								<div class="w-12 h-12 rounded-xl ring-2 ring-gray-800">
									<AvatarImage blogName={post.blog_name} size={128} />
								</div>
							</a>
							<div>
								<a href="/blog/{post.blog_name}" class="text-sm font-black text-white truncate hover:text-primary transition-colors block">{post.blog_name}</a>
								<div class="flex items-center gap-1.5 text-gray-500 mt-1">
									<Clock size={12} />
									<span class="text-[11px] font-bold leading-none">{publishedDateLabel} {publishedTimeLabel ? `• ${publishedTimeLabel}` : ''}</span>
								</div>
							</div>
						</div>

						<!-- Layout Switcher Tabs — only when more than 1 media item -->
						{#if mediaCount > 1}
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

						<!-- Useful API metadata summary -->
						<div class="mt-5 rounded-2xl border border-gray-800/70 bg-black/30 p-4 space-y-3">
							<div class="flex items-center justify-between">
								<span class="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">Post Metadata</span>
								<span class="text-[10px] font-mono text-gray-600">ID {post.id_string || post.id}</span>
							</div>

							<div class="grid grid-cols-2 gap-2">
								<div class="rounded-lg border border-gray-800 bg-black/30 px-2 py-1.5">
									<div class="text-[9px] uppercase font-black tracking-widest text-gray-600">Notes</div>
									<div class="text-xs font-bold text-white">{loadedNotesCount}/{totalNotesCount}</div>
								</div>
								<div class="rounded-lg border border-gray-800 bg-black/30 px-2 py-1.5">
									<div class="text-[9px] uppercase font-black tracking-widest text-gray-600">Reblogs</div>
									<div class="text-xs font-bold text-white">{effectiveReblogCount}</div>
								</div>
							</div>

							<div class="rounded-lg border border-gray-800 bg-black/30 px-2 py-1.5">
								<div class="text-[9px] uppercase font-black tracking-widest text-gray-600">Published</div>
								<div class="text-xs font-bold text-white">{publishedDateLabel}{publishedTimeLabel ? ` • ${publishedTimeLabel}` : ''}</div>
							</div>

							<div class="flex flex-wrap gap-1.5">
								{#if post.state}<span class="text-[9px] uppercase font-black tracking-wider px-1.5 py-1 rounded bg-gray-800 text-gray-300 border border-gray-700">{post.state}</span>{/if}
								{#if post.format}<span class="text-[9px] uppercase font-black tracking-wider px-1.5 py-1 rounded bg-gray-800 text-gray-300 border border-gray-700">{post.format}</span>{/if}
								{#if post.is_nsfw}<span class="text-[9px] uppercase font-black tracking-wider px-1.5 py-1 rounded bg-red-900/30 text-red-300 border border-red-800/60">NSFW</span>{/if}
								{#if post.note_count !== undefined && post.note_count !== null}<span class="text-[9px] uppercase font-black tracking-wider px-1.5 py-1 rounded bg-gray-800 text-gray-300 border border-gray-700">counted notes</span>{/if}
							</div>

							<div class="space-y-1.5">
								{#if postUrl}
									<a href={postUrl} target="_blank" rel="noopener noreferrer" class="block text-[11px] text-primary hover:underline truncate">Open on Tumblr</a>
								{/if}
								{#if sourceUrl}
									<a href={sourceUrl} target="_blank" rel="noopener noreferrer" class="block text-[11px] text-gray-400 hover:text-white hover:underline truncate">Source: {sourceTitle || sourceUrl}</a>
								{/if}
								{#if post.slug}
									<div class="text-[10px] text-gray-600 truncate">slug: {post.slug}</div>
								{/if}
							</div>
						</div>
					</div>

					<!-- Interaction Section -->
					{#if isOfflinePost}
						<div class="space-y-4">
							<h3 class="text-[10px] font-black uppercase text-gray-600 tracking-[0.2em] px-4">Interactions</h3>
							<div class="px-4 py-6 rounded-3xl border border-gray-800/50 bg-black/20 text-gray-500 text-sm">
								<p class="font-bold text-gray-400 mb-1">Disabled in offline mode</p>
								<p>Like and reblog require a live Tumblr session. Open the live version to interact.</p>
								<a
									href={`/post/${post?.blog_name}/${post?.id_string || post?.id}`}
									class="btn btn-sm btn-outline mt-3"
								>Open live</a>
							</div>
						</div>
					{:else}
					<div class="space-y-4">
						<h3 class="text-[10px] font-black uppercase text-gray-600 tracking-[0.2em] px-4">Interactions</h3>

						<div class="space-y-6">
							{#each activeAccounts as account}
								{@const isLiked = accountLikes[account.blogName]}
								{@const isReblogged = rebloggedAccounts[account.blogName]}
								<div class="bg-black/30 rounded-3xl p-5 border border-gray-800/50">
									<div class="flex items-center gap-3 mb-4">
										<div class="w-8 h-8 rounded-lg overflow-hidden border border-gray-800">
											<AvatarImage blogName={account.blogName} size={64} />
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
					{/if}
				</div>
			</aside>

			<!-- MIDDLE COLUMN: Content Stage -->
			<main class="h-auto xl:h-full bg-black flex flex-col xl:overflow-y-auto custom-scrollbar order-1 xl:order-2">
				<div class="w-full flex flex-col pb-8">
					{#if fromName}
						<div class="flex items-center gap-2 px-6 py-4 bg-gray-900 border-b border-gray-800 text-gray-400 text-sm">
							<Repeat2 size={16} class="text-gray-500 shrink-0" />
							<span class="font-medium">
								<a href="/blog/{post.blog_name}" class="font-bold text-white hover:text-primary transition-colors">{post.blog_name}</a>
								reblogged from 
								{#if fromId && fromBlogName}
									<a href="/post/{fromBlogName}/{fromId}" class="font-bold text-white hover:text-primary transition-colors">{fromName}</a>
								{:else}
									<span class="font-bold text-gray-300">{fromName}</span>
								{/if}
								
								{#if rootName && rootName !== fromName && rootName !== post.blog_name}
									<span class="opacity-75">
										(originally by
										{#if rootId && rootBlogName}
											<a href="/post/{rootBlogName}/{rootId}" class="font-bold text-white hover:text-primary transition-colors">{rootName}</a>
										{:else}
											<span class="font-bold text-gray-300">{rootName}</span>
										{/if})
									</span>
								{/if}
							</span>
						</div>
					{/if}
					
					<!-- Reblog Trail Content -->
					{#if post.trail && post.trail.length > 0}
						{#each post.trail as item}
							{#if item.content && item.content.length > 0}
								<div class="mb-10 pb-10 border-b border-gray-800/50 last:border-0 pt-6">
									<NPFRenderer content={item.content} {useGrid} />
								</div>
							{/if}
						{/each}
					{/if}

					<!-- This Post's Added Content (if any). The API still returns
					     legacy posts (body/photos/video/player) alongside NPF, so
					     fall back to the legacy renderer when content is absent. -->
					{#if isNpfPost(post)}
						<div class="{post.trail?.length > 0 ? 'mt-4' : 'pt-6'}">
							<NPFRenderer content={post.content} {useGrid} />
						</div>
					{:else}
						<div class="{post.trail?.length > 0 ? 'mt-4' : 'pt-6'}">
							<LegacyPostContent {post} />
						</div>
					{/if}
				</div>
			</main>

			<!-- RIGHT COLUMN: Trail, Reblogs, Notes, Comments Tabs -->
			<aside class="bg-gray-900 xl:border-l border-gray-800 flex flex-col h-auto xl:h-full xl:overflow-hidden order-3">
				<!-- Detailed Tab Switcher -->
				<div class="grid grid-cols-4 bg-black/40 border-b border-gray-800">
					<button 
						class="flex flex-col items-center justify-center py-4 font-black text-[9px] uppercase tracking-tighter transition-all border-b-2 {activeTab === 'trail' ? 'border-primary text-white bg-white/5' : 'border-transparent text-gray-500 hover:text-white'}"
						onclick={() => activeTab = 'trail'}
					>
						<Quote size={14} class="mb-1" />
						<span>Trail</span>
						{#if post.trail?.length > 0}<span class="text-[8px] opacity-60">{post.trail.length}</span>{/if}
					</button>
					<button 
						class="flex flex-col items-center justify-center py-4 font-black text-[9px] uppercase tracking-tighter transition-all border-b-2 {activeTab === 'reblog' ? 'border-primary text-white bg-white/5' : 'border-transparent text-gray-500 hover:text-white'}"
						onclick={() => activeTab = 'reblog'}
					>
						<Repeat2 size={14} class="mb-1" />
						<span>Reblogs</span>
						<span class="text-[8px] opacity-60">{effectiveReblogCount}{(notesHasMore || noteTotalsLoading) && !noteTotals.complete ? '+' : ''}</span>
					</button>
					<button 
						class="flex flex-col items-center justify-center py-4 font-black text-[9px] uppercase tracking-tighter transition-all border-b-2 {activeTab === 'notes' ? 'border-primary text-white bg-white/5' : 'border-transparent text-gray-500 hover:text-white'}"
						onclick={() => activeTab = 'notes'}
					>
						<Heart size={14} class="mb-1" />
						<span>Likes</span>
						<span class="text-[8px] opacity-60">{effectiveLikeCount}{(notesHasMore || noteTotalsLoading) && !noteTotals.complete ? '+' : ''}</span>
					</button>
					<button 
						class="flex flex-col items-center justify-center py-4 font-black text-[9px] uppercase tracking-tighter transition-all border-b-2 {activeTab === 'comments' ? 'border-primary text-white bg-white/5' : 'border-transparent text-gray-500 hover:text-white'}"
						onclick={() => activeTab = 'comments'}
					>
						<MessageSquare size={14} class="mb-1" />
						<span>Comments</span>
						<span class="text-[8px] opacity-60">{loadedCommentCount}{(notesHasMore || noteTotalsLoading) && !noteTotals.complete ? '+' : ''}</span>
					</button>
				</div>

				<div class="xl:flex-1 xl:overflow-y-auto custom-scrollbar p-6">
					{#if activeTab === 'trail'}
						<!-- Full NPF trail with real content rendering -->
						{#if post.trail && post.trail.length > 0}
							<div class="space-y-1">
								{#each post.trail as item, i}
									{@const trailName = item.blog?.name || item.broken_blog_name || '[deleted blog]'}
									{@const trailPostHref = item.post?.id && item.blog?.name ? `/post/${item.blog.name}/${item.post.id}` : null}
									{@const trailBlogHref = item.blog?.name ? `/blog/${item.blog.name}` : null}
									{@const trailHref = trailPostHref || trailBlogHref}
									<!-- Trail entry: author header + full NPF content -->
									<div class="rounded-2xl overflow-hidden border border-gray-800/60 bg-black/20">
										<!-- Author bar -->
										<div class="flex items-center gap-2.5 px-4 py-3 bg-black/40 border-b border-gray-800/40">
											{#if trailHref}
												<a href={trailHref} class="shrink-0">
													<div class="w-7 h-7 rounded-lg overflow-hidden ring-1 ring-gray-700">
														<AvatarImage blogName={trailName} size={64} />
													</div>
												</a>
												<a href={trailHref} class="text-xs font-black text-primary hover:underline truncate">{trailName}</a>
											{:else}
												<div class="w-7 h-7 rounded-lg overflow-hidden ring-1 ring-gray-700 bg-gray-900 flex items-center justify-center text-[9px] font-black text-gray-500">
													?
												</div>
												<span class="text-xs font-black text-gray-300 truncate">{trailName}</span>
											{/if}
											{#if i === 0}
												<span class="shrink-0 px-1.5 py-0.5 rounded bg-primary/20 text-primary border border-primary/30 text-[8px] font-black uppercase tracking-widest">OP</span>
											{/if}
											<span class="ml-auto shrink-0 text-[9px] text-gray-600 font-mono">{i + 1}/{post.trail.length}</span>
											{#if trailPostHref}
												<a href={trailPostHref} class="shrink-0 text-gray-600 hover:text-gray-400 transition-colors" title="Open post">
													<Repeat2 size={11} />
												</a>
											{/if}
										</div>
										<!-- Full NPF content for this trail step -->
										{#if item.content && item.content.length > 0}
											<div class="py-3 [&_.npf-content]:space-y-3! [&_p]:text-sm! [&_p]:leading-relaxed! [&_p]:mb-0! [&_h1]:text-xl! [&_h2]:text-lg! [&_.max-w-3xl]:px-3! [&_.px-4]:px-3! [&_.px-8]:px-3! [&_.md\:px-8]:px-3!">
												<NPFRenderer content={item.content} layout={item.layout} useGrid={false} />
											</div>
										{:else}
											<p class="px-4 py-3 text-xs text-gray-600 italic">No content.</p>
										{/if}
									</div>
									<!-- Arrow connector between trail steps -->
									{#if i < post.trail.length - 1}
										<div class="flex justify-center py-1 text-gray-700">
											<svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor"><path d="M6 0v12M1 8l5 8 5-8" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
										</div>
									{/if}
								{/each}
								<!-- Final post marker -->
								<div class="flex justify-center py-1 text-gray-700">
									<svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor"><path d="M6 0v12M1 8l5 8 5-8" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
								</div>
								<div class="flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/10 border border-primary/20">
									<AvatarImage blogName={post.blog_name} size={64} class="w-6 h-6 rounded-md" />
									<span class="text-xs font-black text-primary">{post.blog_name}</span>
									<span class="text-[8px] text-primary/60 font-bold uppercase ml-1">this post</span>
								</div>
							</div>
						{:else}
							<div class="h-full flex items-center justify-center text-gray-600 italic text-sm">No trail — this is an original post.</div>
						{/if}

					{:else if activeTab === 'reblog'}
						<!-- Header with filter toggle -->
						<div class="flex items-center justify-between mb-4">
							<span class="text-[10px] font-black uppercase text-gray-600 tracking-widest">
								{reblogTextOnly ? reblogNotes.filter(n => n.added_text || (n.tags && n.tags.length > 0)).length : reblogNotes.length} reblog{reblogNotes.length !== 1 ? 's' : ''}
							</span>
							<label class="flex items-center gap-2 cursor-pointer select-none">
								<span class="text-[10px] text-gray-500 font-bold uppercase">With text/tags only</span>
								<input type="checkbox" class="toggle toggle-xs toggle-primary" bind:checked={reblogTextOnly} />
							</label>
						</div>
						<div class="space-y-2">
							{#each reblogNotes.filter(n => !reblogTextOnly || n.added_text || (n.tags && n.tags.length > 0)) as note (note.blog_name + '_' + note.timestamp)}
								{@const hasText = !!note.added_text}
								{@const hasTags = !!(note.tags && note.tags.length > 0)}
								{@const hasContent = hasText || hasTags}
								<div class="rounded-xl border {hasContent ? 'border-primary/20 bg-primary/5' : 'border-gray-800/50 bg-black/20'} overflow-hidden">
									<!-- Blog row -->
									<div class="flex items-center gap-3 px-3 py-2">
										<AvatarImage blogName={note.blog_name} size={64} class="w-7 h-7 rounded-md shrink-0" />
										<div class="flex-1 min-w-0">
											<a href={note.post_id ? `/post/${note.blog_name}/${note.post_id}` : `/blog/${note.blog_name}`}
												class="text-xs font-bold text-white hover:text-primary transition-colors truncate block">{note.blog_name}</a>
											{#if note.reblog_parent_blog_name}
												<div class="text-[10px] text-gray-600 truncate">↳ from <a href="/blog/{note.reblog_parent_blog_name}" class="hover:text-gray-400 transition-colors">{note.reblog_parent_blog_name}</a></div>
											{/if}
										</div>
										{#if note.post_id}
											<a href="/post/{note.blog_name}/{note.post_id}" class="shrink-0 text-green-500 hover:text-green-400 p-1" title="View reblog">
												<Repeat2 size={13} />
											</a>
										{/if}
									</div>
									<!-- Added text, if any -->
									{#if hasText}
										<div class="px-3 pb-2 pt-1 border-t border-primary/10">
											<p class="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap">{note.added_text}</p>
										</div>
									{/if}
									<!-- Tags, if any -->
									{#if hasTags}
										<div class="px-3 pb-2 {hasText ? '' : 'pt-1 border-t border-primary/10'} flex flex-wrap gap-1">
											{#each note.tags as tag}
												<a href="/search?q=%23{encodeURIComponent(tag)}" 
													class="text-[9px] font-bold text-gray-500 bg-gray-800/60 hover:bg-primary hover:text-white border border-gray-700/50 hover:border-primary px-1.5 py-0.5 rounded-md transition-all">
													#{tag}
												</a>
											{/each}
										</div>
									{/if}
								</div>
							{/each}
							{#if reblogNotes.filter(n => !reblogTextOnly || n.added_text || (n.tags && n.tags.length > 0)).length === 0}
								<div class="py-12 text-center text-gray-600 italic text-sm">{reblogTextOnly ? 'No reblogs with text or tags.' : 'No reblogs yet.'}</div>
							{/if}
							{#if notesHasMore}
								<button class="w-full btn btn-sm btn-ghost text-gray-500 hover:text-white mt-2" onclick={loadMoreNotes} disabled={notesLoading}>
									{#if notesLoading}<span class="loading loading-spinner loading-xs"></span>{:else}Load more…{/if}
								</button>
							{/if}
						</div>

					{:else if activeTab === 'notes'}
						<div class="space-y-3">
							{#each likeNotes as note}
								<div class="flex items-center gap-3 p-2 bg-black/20 rounded-xl border border-gray-800/50">
									<AvatarImage blogName={note.blog_name} size={64} class="w-6 h-6 rounded-md" />
									<a href="/blog/{note.blog_name}" class="text-xs font-bold text-white hover:text-primary transition-colors flex-1 truncate">{note.blog_name}</a>
									<Heart size={10} class="text-pink-500" fill="currentColor" />
								</div>
							{/each}
							{#if likeNotes.length === 0}
								<div class="py-12 text-center text-gray-600 italic text-sm">No likes yet.</div>
							{/if}
							{#if notesHasMore}
								<button class="w-full btn btn-sm btn-ghost text-gray-500 hover:text-white mt-2" onclick={loadMoreNotes} disabled={notesLoading}>
									{#if notesLoading}<span class="loading loading-spinner loading-xs"></span>{:else}Load more…{/if}
								</button>
							{/if}
						</div>

					{:else if activeTab === 'comments'}
						<div class="space-y-4">
							{#each commentNotes as note}
								<div class="p-4 bg-black/40 rounded-2xl border border-gray-800">
									<div class="flex items-center gap-3 mb-3">
										<AvatarImage blogName={note.blog_name} size={64} class="w-8 h-8 rounded-lg" />
										<div class="flex-1">
											<a href="/blog/{note.blog_name}" class="text-xs font-black text-white hover:text-primary transition-colors">{note.blog_name}</a>
											{#if note.type === 'reblog'}<span class="ml-2 text-[9px] text-green-500/70 font-bold uppercase">via reblog</span>{/if}
										</div>
									</div>
									<p class="text-sm text-gray-300 bg-gray-900/50 p-3 rounded-xl border border-gray-800/50">
										{note.reply_text || note.added_text || "Left a comment."}
									</p>
								</div>
							{/each}
							{#if commentNotes.length === 0}
								<div class="py-12 text-center text-gray-600 italic text-sm">No comments found.</div>
							{/if}
							{#if notesHasMore}
								<button class="w-full btn btn-sm btn-ghost text-gray-500 hover:text-white mt-2" onclick={loadMoreNotes} disabled={notesLoading}>
									{#if notesLoading}<span class="loading loading-spinner loading-xs"></span>{:else}Load more…{/if}
								</button>
							{/if}
						</div>
					{/if}
				</div>
			</aside>
		</div>
	{/if}
</div>

{#if showDebug && dev}
	<div class="fixed inset-0 z-100 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
		<button
			type="button"
			class="absolute inset-0 z-0"
			onclick={() => showDebug = false}
			aria-label="Close debug modal"
		></button>
		<div class="relative z-10 bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-5xl h-[80dvh] flex flex-col shadow-2xl">
			<div class="flex items-center justify-between p-4 border-b border-gray-800">
				<h3 class="text-lg font-bold text-white tracking-widest uppercase">API Response Debug</h3>
				<div class="flex items-center gap-2">
					<button class="btn btn-sm btn-outline border-primary/50 text-primary hover:text-white hover:bg-primary/20" onclick={runNpfTestFetch} disabled={npfTestLoading}>
						{#if npfTestLoading}
							<span class="loading loading-spinner loading-xs"></span>
						{:else}
							Test NPF
						{/if}
					</button>
					<button class="btn btn-sm btn-outline border-gray-700 text-gray-300 hover:text-white" onclick={() => {
						navigator.clipboard.writeText(JSON.stringify(post, null, 2));
						const btn = document.getElementById('copy-json-btn');
						if(btn) { btn.innerText = 'Copied!'; setTimeout(() => btn.innerText = 'Copy JSON', 2000); }
					}} id="copy-json-btn">Copy JSON</button>
					<button class="btn btn-sm btn-circle btn-ghost" onclick={() => showDebug = false}>✕</button>
				</div>
			</div>
			<div class="p-4 overflow-y-auto flex-1 custom-scrollbar group relative">
				{#if npfTestResult}
					<div class="mb-4 rounded-xl border border-gray-700 bg-black/40 p-3 text-xs">
						<div class="font-black uppercase tracking-widest text-[10px] text-gray-400 mb-2">NPF Test Result</div>
						{#if npfTestResult.error}
							<div class="text-red-400">{npfTestResult.error}</div>
						{:else}
							<div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-gray-300">
								<div>ok: <span class="text-white font-bold">{String(npfTestResult.ok)}</span></div>
								<div>statusNpf: <span class="text-white font-bold">{npfTestResult.statusNpf}</span></div>
								<div>statusLegacy: <span class="text-white font-bold">{npfTestResult.statusLegacy}</span></div>
								<div>identical: <span class="text-white font-bold">{String(npfTestResult.identicalResponse)}</span></div>
								<div>hasNpfContent: <span class="text-white font-bold">{String(npfTestResult.hasNpfContent)}</span></div>
								<div>contentBlocks: <span class="text-white font-bold">{npfTestResult.contentBlocks}</span></div>
								<div>legacyHasContent: <span class="text-white font-bold">{String(npfTestResult.legacyHasContent)}</span></div>
								<div>legacyContentBlocks: <span class="text-white font-bold">{npfTestResult.legacyContentBlocks}</span></div>
								<div>hasTrail: <span class="text-white font-bold">{String(npfTestResult.hasTrail)}</span></div>
								<div>trailItems: <span class="text-white font-bold">{npfTestResult.trailItems}</span></div>
								<div>notesReturned: <span class="text-white font-bold">{npfTestResult.notesReturned}</span></div>
							</div>
						{/if}
					</div>
				{/if}
				{#if npfTestRaw}
					<div class="mb-4 rounded-xl border border-primary/30 bg-black/40 p-3 text-xs">
						<div class="font-black uppercase tracking-widest text-[10px] text-primary mb-2">NPF Test Raw JSON</div>
						<pre class="text-[10px] text-cyan-300 font-mono whitespace-pre-wrap break-all select-all">{JSON.stringify(npfTestRaw, null, 2)}</pre>
					</div>
				{/if}
				<pre class="text-[11px] text-green-400 font-mono whitespace-pre-wrap break-all select-all">{JSON.stringify(post, null, 2)}</pre>
			</div>
		</div>
	</div>
{/if}

<style>
	.custom-scrollbar {
		scrollbar-width: thin;
		scrollbar-color: #1f2937 transparent;
	}
</style>
