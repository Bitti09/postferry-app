<script lang="ts">
	import { page } from '$app/state';
	import { Home, Image, Heart, Users, Search, Maximize, Minimize, Settings, UserCheck, Menu } from '@lucide/svelte';
	import { onMount } from 'svelte';

	let isFullscreen = $state(false);

	function toggleFullscreen() {
		if (!document.fullscreenElement) {
			document.documentElement.requestFullscreen().catch(err => console.error(err));
		} else {
			void document.exitFullscreen();
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

<div class="navbar bg-gray-900/80 border-b border-gray-800 px-4 md:px-8 sticky top-0 z-40 backdrop-blur-md">
	<div class="flex-1">
		<a href="/" class="text-2xl font-black text-white tracking-tighter flex items-center gap-2">
			<span class="bg-primary text-white w-8 h-8 flex items-center justify-center rounded-lg">T</span>
			tmblr
		</a>
	</div>
	<div class="flex-none flex items-center gap-2 pr-2">
		<ul class="menu menu-horizontal px-1 gap-2 hidden md:flex">
			<li>
				<a href="/" class="{page.url.pathname === '/' ? 'active bg-primary' : ''} transition-all">
					<Home size={18} />
					<span class="hidden sm:inline">Dashboard</span>
				</a>
			</li>
			<li>
				<a href="/likes" class="{page.url.pathname === '/likes' ? 'active bg-primary' : ''} transition-all">
					<Heart size={18} />
					<span class="hidden sm:inline">Favourites</span>
				</a>
			</li>
			<li>
				<a href="/caches" class="{page.url.pathname === '/caches' ? 'active bg-primary' : ''} transition-all">
					<Image size={18} />
					<span class="hidden sm:inline">Caches</span>
				</a>
			</li>
			<li>
				<a href="/following" class="{page.url.pathname === '/following' ? 'active bg-primary' : ''} transition-all">
					<UserCheck size={18} />
					<span class="hidden sm:inline">Following</span>
				</a>
			</li>
			<li>
				<a href="/search" class="{page.url.pathname === '/search' ? 'active bg-primary' : ''} transition-all">
					<Search size={18} />
					<span class="hidden sm:inline">Search</span>
				</a>
			</li>
			<li>
				<a href="/accounts" class="{page.url.pathname === '/accounts' ? 'active bg-primary' : ''} transition-all">
					<Users size={18} />
					<span class="hidden sm:inline">Accounts</span>
				</a>
			</li>
			<li>
				<a href="/settings" class="{page.url.pathname === '/settings' ? 'active bg-primary' : ''} transition-all">
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

<nav class="fixed bottom-0 left-0 right-0 h-16 md:hidden z-50 bg-gray-900 border-t border-gray-800 text-gray-400 flex flex-row">
	<a href="/" class="flex-1 flex flex-col items-center justify-center gap-1 hover:bg-gray-800 transition-colors {page.url.pathname === '/' ? 'text-primary' : ''}">
		<Home size={22} />
		<span class="text-[10px] font-medium leading-none">Home</span>
	</a>
	<a href="/likes" class="flex-1 flex flex-col items-center justify-center gap-1 hover:bg-gray-800 transition-colors {page.url.pathname === '/likes' ? 'text-primary' : ''}">
		<Heart size={22} />
		<span class="text-[10px] font-medium leading-none">Likes</span>
	</a>
	<a href="/search" class="flex-1 flex flex-col items-center justify-center gap-1 hover:bg-gray-800 transition-colors {page.url.pathname === '/search' ? 'text-primary' : ''}">
		<Search size={22} />
		<span class="text-[10px] font-medium leading-none">Search</span>
	</a>
	<a href="/settings" class="flex-1 flex flex-col items-center justify-center gap-1 hover:bg-gray-800 transition-colors {page.url.pathname === '/settings' ? 'text-primary' : ''}">
		<Settings size={22} />
		<span class="text-[10px] font-medium leading-none">Settings</span>
	</a>
	<div class="dropdown dropdown-top dropdown-end flex-1 flex">
		<button
			type="button"
			class="w-full h-full flex flex-col items-center justify-center gap-1 hover:bg-gray-800 transition-colors {['/caches', '/following', '/accounts'].includes(page.url.pathname) ? 'text-primary' : ''}"
		>
			<Menu size={22} />
			<span class="text-[10px] font-medium leading-none">Menu</span>
		</button>
		<ul class="menu dropdown-content z-[1] p-2 shadow-2xl bg-gray-900 rounded-2xl w-52 border border-gray-800 mb-2 gap-1 text-gray-300">
			<li><a href="/caches" class="{page.url.pathname === '/caches' ? 'active bg-primary/20 text-primary' : ''} rounded-xl"><Image size={18} /> Caches</a></li>
			<li><a href="/following" class="{page.url.pathname === '/following' ? 'active bg-primary/20 text-primary' : ''} rounded-xl"><UserCheck size={18} /> Following</a></li>
			<li><a href="/accounts" class="{page.url.pathname === '/accounts' ? 'active bg-primary/20 text-primary' : ''} rounded-xl"><Users size={18} /> Accounts</a></li>
		</ul>
	</div>
</nav>
