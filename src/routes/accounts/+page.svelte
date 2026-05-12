<script lang="ts">
	import { onMount } from 'svelte';
	import { accounts } from '$lib/stores/accounts';
	import { Heart, User, RefreshCw, CheckCircle2, Circle } from 'lucide-svelte';

	let accountInfos = $state<Record<string, any>>({});
	let loading = $state(false);
	let error = $state('');

	async function fetchAccountInfos() {
		loading = true;
		error = '';
		try {
			const promises = $accounts.map(async (acc) => {
				const res = await fetch('/api/user/info', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ account: acc })
				});
				if (res.ok) {
					const info = await res.json();
					accountInfos[acc.blogName] = info;
				}
			});
			await Promise.all(promises);
		} catch (err: any) {
			error = 'Failed to fetch some account information.';
			console.error(err);
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		fetchAccountInfos();
	});

	function toggleActive(blogName: string) {
		accounts.update(all => all.map(acc => {
			if (acc.blogName === blogName) {
				return { ...acc, active: !acc.active };
			}
			return acc;
		}));
	}
</script>

<div class="min-h-screen bg-black p-4 md:p-8">
	<div class="mx-auto w-full">
		<header class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
			<div>
				<h1 class="text-4xl font-black text-white tracking-tight flex items-center gap-3">
					<User class="text-primary" size={36} />
					Managed Accounts
				</h1>
				<p class="text-gray-400 mt-2">Manage and monitor all your connected Tumblr blogs.</p>
			</div>
			<div class="flex items-center gap-3">
				<a 
					href="/api/auth/tumblr" 
					class="btn btn-outline border-gray-800 text-gray-400 hover:bg-gray-800 gap-2"
					title="Right-click and select 'Open in Incognito' to add a different account"
				>
					Add Account (Incognito)
				</a>
				<button 
					class="btn btn-primary gap-2 shadow-lg shadow-primary/20" 
					onclick={fetchAccountInfos}
					disabled={loading}
				>
					<RefreshCw size={18} class={loading ? 'animate-spin' : ''} />
					Refresh Stats
				</button>
			</div>
		</header>

		{#if error}
			<div class="alert alert-error mb-8 shadow-xl">
				<span>{error}</span>
			</div>
		{/if}

		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
			{#each $accounts as account}
				{@const info = accountInfos[account.blogName]}
				<div class="card bg-gray-900 border border-gray-800 shadow-xl hover:border-primary/50 transition-all group">
					<div class="card-body p-6">
						<div class="flex items-start justify-between mb-4">
							<div class="flex items-center gap-4">
								<div class="avatar">
									<div class="w-16 h-16 rounded-2xl ring-2 ring-gray-800 ring-offset-2 ring-offset-gray-900 overflow-hidden bg-gray-800">
										{#if info}
											<img src={`https://api.tumblr.com/v2/blog/${account.blogName}/avatar/128`} alt={account.blogName} />
										{:else}
											<div class="flex items-center justify-center h-full w-full">
												<User size={32} class="text-gray-700" />
											</div>
										{/if}
									</div>
								</div>
								<div>
									<h2 class="card-title text-white text-xl font-bold">{account.blogName}</h2>
									<p class="text-xs text-gray-500 font-mono uppercase tracking-widest mt-1">
										{info?.name || 'Loading...'}
									</p>
								</div>
							</div>
							<button 
								class="btn btn-ghost btn-circle btn-sm {account.active ? 'text-green-500' : 'text-gray-600'}"
								onclick={() => toggleActive(account.blogName)}
								title={account.active ? 'Deactivate' : 'Activate'}
							>
								{#if account.active}
									<CheckCircle2 size={24} />
								{:else}
									<Circle size={24} />
								{/if}
							</button>
						</div>

						<div class="grid grid-cols-2 gap-4 mt-4">
							<div class="bg-gray-800/50 rounded-xl p-4 border border-gray-800 flex flex-col items-center justify-center">
								<Heart class="text-pink-500 mb-2" size={20} />
								<span class="text-2xl font-black text-white">{info?.likes || '0'}</span>
								<span class="text-[10px] text-gray-500 uppercase font-bold tracking-tighter">Liked Posts</span>
							</div>
							<div class="bg-gray-800/50 rounded-xl p-4 border border-gray-800 flex flex-col items-center justify-center">
								<RefreshCw class="text-green-500 mb-2" size={20} />
								<span class="text-2xl font-black text-white">{info?.following || '0'}</span>
								<span class="text-[10px] text-gray-500 uppercase font-bold tracking-tighter">Following</span>
							</div>
						</div>

						<div class="card-actions justify-end mt-6">
							<a href={`/blog/${account.blogName}`} class="btn btn-sm btn-ghost gap-2 text-gray-400 hover:text-white group-hover:bg-gray-800">
								View Blog
							</a>
							<button class="btn btn-sm btn-outline border-gray-800 hover:bg-gray-800 text-gray-400" onclick={() => window.location.href = `/likes?account=${account.blogName}`}>
								See Likes
							</button>
						</div>
					</div>
				</div>
			{:else}
				<div class="col-span-full py-20 flex flex-col items-center justify-center bg-gray-900/50 rounded-3xl border-2 border-dashed border-gray-800">
					<User size={48} class="text-gray-700 mb-4" />
					<p class="text-gray-400">No accounts connected yet.</p>
					<button class="btn btn-primary btn-sm mt-4">Connect Account</button>
				</div>
			{/each}
		</div>
	</div>
</div>

<style>
	:global(.card) {
		perspective: 1000px;
	}
</style>
