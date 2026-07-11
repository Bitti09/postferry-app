<script lang="ts">
	import { ChevronLeft, ChevronRight } from 'lucide-svelte';
	
	let { 
		active = $bindable(false), 
		mediaUrl = '', 
		isVideo = false,
		items = [],
		currentIndex = 0,
		activePostId = $bindable<string | number | null>(null)
	} = $props<{ 
		active?: boolean, 
		mediaUrl?: string, 
		isVideo?: boolean,
		items?: { url: string, type: string, post?: any }[],
		currentIndex?: number,
		activePostId?: string | number | null
	}>();
	
	let current = $state(0);

	$effect(() => {
		if (active) {
			current = currentIndex;
		}
	});

	$effect(() => {
		if (active && items.length > 0 && items[current] && items[current].post) {
			activePostId = items[current].post.id;
		}
	});

	let displayUrl = $derived(items.length > 0 ? items[current].url : mediaUrl);
	let displayIsVideo = $derived(items.length > 0 ? items[current].type.startsWith("video/") : isVideo);
	
	function close() {
		active = false;
	}

	function next(e?: Event) {
		if (e) e.stopPropagation();
		if (items.length > 0) {
			current = (current + 1) % items.length;
		}
	}

	function prev(e?: Event) {
		if (e) e.stopPropagation();
		if (items.length > 0) {
			current = (current - 1 + items.length) % items.length;
		}
	}
	
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') close();
		if (e.key === 'ArrowRight') next();
		if (e.key === 'ArrowLeft') prev();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if active}
	<div 
		role="presentation"
		class="fixed inset-0 z-200 flex items-center justify-center bg-black/95 backdrop-blur-sm"
		onclick={close}
	>
		<button 
			class="absolute top-6 right-6 w-12 h-12 rounded-full bg-white/10 hover:bg-white/25 border border-white/10 text-white text-2xl font-bold flex items-center justify-center transition-all z-210"
			onclick={(e) => { e.stopPropagation(); close(); }}
			aria-label="Close"
		>✕</button>

		{#if items.length > 1}
			<button class="absolute left-6 w-14 h-14 rounded-full bg-black/50 hover:bg-black text-white flex items-center justify-center border border-white/20 transition-all z-210" onclick={prev}>
				<ChevronLeft size={32} />
			</button>
			<button class="absolute right-6 top-1/2 -translate-y-1/2 w-14 h-14 rounded-full bg-black/50 hover:bg-black text-white flex items-center justify-center border border-white/20 transition-all z-210" onclick={next}>
				<ChevronRight size={32} />
			</button>
		{/if}
		
		{#if displayIsVideo}
			<div role="presentation" onclick={(e) => e.stopPropagation()}>
				<video controls autoplay class="w-screen h-screen object-contain" src={displayUrl}>
					<track kind="captions" />
				</video>
			</div>
		{:else}
			<div role="presentation" onclick={(e) => e.stopPropagation()}>
				<img src={displayUrl} alt="Expanded Media" class="w-screen h-screen object-contain select-none" />
			</div>
		{/if}
	</div>
{/if}
