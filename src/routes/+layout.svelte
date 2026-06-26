<script lang="ts">
	import { onMount } from "svelte";
	import { browser } from "$app/environment";
	import "./app.css";

	import Navbar from "$lib/components/Navbar.svelte";
	let { children } = $props();

	onMount(async () => {
		if (browser && navigator.storage?.persist) {
			await navigator.storage.persist();
			// Note: browsers only auto-grant on production sites with high engagement.
			// On localhost this is always false but data is safe in practice.
		}
	});
</script>

<div class="flex flex-col min-h-screen">
	<Navbar />
	<main class="flex-1">
		{@render children()}
	</main>
</div>
