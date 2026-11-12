import { browser } from '$app/env';
import { db } from './newDb';
import { gcOrphanBlobs } from './blobs';
import { deleteMediaFile } from '#lib/mediaFiles';
import { activeDownloads } from '#lib/stores/downloads';
import { dropCachedUrl } from '../mediaCacheStatus.svelte.ts';

// Bounded offline cache: without this, 10+ accounts with thousands of
// images/videos grow tmblr-media until the browser's storage quota kills it.
const MAX_ENTRIES = 20_000;
const MAX_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB
// If total storage usage blows past the byte cap, shrink much harder —
// a few huge videos can exceed bytes while staying under the entry cap.
const EMERGENCY_TARGET = MAX_ENTRIES / 2;

const DELETE_CHUNK = 100;

let maintenanceRunning = false;
let maintenanceTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced maintenance so N call sites (page loads, bulk caches) coalesce. */
export function scheduleMediaMaintenance(delayMs = 15_000): void {
	if (!browser) return;
	if (maintenanceTimer) return;
	maintenanceTimer = setTimeout(() => {
		maintenanceTimer = null;
		void runMediaMaintenance();
	}, delayMs);
}

export async function runMediaMaintenance(): Promise<{ gcBlobs: number; evicted: number }> {
	if (!browser || maintenanceRunning) return { gcBlobs: 0, evicted: 0 };
	maintenanceRunning = true;
	try {
		const gc = await gcOrphanMedia();
		const evicted = await enforceMediaCacheLimit();
		return { gcBlobs: gc.deletedBlobs, evicted };
	} catch (e) {
		console.error('[media maintenance] failed', e);
		return { gcBlobs: 0, evicted: 0 };
	} finally {
		maintenanceRunning = false;
	}
}

/** Delete blobs whose posts no longer exist in the IDB post index. */
export async function gcOrphanMedia(): Promise<{ deletedBlobs: number; deletedIndex: number }> {
	const ids = await db.posts.orderBy('id').primaryKeys();
	return gcOrphanBlobs(new Set(ids));
}

/**
 * Evict oldest blobs (by cachedAt) until the cache fits under the caps.
 * Byte-aware: rows with a known `size` consume the byte budget; unknown-size
 * rows only consume an entry slot. Uses a streaming cursor with early exit
 * instead of materializing the whole table.
 * Downloads currently in flight are skipped so we never delete a blob the
 * service worker is about to write.
 */
export async function enforceMediaCacheLimit(): Promise<number> {
	const count = await db.mediaUrls.count();

	let usage = 0;
	try {
		usage = (await navigator.storage.estimate()).usage ?? 0;
	} catch {
		// estimate unavailable — fall back to the entry cap only
	}

	const emergency = usage > MAX_BYTES;
	const entryTarget = emergency ? EMERGENCY_TARGET : MAX_ENTRIES;
	if (count <= entryTarget && !emergency) return 0;

	let active = new Set<string>();
	activeDownloads.subscribe((value) => { active = value; })();

	// Streaming LRU walk: oldest first. Stop as soon as both budgets fit.
	let toDelete: string[] = [];
	let deletedBytes = 0;
	let estimatedOverrun = emergency ? usage - MAX_BYTES : 0;

	await db.mediaUrls.orderBy('cachedAt').each(entry => {
		if (count - toDelete.length <= entryTarget && estimatedOverrun <= 0) return;
		if (active.has(entry.url)) return;
		toDelete.push(entry.url);
		deletedBytes += entry.size ?? 0;
		if (estimatedOverrun > 0) estimatedOverrun -= entry.size ?? 0;
	});

	if (toDelete.length === 0) return 0;

	let deleted = 0;
	for (let i = 0; i < toDelete.length; i += DELETE_CHUNK) {
		const chunk = toDelete.slice(i, i + DELETE_CHUNK);
		for (const url of chunk) {
			if (await deleteMediaFile(url)) deleted++;
			dropCachedUrl(url);
		}
		await db.mediaUrls.bulkDelete(chunk);
	}
	return deleted;
}
