<script lang="ts">
	import { PlayCircle, Download, CheckCircle2, Loader2, Image as ImageIcon } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { getAllMediaUrls, downloadAndCacheMedia, isMediaCached, getPrimaryMediaUrl } from '$lib/stores/db';

	let { post } = $props<{ post: any }>();

	let mediaUrl = $derived(getPrimaryMediaUrl(post));

	let isVideo = $derived.by(() => {
		if (post.type === 'video') return true;
		const blocks = [...(post.content || []), ...((post.trail || []).flatMap((t: any) => t.content || []))];
		if (blocks.some((b: any) => b.type === 'video')) return true;
		if (post.body && /<video[^>]*><source/i.test(post.body)) return true;
		return false;
	});

	let isImage = $derived.by(() => {
		if (post.type === 'photo') return true;
		const blocks = [...(post.content || []), ...((post.trail || []).flatMap((t: any) => t.content || []))];
		if (blocks.some((b: any) => b.type === 'image')) return true;
		if (post.body && /<img[^>]+src=/i.test(post.body)) return true;
		return false;
	});
	let nsfw = $derived(post.is_nsfw);

	let isCached = $state(false);
	let isDownloading = $state(false);

	async function checkCacheStatus() {
		const urls = getAllMediaUrls(post);
		if (urls.length === 0) {
			isCached = false;
			return;
		}
		let allCached = true;
		for (const url of urls) {
			if (!(await isMediaCached(url))) {
				allCached = false;
				break;
			}
		}
		isCached = allCached;
	}

	async function downloadPostMedia() {
		if (isDownloading || isCached) return;
		isDownloading = true;

		const urls = getAllMediaUrls(post);
		if (urls.length === 0) {
			isDownloading = false;
			return;
		}

		await Promise.all(urls.map(async (url) => {
			if (!(await isMediaCached(url))) {
				await downloadAndCacheMedia(url);
			}
		}));

		isDownloading = false;
		isCached = true;
	}

	onMount(() => {
		checkCacheStatus();
	});
</script>

<a
	href={`/post/${post.blog_name}/${post.id_string || post.id}`}
	class="group relative block overflow-hidden rounded-xl bg-gray-900 aspect-[3/4] shadow-lg transition-transform hover:-translate-y-1 hover:shadow-xl hover:shadow-cyan-900/20"
>
	{#if mediaUrl}
		<img
			src={mediaUrl}
			alt={post.summary || 'Tumblr Post'}
			class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
			loading="lazy"
		/>
	{:else}
		<div class="flex h-full w-full items-center justify-center bg-gray-800 p-4">
			<p class="text-sm text-gray-400 line-clamp-6">{@html post.summary || post.body || 'Post without media'}</p>
		</div>
	{/if}

	<!-- Overlays -->
	<div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-80 transition-opacity group-hover:opacity-100"></div>


	<!-- Top Left Icons -->
	<div class="absolute top-3 left-3 flex items-center gap-2 z-10">
		<!-- Video Icon -->
		{#if isVideo}
			<div class="text-white/80 drop-shadow-md">
				<PlayCircle size={24} />
			</div>
		{:else if isImage}
			<div class="text-white/80 drop-shadow-md">
				<ImageIcon size={24} />
			</div>
		{/if}
		
		<!-- Cached indicator badge -->
		{#if isCached}
			<div class="w-6 h-6 rounded-full bg-green-500/90 flex items-center justify-center shadow-lg">
				<CheckCircle2 size={14} class="text-white" />
			</div>
		{/if}
	</div>

	<!-- NSFW Badge -->
	{#if nsfw}
		<div class="absolute top-3 right-3 rounded bg-red-600 px-2 py-1 text-xs font-bold text-white shadow z-10">
			NSFW
		</div>
	{/if}

	<!-- Bottom Info -->
	<div class="absolute bottom-0 left-0 right-0 p-4 z-10">
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<span 
			class="text-sm font-semibold text-white truncate hover:text-primary transition-colors block relative z-30 cursor-pointer"
			onclick={(e) => {
				e.preventDefault();
				e.stopPropagation();
				window.location.href = `/blog/${post.blog_name}`;
			}}
		>
			{post.blog_name}
		</span>
		<p class="text-xs text-gray-300 line-clamp-2 mt-1">{post.summary}</p>
		
		<!-- Tags -->
		{#if post.tags && post.tags.length > 0}
			<div class="mt-2 flex flex-wrap gap-1 relative z-30 max-h-12 overflow-hidden">
				{#each post.tags as tag}
					<button 
						class="text-[9px] font-bold text-gray-400 bg-white/5 px-1.5 py-0.5 rounded hover:bg-primary hover:text-white transition-all"
						onclick={(e) => {
							e.preventDefault();
							e.stopPropagation();
							window.location.href = `/search?q=%23${encodeURIComponent(tag)}`;
						}}
					>
						#{tag}
					</button>
				{/each}
			</div>
		{/if}

		<div class="mt-3 flex items-center justify-between gap-1 text-xs text-gray-400 relative z-30">
			<span class="truncate">{post.note_count || 0} notes</span>
			
			{#if !isCached && !isDownloading && getAllMediaUrls(post).length > 0}
				<button
					class="flex items-center gap-1 hover:text-white transition-colors p-1 shrink-0 whitespace-nowrap"
					onclick={(e) => { e.preventDefault(); e.stopPropagation(); downloadPostMedia(); }}
					title="Save offline"
				>
					<Download size={12} /> <span class="font-bold">Save offline</span>
				</button>
			{:else if isDownloading}
				<div class="flex items-center gap-1 p-1 text-primary shrink-0 whitespace-nowrap">
					<Loader2 size={12} class="animate-spin" /> <span class="font-bold">Downloading</span>
				</div>
			{/if}
		</div>
	</div>
</a>
