<script lang="ts">
	import { onMount } from "svelte";
	import { browser } from "$app/environment";
	import { page } from "$app/stores";
	import { goto } from "$app/navigation";
	import "./app.css";

	import Navbar from "$lib/components/Navbar.svelte";
	import { accounts, accountsReady } from "$lib/stores/accounts";
	import { refreshUnreferencedPosts } from "$lib/stores/unreferencedPosts";
	import { initMediaCacheStatus } from "../lib/mediaCacheStatus.svelte.ts";
	import { scheduleMediaMaintenance } from "$lib/cache/eviction";
	import { setQueueDrainHandler } from "$lib/stores/downloads";
	import type { TumblrAccount } from "$lib/types";

	let { children } = $props();

	onMount(() => {
		if (browser && navigator.storage?.persist) {
			void navigator.storage.persist();
			// Note: browsers only auto-grant on production sites with high engagement.
			// On localhost this is always false but data is safe in practice.
		}
		if (browser) {
			initMediaCacheStatus();
			// Orphan GC + size-cap eviction, debounced so it runs after the
			// feed has settled, not during initial renders.
			scheduleMediaMaintenance();
			// Also run maintenance shortly after a download burst fully drains.
			setQueueDrainHandler(() => scheduleMediaMaintenance(5_000));
			void refreshUnreferencedPosts();
		}
	});

	$effect(() => {
		const _ = $accounts;
		if (browser) void refreshUnreferencedPosts();
	});

	// Drain a pending OAuth account that the callback stashed in sessionStorage.
	// Waits for the accounts store to finish its initial IDB load so we merge
	// instead of clobbering existing entries, then clears sessionStorage + URL.
	let pendingHandled = false;
	$effect(() => {
		if (!browser) return;
		if (pendingHandled) return;
		if ($page.url.searchParams.get('pending') !== '1') return;
		if (!$accountsReady) return;

		pendingHandled = true;
		try {
			const raw = sessionStorage.getItem('pending_oauth_account');
			if (!raw) return;
			const account = JSON.parse(raw) as TumblrAccount;
			if (account?.blogName && account?.token && account?.secret) {
				accounts.addAccount(account);
			}
		} catch (e) {
			console.error('Failed to consume pending OAuth account', e);
		} finally {
			try { sessionStorage.removeItem('pending_oauth_account'); } catch {}
			void goto($page.url.pathname, { replaceState: true, noScroll: true, keepFocus: true });
		}
	});
</script>

<div class="flex flex-col min-h-screen pb-16 md:pb-0">
	<Navbar />
	<main class="flex-1">
		{@render children()}
	</main>
</div>