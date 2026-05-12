<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { getCachedPosts, clearCache, downloadAndCacheMedia, getCachedBlobUrl, getMediaCacheStats, getAllMediaUrls, extractUrlsFromBlocks, removePostFromCache } from '$lib/stores/db';
	import Lightbox from '$lib/components/Lightbox.svelte';
	import StaticFrame from '$lib/components/StaticFrame.svelte';
	import { ArrowLeft, Trash2, PlayCircle, Download, HardDrive, CheckCircle2, Loader2, Search, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-svelte';

	let posts: any[] = $state([]);
	let loading = $state(true);
	let currentFilter = $state('all');

	let filteredPosts = $derived(posts.filter(post => {
		if (currentFilter === 'all') return true;
		if (currentFilter === 'photo') return post.type === 'photo';
		if (currentFilter === 'video') return post.type === 'video';
		return true;
	}));

	// Pagination
	let currentPage = $state(1);
	let pageSize = 60;
	let totalPages = $derived(Math.ceil(filteredPosts.length / pageSize));
	
	let visiblePosts = $derived(
		filteredPosts.slice((currentPage - 1) * pageSize, currentPage * pageSize)
	);

	let lightboxActive = $state(false);
	let lightboxMediaUrl = $state('');
	let lightboxIsVideo = $state(false);

	// Blob URL map: original CDN url → local blob info (or null if not cached yet)
	let blobUrls = $state<Record<string, { url: string, type: string } | null>>({});
	// Downloading state per URL
	let downloading = $state<Record<string, boolean>>({});
	// Stats
	let cacheStats = $state({ count: 0, estimatedMb: 0 });
	let downloadingAll = $state(false);
	let downloadProgress = $state({ done: 0, total: 0 });

	// Browser storage quota
	let storageQuota = $state({ usageMb: 0, quotaMb: 0, pct: 0 });

	async function refreshStorageQuota() {
		if (!navigator.storage?.estimate) return;
		const { usage = 0, quota = 1 } = await navigator.storage.estimate();
		const usageMb = Math.round(usage / 1024 / 1024 * 10) / 10;
		const quotaMb = Math.round(quota / 1024 / 1024 * 10) / 10;
		storageQuota = { usageMb, quotaMb, pct: Math.min(100, Math.round(usage / quota * 100)) };
	}

	// Object URLs we created — need to revoke on destroy
	let ownedObjectUrls: string[] = [];
	$effect(() => {
		currentFilter;
		currentPage = 1;
	});

	// Load blobs for the current visible page
	$effect(() => {
		if (visiblePosts.length > 0) {
			loadBlobsForBatch(visiblePosts);
		}
	});

	function getPrimaryMediaUrl(post: any): string {
		// NPF primary
		let primary = '';
		if (post.content) primary = extractUrlsFromBlocks(post.content).primary;
		if (!primary && post.trail) {
			for (const item of post.trail) {
				primary = extractUrlsFromBlocks(item.content).primary;
				if (primary) break;
			}
		}
		if (primary) return primary;

		// Legacy primary
		if (post.type === 'photo' && post.photos?.length > 0) return post.photos[0].alt_sizes[0]?.url || '';
		if (post.type === 'video') return post.thumbnail_url || post.video_url || '';
		return '';
	}

	function getDisplayUrl(cdnUrl: string): string {
		return blobUrls[cdnUrl]?.url ?? cdnUrl;
	}

	function getDisplayType(cdnUrl: string): string {
		return blobUrls[cdnUrl]?.type ?? '';
	}

	function isPostCached(post: any): boolean {
		const urls = getAllMediaUrls(post);
		if (urls.length === 0) return false;
		return urls.every(u => blobUrls[u] != null);
	}

	function isPostDownloading(post: any): boolean {
		const urls = getAllMediaUrls(post);
		return urls.some(u => downloading[u]);
	}

	async function loadBlobsForBatch(batch: any[]) {
		const urls = new Set<string>();
		for (const post of batch) {
			for (const url of getAllMediaUrls(post)) {
				urls.add(url);
			}
		}
		
		const results = await Promise.all(Array.from(urls).map(async (url) => {
			if (blobUrls[url]) return null;
			const cached = await getCachedBlobUrl(url);
			return cached ? { original: url, ...cached } : null;
		}));

		const newBlobs: Record<string, { url: string, type: string }> = {};
		for (const res of results) {
			if (res) {
				ownedObjectUrls.push(res.url);
				newBlobs[res.original] = { url: res.url, type: res.type };
			}
		}

		if (Object.keys(newBlobs).length > 0) {
			blobUrls = { ...blobUrls, ...newBlobs };
		}
	}

	async function downloadPostMedia(post: any) {
		const urls = getAllMediaUrls(post);
		const toDownload = urls.filter(u => !blobUrls[u]);
		if (toDownload.length === 0) return;

		for (const url of toDownload) {
			downloading[url] = true;
		}

		let shouldDelete = false;
		await Promise.all(toDownload.map(async (url) => {
			const cached = await downloadAndCacheMedia(url);
			if (cached && cached.url) {
				ownedObjectUrls.push(cached.url);
				blobUrls = { ...blobUrls, [url]: cached };
			} else if (cached?.errorStatus === 403 || cached?.errorStatus === 404) {
				shouldDelete = true;
			}
			downloading[url] = false;
		}));

		if (shouldDelete) {
			console.log(`[Media Cache] Auto-deleting post ${post.id} due to 403/404 media`);
			await removePostFromCache(post.id);
			posts = posts.filter(p => String(p.id) !== String(post.id));
		}

		cacheStats = await getMediaCacheStats();
	}

	async function downloadAll() {
		downloadingAll = true;
		const allUrls: { url: string, postId: string }[] = [];
		for (const post of posts) {
			for (const url of getAllMediaUrls(post)) {
				if (!blobUrls[url]) allUrls.push({ url, postId: String(post.id) });
			}
		}
		downloadProgress = { done: 0, total: allUrls.length };
		
		const BATCH = 4;
		const postsToDelete = new Set<string>();

		for (let i = 0; i < allUrls.length; i += BATCH) {
			const batch = allUrls.slice(i, i + BATCH);
			await Promise.all(batch.map(async (item) => {
				const cached = await downloadAndCacheMedia(item.url);
				if (cached && cached.url) {
					ownedObjectUrls.push(cached.url);
					blobUrls = { ...blobUrls, [item.url]: cached };
				} else if (cached?.errorStatus === 403 || cached?.errorStatus === 404) {
					console.log(`[Media Cache] Marking post ${item.postId} for deletion (Error ${cached.errorStatus})`);
					postsToDelete.add(item.postId);
				}
				downloadProgress = { ...downloadProgress, done: downloadProgress.done + 1 };
			}));
		}

		if (postsToDelete.size > 0) {
			console.log(`[Media Cache] Deleting ${postsToDelete.size} dead posts...`);
			for (const pid of postsToDelete) {
				await removePostFromCache(pid);
			}
			posts = posts.filter(p => !postsToDelete.has(String(p.id)));
		}

		downloadingAll = false;
		cacheStats = await getMediaCacheStats();
		await refreshStorageQuota();
	}

	function openLightbox(post: any) {
		let isVideo = false;
		let mediaUrl = '';

		// Check NPF first
		const blocks = [...(post.content || []), ...((post.trail || []).flatMap((t: any) => t.content || []))];
		const firstVideo = blocks.find((b: any) => b.type === 'video');
		const firstImage = blocks.find((b: any) => b.type === 'image');

		if (firstVideo) {
			isVideo = true;
			const vidUrl = firstVideo.media?.[0]?.url || firstVideo.url;
			mediaUrl = blobUrls[vidUrl]?.url ?? vidUrl;
		} else if (firstImage) {
			isVideo = false;
			const imgUrl = firstImage.media?.[0]?.url || firstImage.url;
			mediaUrl = blobUrls[imgUrl]?.url ?? imgUrl;
		} else {
			// Legacy fallback
			if (post.type === 'video' && post.video_url) {
				mediaUrl = blobUrls[post.video_url]?.url ?? post.video_url;
				isVideo = true;
			} else if (post.type === 'photo' && post.photos) {
				const cdnUrl = post.photos[0].alt_sizes[0]?.url;
				mediaUrl = blobUrls[cdnUrl]?.url ?? cdnUrl;
				isVideo = false;
			}
		}

		if (mediaUrl) {
			lightboxMediaUrl = mediaUrl;
			lightboxIsVideo = isVideo;
			lightboxActive = true;
		}
	}

	async function handleClear() {
		if (confirm('Clear all cached posts and downloaded media blobs?')) {
			await clearCache();
			posts = [];
			visiblePosts = [];
			blobUrls = {};
			cacheStats = { count: 0, estimatedMb: 0 };
			storageQuota = { usageMb: 0, quotaMb: storageQuota.quotaMb, pct: 0 };
			await refreshStorageQuota();
		}
	}

	onMount(async () => {
		try {
			const allPosts = await getCachedPosts();
			posts = allPosts.filter(p => getAllMediaUrls(p).length > 0);
			cacheStats = await getMediaCacheStats();
			await refreshStorageQuota();
		} catch (e) {
			console.error(e);
		} finally {
			loading = false;
		}
	});

	onDestroy(() => {
		// Revoke all object URLs we created to free memory
		for (const url of ownedObjectUrls) {
			URL.revokeObjectURL(url);
		}
	});
</script>

<div class="min-h-screen p-4 md:p-8 bg-black">
	<header class="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-4">
			<button onclick={() => history.back()} class="btn btn-circle btn-ghost text-white">
				<ArrowLeft size={24} />
			</button>
			<div>
				<h1 class="text-3xl font-bold text-white tracking-tight">Media Cache</h1>
				<p class="text-xs text-gray-500 font-bold mt-0.5">{posts.length} posts · {cacheStats.count} blobs stored · {cacheStats.estimatedMb} MB used</p>
			</div>
		</div>
		
		<div class="flex items-center gap-3">
			<!-- Storage Ring Widget -->
			{#if storageQuota.quotaMb > 0}
				{@const r = 20}
				{@const circ = 2 * Math.PI * r}
				{@const dash = circ * (1 - storageQuota.pct / 100)}
				{@const color = storageQuota.pct > 80 ? '#ef4444' : storageQuota.pct > 50 ? '#f59e0b' : '#8b5cf6'}
				<div class="flex items-center gap-2 bg-gray-900 rounded-2xl border border-gray-800 px-4 py-2">
					<svg width="48" height="48" viewBox="0 0 48 48" class="-rotate-90">
						<circle cx="24" cy="24" r={r} fill="none" stroke="#1f2937" stroke-width="4" />
						<circle
							cx="24" cy="24" r={r}
							fill="none"
							stroke={color}
							stroke-width="4"
							stroke-linecap="round"
							stroke-dasharray={circ}
							stroke-dashoffset={dash}
							style="transition: stroke-dashoffset 0.6s ease"
						/>
					</svg>
					<div class="flex flex-col">
						<span class="text-sm font-black text-white leading-none">{storageQuota.pct}%</span>
						<span class="text-[10px] text-gray-500 font-bold">
							{storageQuota.usageMb >= 1024
								? (storageQuota.usageMb / 1024).toFixed(1) + ' GB'
								: storageQuota.usageMb + ' MB'}
							/ {storageQuota.quotaMb >= 1024
								? (storageQuota.quotaMb / 1024).toFixed(0) + ' GB'
								: storageQuota.quotaMb + ' MB'}
						</span>
					</div>
				</div>
			{/if}

			<!-- Download All -->
			<button 
				class="btn btn-sm btn-primary gap-2"
				onclick={downloadAll}
				disabled={downloadingAll}
			>
				{#if downloadingAll}
					<Loader2 size={16} class="animate-spin" />
					{downloadProgress.done}/{downloadProgress.total}
				{:else}
					<Download size={16} /> Cache All Offline
				{/if}
			</button>
			<button class="btn btn-sm btn-outline btn-error gap-2" onclick={handleClear}>
				<Trash2 size={16} /> Clear Cache
			</button>
		</div>
	</header>

	<!-- Progress bar while downloading all -->
	{#if downloadingAll}
		<div class="mb-6 bg-gray-900 rounded-full h-2 overflow-hidden border border-gray-800">
			<div 
				class="h-full bg-primary transition-all duration-300 rounded-full"
				style="width: {downloadProgress.total > 0 ? (downloadProgress.done / downloadProgress.total * 100) : 0}%"
			></div>
		</div>
	{/if}

	<div class="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between mb-8">
		{#if posts.length > 0}
			<div class="tabs tabs-boxed bg-gray-900 border border-gray-800 p-1 w-fit">
				<button class="tab {currentFilter === 'all' ? 'tab-active bg-primary text-white' : 'text-gray-400'}" onclick={() => currentFilter = 'all'}>All Media</button>
				<button class="tab {currentFilter === 'photo' ? 'tab-active bg-primary text-white' : 'text-gray-400'}" onclick={() => currentFilter = 'photo'}>Photos</button>
				<button class="tab {currentFilter === 'video' ? 'tab-active bg-primary text-white' : 'text-gray-400'}" onclick={() => currentFilter = 'video'}>Videos</button>
			</div>
		{/if}

		<!-- Pagination Top -->
		{#if totalPages > 1}
			<div class="join bg-gray-900 border border-gray-800">
				<button 
					class="join-item btn btn-sm" 
					onclick={() => currentPage = 1} 
					disabled={currentPage === 1}
				>
					<ChevronsLeft size={16} />
				</button>
				<button 
					class="join-item btn btn-sm" 
					onclick={() => currentPage--} 
					disabled={currentPage === 1}
				>
					<ChevronLeft size={16} />
				</button>
				<button class="join-item btn btn-sm no-animation pointer-events-none text-white font-bold px-6">
					Page {currentPage} of {totalPages}
				</button>
				<button 
					class="join-item btn btn-sm" 
					onclick={() => currentPage++} 
					disabled={currentPage === totalPages}
				>
					<ChevronRight size={16} />
				</button>
				<button 
					class="join-item btn btn-sm" 
					onclick={() => currentPage = totalPages} 
					disabled={currentPage === totalPages}
				>
					<ChevronsRight size={16} />
				</button>
			</div>
		{/if}
	</div>

	{#if loading}
		<div class="flex justify-center py-20">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:else if posts.length === 0}
		<div class="hero min-h-[50vh] rounded-3xl bg-base-200">
			<div class="hero-content text-center">
				<div class="max-w-md">
					<HardDrive size={48} class="mx-auto mb-4 text-gray-600" />
					<h2 class="text-3xl font-bold text-white">Cache is empty</h2>
					<p class="py-6 text-gray-500">Go back to the dashboard and scroll to cache some posts.</p>
					<a href="/" class="btn btn-primary">Go to Dashboard</a>
				</div>
			</div>
		</div>
	{:else}
		<main class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 auto-rows-max">
			{#each visiblePosts as post (post.id)}
				{@const primaryUrl = getPrimaryMediaUrl(post)}
				{#if primaryUrl}
					<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
					<div 
						role="button"
						tabindex="0"
						class="group relative block overflow-hidden bg-gray-900 aspect-square cursor-pointer transition-transform hover:z-10 hover:scale-105 shadow-md"
						onclick={() => openLightbox(post)}
						onkeydown={(e) => { if (e.key === 'Enter') openLightbox(post); }}
					>
						<StaticFrame
							src={getDisplayUrl(primaryUrl)}
							type={getDisplayType(primaryUrl)}
							alt="Cached Media"
							class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
						/>

						<!-- Overlay -->
						<div class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
							{#if post.type === 'video' || (post.content && post.content.some((b: any) => b.type === 'video'))}
								<PlayCircle size={36} class="text-white drop-shadow-md" />
							{/if}
							<!-- Download single blob button -->
							{#if !isPostCached(post) && !isPostDownloading(post)}
								<button
									class="btn btn-xs btn-neutral gap-1 mt-2"
									onclick={(e) => { e.stopPropagation(); downloadPostMedia(post); }}
								>
									<Download size={12} /> Save offline
								</button>
							{:else if isPostDownloading(post)}
								<Loader2 size={20} class="text-white animate-spin" />
							{/if}
						</div>

						<!-- Cached indicator badge -->
						{#if isPostCached(post)}
							<div class="absolute top-1.5 left-1.5 w-5 h-5 rounded-full bg-green-500/90 flex items-center justify-center shadow-lg">
								<CheckCircle2 size={12} class="text-white" />
							</div>
						{/if}
					</div>
				{/if}
			{/each}
		</main>

		<!-- Pagination Bottom -->
		{#if totalPages > 1}
			<div class="flex justify-center mt-12 pb-12">
				<div class="join bg-gray-900 border border-gray-800">
					<button 
						class="join-item btn" 
						onclick={() => { currentPage = 1; window.scrollTo({ top: 0, behavior: 'smooth' }); }} 
						disabled={currentPage === 1}
					>
						<ChevronsLeft size={18} />
					</button>
					<button 
						class="join-item btn" 
						onclick={() => { currentPage--; window.scrollTo({ top: 0, behavior: 'smooth' }); }} 
						disabled={currentPage === 1}
					>
						<ChevronLeft size={18} />
					</button>
					<button class="join-item btn no-animation pointer-events-none text-white font-bold px-8">
						Page {currentPage} of {totalPages}
					</button>
					<button 
						class="join-item btn" 
						onclick={() => { currentPage++; window.scrollTo({ top: 0, behavior: 'smooth' }); }} 
						disabled={currentPage === totalPages}
					>
						<ChevronRight size={18} />
					</button>
					<button 
						class="join-item btn" 
						onclick={() => { currentPage = totalPages; window.scrollTo({ top: 0, behavior: 'smooth' }); }} 
						disabled={currentPage === totalPages}
					>
						<ChevronsRight size={18} />
					</button>
				</div>
			</div>
		{/if}

		{#if filteredPosts.length === 0 && posts.length > 0}
			<div class="py-20 text-center text-gray-500">
				No media matches the current filter.
			</div>
		{/if}
	{/if}
</div>

<Lightbox bind:active={lightboxActive} mediaUrl={lightboxMediaUrl} isVideo={lightboxIsVideo} />
