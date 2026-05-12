<script lang="ts">
	import { X } from 'lucide-svelte';
	
	let { active = $bindable(false), mediaUrl = '', isVideo = false } = $props<{ active?: boolean, mediaUrl?: string, isVideo?: boolean }>();
	
	function close() {
		active = false;
	}
	
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') close();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if active}
	<div 
		role="presentation"
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-sm"
		onclick={close}
	>
		<button 
			class="absolute top-6 right-6 w-12 h-12 rounded-full bg-white/10 hover:bg-white/25 border border-white/10 text-white text-2xl font-bold flex items-center justify-center transition-all z-50"
			onclick={(e) => { e.stopPropagation(); close(); }}
			aria-label="Close"
		>✕</button>
		
		{#if isVideo}
			<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
			<video controls autoplay class="w-screen h-screen object-contain" onclick={(e) => e.stopPropagation()}>
				<source src={mediaUrl} type="video/mp4" />
			</video>
		{:else}
			<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
			<img src={mediaUrl} alt="Expanded Media" class="w-screen h-screen object-contain select-none" onclick={(e) => e.stopPropagation()} />
		{/if}
	</div>
{/if}
