<script lang="ts">
	import { settings } from "#lib/stores/settings";
	import { HardDrive, Settings as SettingsIcon, LayoutGrid, Bug, Image, BookOpen } from "@lucide/svelte";

	let windowWidth = $state(1024);

	let autoColumns = $derived.by(() => {
		if (windowWidth < 640) return 2;
		if (windowWidth < 768) return 3;
		if (windowWidth < 1024) return 4;
		if (windowWidth < 1280) return 5;
		if (windowWidth < 1536) return 6;
		return 7;
	});

	let maxMediaColumns = $derived(autoColumns * 2);
	let minMediaSlider = $derived(autoColumns - 1);

	let mediaSliderValue = $derived.by(() => {
		if ($settings.mediaColumns === 'auto') return minMediaSlider;
		const parsed = parseInt($settings.mediaColumns, 10);
		return Math.max(autoColumns, Math.min(maxMediaColumns, parsed));
	});

	function handleMediaSlider(e: Event) {
		const val = parseInt((e.target as HTMLInputElement).value, 10);
		settings.update(s => ({ ...s, mediaColumns: val === minMediaSlider ? 'auto' : String(val) }));
	}

	// Blog cards: default range 1–8 (auto = 4 col which is a reasonable card count)
	let autoBlogCols = $derived.by(() => {
		if (windowWidth < 640) return 1;
		if (windowWidth < 1024) return 2;
		if (windowWidth < 1280) return 3;
		return 4;
	});

	let maxBlogColumns = $derived(autoBlogCols * 2);
	let minBlogSlider = $derived(autoBlogCols - 1 || 1);

	let blogSliderValue = $derived.by(() => {
		if ($settings.blogCardColumns === 'auto') return minBlogSlider;
		const parsed = parseInt($settings.blogCardColumns, 10);
		return Math.max(autoBlogCols, Math.min(maxBlogColumns, parsed));
	});

	function handleBlogSlider(e: Event) {
		const val = parseInt((e.target as HTMLInputElement).value, 10);
		settings.update(s => ({ ...s, blogCardColumns: val === minBlogSlider ? 'auto' : String(val) }));
	}
</script>

<svelte:window bind:innerWidth={windowWidth} />

<svelte:head>
	<title>Settings - tmblr</title>
</svelte:head>

