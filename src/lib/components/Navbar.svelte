<script lang="ts">
	import { page } from '$app/stores';
	import { Home, Image, Heart, Users, Search, Maximize, Minimize, Settings } from 'lucide-svelte';
	import { onMount } from 'svelte';

	let isFullscreen = $state(false);

	function toggleFullscreen() {
		if (!document.fullscreenElement) {
			document.documentElement.requestFullscreen().catch(err => console.error(err));
		} else if (document.exitFullscreen) {
			document.exitFullscreen();
		}
	}

	onMount(() => {
		const handleFsChange = () => {
			isFullscreen = !!document.fullscreenElement;
		};
		document.addEventListener('fullscreenchange', handleFsChange);
		return () => document.removeEventListener('fullscreenchange', handleFsChange);
	});
</script>

<div class="navbar bg-gray-900 border-b border-gray-800 px-4 md:px-8 sticky top-0 z-40 backdrop-blur-md bg-opacity-80">
	<div class="flex-1">
		<a href="/" class="text-2xl font-black text-white tracking-tighter flex items-center gap-2">
			<span class="bg-primary text-white w-8 h-8 flex items-center justify-center rounded-lg">T</span>
			tmblr
		</a>
	</div>
	<div class="flex-none flex items-center gap-2 pr-2">
		<ul class="menu menu-horizontal px-1 gap-2">
			<li>
				<a href="/" class="{$page.url.pathname === '/' ? 'active bg-primary' : ''} transition-all">
					<Home size={18} />
					<span class="hidden sm:inline">Dashboard</span>
				</a>
			</li>
			<li>
				<a href="/likes" class="{$page.url.pathname === '/likes' ? 'active bg-primary' : ''} transition-all">
					<Heart size={18} />
					<span class="hidden sm:inline">Favourites</span>
				</a>
			</li>
			<li>
				<a href="/caches" class="{$page.url.pathname === '/caches' ? 'active bg-primary' : ''} transition-all">
					<Image size={18} />
					<span class="hidden sm:inline">Caches</span>
				</a>
			</li>
			<li>
				<a href="/search" class="{$page.url.pathname === '/search' ? 'active bg-primary' : ''} transition-all">
					<Search size={18} />
					<span class="hidden sm:inline">Search</span>
				</a>
			</li>
			<li>
				<a href="/accounts" class="{$page.url.pathname === '/accounts' ? 'active bg-primary' : ''} transition-all">
					<Users size={18} />
					<span class="hidden sm:inline">Accounts</span>
				</a>
			</li>
			<li>
				<a href="/settings" class="{$page.url.pathname === '/settings' ? 'active bg-primary' : ''} transition-all">
					<Settings size={18} />
					<span class="hidden sm:inline">Settings</span>
				</a>
			</li>
		</ul>

		<div class="w-[1px] h-6 bg-gray-700/50 hidden md:block"></div>
		
		<button onclick={toggleFullscreen} class="btn btn-ghost btn-circle btn-sm text-gray-400 hover:text-white" title="Toggle Fullscreen">
			{#if isFullscreen}
				<Minimize size={18} />
			{:else}
				<Maximize size={18} />
			{/if}
		</button>
	</div>
</div>
