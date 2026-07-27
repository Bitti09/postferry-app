import { browser } from '$app/environment';
import { db } from './newDb';

export async function clearCache(): Promise<void> {
	if (!browser) return;
	
	if (window.caches) {
		await caches.delete('tmblr-media');
	}
	
	const tablesToClear = [db.posts, db.mediaUrls, db.meta, db.avatars, db.blogInfos];
	await db.transaction('rw', tablesToClear, async () => {
		for (const table of tablesToClear) {
			await table.clear();
		}
	});
}

export async function clearMediaCache(): Promise<void> {
	if (!browser) return;
	
	if (window.caches) {
		await caches.delete('tmblr-media');
	}
	await db.mediaUrls.clear();
}
