<script lang="ts">
	import { settings } from "$lib/stores/settings";
	import { HardDrive, Settings as SettingsIcon } from "lucide-svelte";
</script>

<svelte:head>
	<title>Settings - tmblr</title>
</svelte:head>

<div class="min-h-screen bg-black">
	<div class="max-w-4xl mx-auto py-12 px-4 md:px-8">
		<div class="flex items-center gap-4 mb-10">
		<div class="w-14 h-14 rounded-2xl bg-primary/20 flex items-center justify-center text-primary shadow-[0_0_30px_rgba(var(--color-primary),0.3)]">
			<SettingsIcon size={28} />
		</div>
		<div>
			<h1 class="text-4xl font-black text-white tracking-tight">Settings</h1>
			<p class="text-gray-400 text-base mt-1 font-medium">Configure your local client preferences and power-user features.</p>
		</div>
	</div>

	<div class="bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl space-y-8">
		<h2 class="text-2xl font-bold text-white flex items-center gap-3 border-b border-gray-800 pb-5">
			<HardDrive size={24} class="text-primary" /> Storage & Caching
		</h2>

		<div class="flex items-start justify-between gap-6 p-6 rounded-2xl bg-gray-800/30 hover:bg-gray-800/60 transition-colors border border-gray-800/50">
			<div class="max-w-2xl">
				<h3 class="text-lg text-white font-black tracking-wide">Auto-Cache Media (Storage Buckets)</h3>
				<p class="text-[15px] text-gray-400 mt-2 leading-relaxed">
					Automatically download and cache every image, audio, and video file as soon as they appear in your feed. 
					This ensures full offline availability of all media you scroll past. Files are stored using the browser's local Storage Buckets API to intelligently manage quota.
				</p>
			</div>
			<input 
				type="checkbox" 
				class="toggle toggle-primary toggle-lg mt-2" 
				checked={$settings.autoCacheMedia} 
				onchange={(e) => {
					$settings.autoCacheMedia = e.currentTarget.checked;
				}}
			/>
		</div>
	</div>
</div>
</div>
