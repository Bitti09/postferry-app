<script lang="ts">
	import NPFText from './NPFText.svelte';
	let { blocks = [], attribution = null }: { blocks: any[]; attribution?: any } = $props();

	let askerName = $derived(attribution?.blog?.name || 'Anonymous');
	let askerAvatar = $derived(
		attribution?.blog?.name 
			? `/api/avatar?blog=${encodeURIComponent(attribution.blog.name)}&size=64`
			: 'https://assets.tumblr.com/images/default_avatar/cube_closed_64.png'
	);
</script>

<div class="flex gap-4 my-6 bg-gray-900 border border-gray-800 p-5 rounded-2xl relative">
	<!-- Avatar -->
	<div class="shrink-0">
		<div class="w-12 h-12 rounded-xl overflow-hidden ring-2 ring-gray-800">
			<img src={askerAvatar} alt={askerName} class="w-full h-full object-cover" />
		</div>
	</div>

	<!-- Content -->
	<div class="flex-1">
		<div class="flex items-center gap-2 mb-2">
			{#if attribution?.blog?.name}
				<a href={`/blog/${attribution.blog.name}`} class="font-bold text-white hover:text-primary transition-colors">{askerName}</a>
			{:else}
				<span class="font-bold text-white">{askerName}</span>
			{/if}
			<span class="text-xs text-gray-500 font-medium">asked</span>
		</div>
		
		<div class="text-gray-300 leading-relaxed text-[15px]">
			{#each blocks as block}
				{#if block.type === 'text'}
					<p class="mb-2 last:mb-0"><NPFText text={block.text} formatting={block.formatting} /></p>
				{/if}
			{/each}
		</div>
	</div>
</div>
