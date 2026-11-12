import { browser } from '$app/env';
import { db } from './newDb';
import { clearMediaFiles } from '#lib/mediaFiles';
import { resetMediaCacheStatus } from '../mediaCacheStatus.svelte.ts';

export async function clearCache(): Promise<void> {
	if (!browser) return;

	await clearMediaFiles();

	const tablesToClear = [db.posts, db.mediaUrls, db.meta, db.avatars, db.blogInfos];
	await db.transaction('rw', tablesToClear, async () => {
		for (const table of tablesToClear) {
			await table.clear();
		}
	});
	resetMediaCacheStatus();
}

export async function clearMediaCache(): Promise<void> {
	if (!browser) return;

	await clearMediaFiles();
	await db.mediaUrls.clear();
	resetMediaCacheStatus();
}
