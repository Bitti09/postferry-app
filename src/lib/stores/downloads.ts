import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import type { SlimMediaMeta } from '$lib/cache/blobs';
import { db } from '$lib/cache/newDb';
import { getCachedPostById, freshEntry, putCachedPostEntry } from '$lib/cache/posts';
import { cachedMediaUrls } from '../mediaCacheStatus.svelte.ts';

export const activeDownloads = writable<Set<string>>(new Set());

// Max background fetches the service worker runs in parallel. A feed with
// thousands of media items must not become thousands of concurrent CDN
// requests — everything else waits in FIFO order.
const CONCURRENCY = 4;

// Metadata for urls currently queued or downloading so we can save to IndexedDB when done
const downloadMeta = new Map<string, SlimMediaMeta>();
const queue: string[] = [];
const queued = new Set<string>();
const inFlight = new Set<string>();
let pumping = false;

// Registered by the cache layer (layout) so eviction can run exactly when a
// full download burst finishes, not just on a fixed timer.
let onQueueDrained: (() => void) | null = null;

export function setQueueDrainHandler(handler: (() => void) | null): void {
	onQueueDrained = handler;
}

function maybeNotifyDrain() {
	if (queue.length === 0 && inFlight.size === 0) onQueueDrained?.();
}

function pumpQueue() {
	if (pumping) return;
	pumping = true;
	// Defer to a microtask so many requestMediaDownload calls in the same
	// tick (a whole row of cards mounting) batch into one pump.
	queueMicrotask(() => {
		pumping = false;
		const controller = browser ? navigator.serviceWorker?.controller : null;
		if (!controller) return;
		while (inFlight.size < CONCURRENCY && queue.length > 0) {
			const url = queue.shift()!;
			queued.delete(url);
			if (!url || inFlight.has(url) || cachedMediaUrls.has(url)) continue;
			inFlight.add(url);
			controller.postMessage({ type: 'CACHE_MEDIA', url });
		}
	});
}

function setActive(url: string, active: boolean) {
	activeDownloads.update(set => {
		const next = new Set(set);
		if (active) next.add(url);
		else next.delete(url);
		return next;
	});
}

if (browser && navigator.serviceWorker) {
	navigator.serviceWorker.addEventListener('message', async (event) => {
		if (event.data && event.data.type === 'MEDIA_CACHED') {
			const { url, mimeType } = event.data;
			if (url) {
				inFlight.delete(url);
				setActive(url, false);
				cachedMediaUrls.add(url);

				// Save post metadata to IndexedDB
				const meta = downloadMeta.get(url);
				if (meta) {
					try {
						await db.mediaUrls.put({ url, postId: meta.postId, type: mimeType || '', cachedAt: Date.now() });
						if (meta.post) {
							let existing = await getCachedPostById(meta.postId);
							if (!existing) {
								existing = freshEntry(meta.post, meta.blogName);
							} else {
								existing.post = meta.post;
								existing.cachedAt = Date.now();
							}
							await putCachedPostEntry(meta.postId, existing);
						}
					} catch (e) {
						console.error('Failed to save metadata to IndexedDB for', url, e);
					}
					downloadMeta.delete(url);
				}

				// Dispatch event so CachedMedia can retry loading
				window.dispatchEvent(new CustomEvent('tmblr-media-cached', { detail: { url } }));
				pumpQueue();
				maybeNotifyDrain();
			}
		} else if (event.data && event.data.type === 'MEDIA_CACHE_ERROR') {
			const { url, error } = event.data;
			if (url) {
				inFlight.delete(url);
				setActive(url, false);
				downloadMeta.delete(url);
				console.error('Background download failed:', url, error);
				window.dispatchEvent(new CustomEvent('tmblr-media-error', { detail: { url, error } }));
				pumpQueue();
				maybeNotifyDrain();
			}
		}
	});
}

export function requestMediaDownload(url: string, meta: SlimMediaMeta) {
	if (!browser || !url) return;

	// No-op if the blob is already stored, already queued, or already in flight.
	if (cachedMediaUrls.has(url)) return;
	if (queued.has(url) || inFlight.has(url)) return;

	// Wait for SW controller to be active
	if (!navigator.serviceWorker?.controller) {
		console.warn('Cannot download media: Service Worker not controlling the page.');
		return;
	}

	downloadMeta.set(url, meta);
	setActive(url, true);
	queue.push(url);
	queued.add(url);
	pumpQueue();
}