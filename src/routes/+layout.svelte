<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import "./app.css";
	import favicon from "$lib/assets/favicon.svg";

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

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<div class="flex flex-col min-h-screen">
	<Navbar />
	<main class="flex-1">
		{@render children()}
	</main>
</div>