<div class="min-h-dvh bg-black text-white">
	<div class="max-w-4xl mx-auto py-12 px-4 md:px-8">
		<div class="flex items-center gap-4 mb-10">
			<div class="w-14 h-14 rounded-2xl bg-primary/20 flex items-center justify-center text-primary shadow-lg shadow-primary/20">
				<SettingsIcon size={28} />
			</div>
			<div>
				<h1 class="text-4xl font-black text-white tracking-tight">Settings</h1>
				<p class="text-gray-400 text-base mt-1 font-medium">Configure your local client preferences and power-user features.</p>
			</div>
		</div>

		<div class="bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl space-y-8">
			<!-- Storage & Caching -->
			<div>
				<h2 class="text-2xl font-bold text-white flex items-center gap-3 border-b border-gray-800 pb-5 mb-6">
					<HardDrive size={24} class="text-primary" /> Storage &amp; Caching
				</h2>

				<div class="flex items-start justify-between gap-6 p-6 rounded-2xl bg-gray-800/30 hover:bg-gray-800/60 transition-colors border border-gray-800/50">
					<div class="max-w-2xl">
						<h3 class="text-lg text-white font-black tracking-wide">Auto-Cache Media</h3>
						<p class="text-[15px] text-gray-400 mt-2 leading-relaxed">
							Automatically download and cache every image, audio, and video file as soon as they appear in your feed. 
							This ensures full offline availability of all media you scroll past. Media and the app shell are stored in the Origin Private File System; your accounts and post index live in a persisted storage bucket. Cache Storage is not used.
						</p>
					</div>
					<input 
						type="checkbox" 
						class="toggle toggle-primary toggle-lg mt-2" 
						checked={$settings.autoCacheMedia} 
						onchange={(e) => {
							settings.update(s => ({ ...s, autoCacheMedia: e.currentTarget.checked }));
						}}
					/>
				</div>
			</div>

			<!-- Display & Grid Layout -->
			<div>
				<h2 class="text-2xl font-bold text-white flex items-center gap-3 border-b border-gray-800 pb-5 mb-6 pt-4">
					<LayoutGrid size={24} class="text-primary" /> Display &amp; Grid Layout
				</h2>

				<!-- Media Grid -->
				<div class="flex flex-col md:flex-row md:items-center justify-between gap-6 p-6 rounded-2xl bg-gray-800/30 hover:bg-gray-800/60 transition-colors border border-gray-800/50 mb-4">
					<div class="max-w-xl">
						<h3 class="text-lg text-white font-black tracking-wide flex items-center gap-2">
							<Image size={18} class="text-primary" /> Media Grid Columns
						</h3>
						<p class="text-[15px] text-gray-400 mt-2 leading-relaxed">
							Controls the number of columns on post grids: Dashboard, Favourites, Search, Caches, and individual blog feeds. "Auto" scales with your screen width.
						</p>
					</div>
					
					<div class="flex items-center gap-4 w-full md:max-w-xs select-none">
						<input 
							type="range" 
							min={minMediaSlider} 
							max={maxMediaColumns} 
							value={mediaSliderValue} 
							oninput={handleMediaSlider}
							class="range range-primary cursor-pointer accent-primary bg-gray-800 flex-1" 
						/>
						<span class="text-lg text-white font-mono font-bold min-w-27.5 text-right">
							{mediaSliderValue === minMediaSlider ? `Auto (${autoColumns})` : `${mediaSliderValue} Columns`}
						</span>
					</div>
				</div>

				<!-- Blog Card Grid -->
				<div class="flex flex-col md:flex-row md:items-center justify-between gap-6 p-6 rounded-2xl bg-gray-800/30 hover:bg-gray-800/60 transition-colors border border-gray-800/50">
					<div class="max-w-xl">
						<h3 class="text-lg text-white font-black tracking-wide flex items-center gap-2">
							<BookOpen size={18} class="text-primary" /> Blog Card Columns
						</h3>
						<p class="text-[15px] text-gray-400 mt-2 leading-relaxed">
							Controls the number of columns on the Followed Blogs page. "Auto" scales with your screen width (fewer columns for larger cards).
						</p>
					</div>
					
					<div class="flex items-center gap-4 w-full md:max-w-xs select-none">
						<input 
							type="range" 
							min={minBlogSlider} 
							max={maxBlogColumns} 
							value={blogSliderValue} 
							oninput={handleBlogSlider}
							class="range range-primary cursor-pointer accent-primary bg-gray-800 flex-1" 
						/>
						<span class="text-lg text-white font-mono font-bold min-w-27.5 text-right">
							{blogSliderValue === minBlogSlider ? `Auto (${autoBlogCols})` : `${blogSliderValue} Columns`}
						</span>
					</div>
				</div>
			</div>

			<!-- Developer & Debugging -->
			<div>
				<h2 class="text-2xl font-bold text-white flex items-center gap-3 border-b border-gray-800 pb-5 mb-6 pt-4">
					<Bug size={24} class="text-primary" /> Developer &amp; Debugging
				</h2>

				<div class="flex items-start md:items-center justify-between gap-6 p-6 rounded-2xl bg-gray-800/30 hover:bg-gray-800/60 transition-colors border border-gray-800/50">
					<div class="max-w-xl">
						<h3 class="text-lg text-white font-black tracking-wide">Current Viewport Breakpoint</h3>
						<p class="text-[15px] text-gray-400 mt-2 leading-relaxed">
							Identifies the active Tailwind CSS breakpoint matching your screen's width.
						</p>
					</div>
					
					<span class="badge badge-lg badge-outline border-gray-800 bg-gray-950 text-primary font-mono text-[11px] tracking-wider uppercase font-black select-none py-3.5 px-4 rounded-xl shrink-0 mt-1 md:mt-0">
						<span class="inline sm:hidden">xs (Mobile)</span>
						<span class="hidden sm:inline md:hidden">sm (Small)</span>
						<span class="hidden md:inline lg:hidden">md (Medium)</span>
						<span class="hidden lg:inline xl:hidden">lg (Large)</span>
						<span class="hidden xl:inline 2xl:hidden">xl (Extra Large)</span>
						<span class="hidden 2xl:inline">2xl (Ultra Wide)</span>
					</span>
				</div>
			</div>

		</div>
	</div>
</div>
