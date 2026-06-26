<script lang="ts">
	import { ChevronLeft, ChevronRight } from 'lucide-svelte';
	
	let { 
		active = $bindable(false), 
		mediaUrl = '', 
		isVideo = false,
		items = [],
		currentIndex = 0
	} = $props<{ 
		active?: boolean, 
		mediaUrl?: string, 
		isVideo?: boolean,
		items?: { url: string, type: string }[],
		currentIndex?: number
	}>();
	
	let current = $state(currentIndex);

	$effect(() => {
		if (active) {
			current = currentIndex;
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
		class="fixed inset-0 z-[200] flex items-center justify-center bg-black/95 backdrop-blur-sm"
		onclick={close}
	>
		<button 
			class="absolute top-6 right-6 w-12 h-12 rounded-full bg-white/10 hover:bg-white/25 border border-white/10 text-white text-2xl font-bold flex items-center justify-center transition-all z-[210]"
			onclick={(e) => { e.stopPropagation(); close(); }}
			aria-label="Close"
		>✕</button>

		{#if items.length > 1}
			<button class="absolute left-6 w-14 h-14 rounded-full bg-black/50 hover:bg-black text-white flex items-center justify-center border border-white/20 transition-all z-[210]" onclick={prev}>
				<ChevronLeft size={32} />
			</button>
			<button class="absolute right-6 top-1/2 -translate-y-1/2 w-14 h-14 rounded-full bg-black/50 hover:bg-black text-white flex items-center justify-center border border-white/20 transition-all z-[210]" onclick={next}>
				<ChevronRight size={32} />
			</button>
		{/if}
		
		{#if displayIsVideo}
			<!-- svelte-ignore a11y_click_events_have_key_events a11y_media_has_caption a11y_no_static_element_interactions -->
			<video controls autoplay class="w-screen h-screen object-contain" onclick={(e) => e.stopPropagation()} src={displayUrl}></video>
		{:else}
			<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
			<img src={displayUrl} alt="Expanded Media" class="w-screen h-screen object-contain select-none" onclick={(e) => e.stopPropagation()} />
		{/if}
	</div>
{/if}
