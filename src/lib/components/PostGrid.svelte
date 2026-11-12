<script lang="ts">
	import { browser } from '$app/env';
	import PostCard from './PostCard.svelte';
	import { postId, type TumblrPost } from '#lib/types';

	let {
		posts,
		columnSetting = 'auto',
		onMediaClick,
		mode = 'normal',
		hrefFor,
		cardClass = '',
		scroll = 'window',
		scrollElement = null,
		gap = 16,
		overscan = 8
	}: {
		posts: TumblrPost[];
		columnSetting?: string;
		onMediaClick?: (post: TumblrPost, url?: string) => void;
		mode?: 'normal' | 'cache';
		hrefFor?: (post: TumblrPost) => string;
		cardClass?: string;
		scroll?: 'window' | 'container';
		scrollElement?: HTMLElement | null;
		gap?: number;
		overscan?: number;
	} = $props();

	let gridEl = $state<HTMLElement | null>(null);
	let viewportWidth = $state(0);
	let viewportHeight = $state(0);
	let scrollOffset = $state(0);
	let gridTop = $state(0);
	let gridWidth = $state(0);

	function autoColumns(width: number): number {
		if (width >= 1536) return 7;
		if (width >= 1280) return 6;
		if (width >= 1024) return 5;
		if (width >= 768) return 4;
		if (width >= 640) return 3;
		if (width >= 480) return 2;
		return 1;
	}

	let columnCount = $derived.by(() => {
		if (columnSetting !== 'auto') {
			const parsed = Number.parseInt(columnSetting, 10);
			if (Number.isFinite(parsed) && parsed > 0) return parsed;
		}
		const width = viewportWidth || (browser ? window.innerWidth : 1024);
		return autoColumns(width);
	});

	let cardWidth = $derived.by(() => {
		if (columnCount <= 0 || gridWidth <= 0) return 0;
		return Math.max(0, (gridWidth - gap * (columnCount - 1)) / columnCount);
	});
	let rowHeight = $derived(cardWidth > 0 ? cardWidth * (4 / 3) : 0);
	let rowStride = $derived(rowHeight + gap);
	let rowCount = $derived(Math.ceil(posts.length / columnCount));
	let virtualHeight = $derived(rowCount > 0 ? rowCount * rowStride - gap : 0);

	let viewportTopWithinGrid = $derived(Math.max(0, scrollOffset - gridTop));
	let viewportBottomWithinGrid = $derived(viewportTopWithinGrid + viewportHeight);

	let visibleStartRow = $derived.by(() => {
		if (rowStride <= 0) return 0;
		return Math.max(0, Math.floor(viewportTopWithinGrid / rowStride) - overscan);
	});
	let visibleEndRow = $derived.by(() => {
		if (rowStride <= 0) return -1;
		return Math.min(rowCount - 1, Math.ceil(viewportBottomWithinGrid / rowStride) + overscan);
	});
	let visibleRows = $derived.by(() => {
		if (visibleEndRow < visibleStartRow || columnCount <= 0) {
			return [] as { row: number; posts: TumblrPost[] }[];
		}
		const rows: { row: number; posts: TumblrPost[] }[] = [];
		for (let row = visibleStartRow; row <= visibleEndRow; row++) {
			const start = row * columnCount;
			const rowPosts = posts.slice(start, start + columnCount);
			if (rowPosts.length > 0) rows.push({ row, posts: rowPosts });
		}
		return rows;
	});

	function measure(): void {
		if (!browser) return;
		const rect = gridEl?.getBoundingClientRect();
		if (scroll === 'container' && scrollElement) {
			const containerRect = scrollElement.getBoundingClientRect();
			viewportWidth = scrollElement.clientWidth;
			viewportHeight = scrollElement.clientHeight;
			scrollOffset = scrollElement.scrollTop;
			gridWidth = rect?.width ?? scrollElement.clientWidth;
			gridTop = rect ? rect.top - containerRect.top + scrollElement.scrollTop : 0;
		} else {
			viewportWidth = window.innerWidth;
			viewportHeight = window.innerHeight;
			scrollOffset = window.scrollY;
			gridWidth = rect?.width ?? 0;
			gridTop = rect ? rect.top + window.scrollY : 0;
		}
	}

	$effect(() => {
		if (!browser) return;
		const target: EventTarget | null = scroll === 'container' ? scrollElement : window;
		if (!target) return;

		const onScroll = () => {
			if (scroll === 'container' && scrollElement) {
				scrollOffset = scrollElement.scrollTop;
			} else {
				scrollOffset = window.scrollY;
			}
		};
		target.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('resize', measure);

		const observer = new ResizeObserver(() => measure());
		if (gridEl) observer.observe(gridEl);
		if (scroll === 'container' && scrollElement) observer.observe(scrollElement);

		// Posts changing height affects the virtual spacer; re-measure on the
		// next frame instead of during the render pass.
		requestAnimationFrame(measure);

		return () => {
			target.removeEventListener('scroll', onScroll);
			window.removeEventListener('resize', measure);
			observer.disconnect();
		};
	});

	$effect(() => {
		// Track the values that change the grid geometry.
		posts.length;
		columnCount;
		columnSetting;
		scrollOffset;
		requestAnimationFrame(measure);
	});
</script>

<div bind:this={gridEl} class="relative w-full" style={`height: ${virtualHeight}px;`}>
	{#if cardWidth > 0}
		{#each visibleRows as rowItem (rowItem.row)}
			<div class="absolute" style={`top: ${rowItem.row * rowStride}px; left: 0; right: 0;`}>
				<div
					class="grid"
					style={`grid-template-columns: repeat(${columnCount}, minmax(0, 1fr)); gap: ${gap}px;`}
				>
					{#each rowItem.posts as post (postId(post))}
						<div id={`post-${postId(post)}`} class={cardClass}>
							{#if mode === 'cache' && hrefFor}
								<a
									href={hrefFor(post)}
									class="block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-xl"
									title="Open from offline cache"
									data-sveltekit-preload-data="off"
								>
									<PostCard {post} mode="cache" {onMediaClick} />
								</a>
							{:else}
								<PostCard {post} {onMediaClick} />
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/each}
	{/if}
</div>
