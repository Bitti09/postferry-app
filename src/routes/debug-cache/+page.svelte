<script lang="ts">
	import { onMount } from 'svelte';
	import { db } from '#lib/cache/newDb';
	
	let out = $state("loading...");
	onMount(async () => {
		try {
			const posts = await db.posts.limit(10).toArray();
			const summary = posts.map(p => ({
				id: p.id,
				cachedFromBlog: p.cachedFromBlog,
				likedBy: p.likedBy,
				post_liked: p.post.liked,
				sortTimestamp: p.sortTimestamp
			}));
			out = JSON.stringify(summary, null, 2);
		} catch(e: any) {
			out = "ERROR: " + e.message;
		}
	});
</script>

<pre>{out}</pre>
