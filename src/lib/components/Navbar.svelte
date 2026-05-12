<script lang="ts">
	import { page } from '$app/stores';
	import { Home, Image, Heart, Users, Search } from 'lucide-svelte';
</script>

<div class="navbar bg-gray-900 border-b border-gray-800 px-4 md:px-8 sticky top-0 z-40 backdrop-blur-md bg-opacity-80">
	<div class="flex-1">
		<a href="/" class="text-2xl font-black text-white tracking-tighter flex items-center gap-2">
			<span class="bg-primary text-white w-8 h-8 flex items-center justify-center rounded-lg">T</span>
			tmblr
		</a>
	</div>
	<div class="flex-none gap-4">
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
		</ul>
	</div>
</div>
