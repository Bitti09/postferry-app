import { writable } from 'svelte/store';
import { browser } from '$app/env';
import type { SlimMediaMeta } from '#lib/cache/blobs';
import { db, mediaAssetBase } from '#lib/cache/newDb';
import type { TumblrPost } from '#lib/types';
import { cachedMediaUrls, dropCachedUrl } from '../mediaCacheStatus.svelte.ts';
import { getCachedPostById, freshEntry, putCachedPostEntry } from '#lib/cache/posts';
import { indexStoredMedia } from '#lib/cache/blobs';

/**
 * Urls currently in flight (dispatched to the SW, not merely queued).
 * Kept small on purpose — it mirrors the concurrency window, so subscribers
 * (CachedMedia spinners) re-render only on real state changes, not on every
 * enqueue of a 5 000-item bulk cache.
 */
export const activeDownloads = writable<Set<string>>(new Set());

// Concurrency windows, per lane. Images are cheap parallel CDN fetches;
// videos are large and Range-sensitive, so they get their own narrow lane.
const IMAGE_CONCURRENCY = 8;
const VIDEO_CONCURRENCY = 2;

const MAX_RETRY_DELAY_MS = 30_000;
const FAILING_PAUSE_THRESHOLD = 6;
const FAILING_PAUSE_MS = 60_000;

export type DownloadPriority = 'visible' | 'prefetch' | 'bulk' | 'download';

const PRIORITY_ORDER: Record<DownloadPriority, number> = {
	download: 0,
	visible: 1,
	prefetch: 2,
	bulk: 3
};

interface QueueItem {
	url: string;
	priority: DownloadPriority;
	retries: number;
}

const isVideoUrl = (url: string) => /\.(mp4|webm|m3u8)(\?|$)/i.test(url);

// Metadata for urls currently queued or downloading so we can save to
// IndexedDB when done.
const downloadMeta = new Map<string, SlimMediaMeta>();
/** Lower number = dequeued first; ties keep FIFO order. */
const queue: QueueItem[] = [];
const queued = new Map<string, QueueItem>();
const inFlight = new Set<string>();
let pumping = false;
let consecutiveFailures = 0;
let pausedUntil = 0;
let pauseTimer: ReturnType<typeof setTimeout> | null = null;

// Registered by the cache layer (layout) so eviction can run exactly when a
// full download burst finishes, not just on a fixed timer.
let onQueueDrained: (() => void) | null = null;

export function setQueueDrainHandler(handler: (() => void) | null): void {
	onQueueDrained = handler;
}

function maybeNotifyDrain() {
	if (queue.length === 0 && inFlight.size === 0) onQueueDrained?.();
}

function laneConcurrency(url: string): number {
	return isVideoUrl(url) ? VIDEO_CONCURRENCY : IMAGE_CONCURRENCY;
}

function inFlightInLane(url: string): number {
	let count = 0;
	for (const flight of inFlight) {
		if (isVideoUrl(flight) === isVideoUrl(url)) count++;
	}
	return count;
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
		if (Date.now() < pausedUntil) return;

		queue.sort((a, b) =>
			PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.retries - b.retries
		);

		while (queue.length > 0) {
			const item = queue[0];
			if (inFlight.has(item.url)) {
				queue.shift();
				continue;
			}
			if (inFlightInLane(item.url) >= laneConcurrency(item.url)) break;
			queue.shift();
			queued.delete(item.url);
			if (cachedMediaUrls.has(item.url)) continue;
			inFlight.add(item.url);
			activeDownloads.update((set) => new Set(set).add(item.url));
			controller.postMessage({ type: 'CACHE_MEDIA', url: item.url });
		}
	});
}

/** Drop a still-queued item (component unmounted / scrolled away). */
export function cancelQueuedDownload(url: string): void {
	if (!queued.has(url)) return;
	const idx = queue.findIndex((q) => q.url === url);
	if (idx >= 0) queue.splice(idx, 1);
	queued.delete(url);
	downloadMeta.delete(url);
}

/** Dead-asset statuses: retrying can never succeed. */
const TERMINAL_STATUS_RE = /HTTP (403|404|410)\b/;

function handleFailure(url: string, error: string): void {
	// Gone is gone — 403/404/410 from the CDN means the asset is deleted or
	// private. Don't re-queue, don't feed the circuit breaker (one deleted
	// post shouldn't look like a network outage).
	if (TERMINAL_STATUS_RE.test(error)) {
		queued.delete(url);
		downloadMeta.delete(url);
		return;
	}
	const item = queued.get(url);
	if (item && item.retries < 3) {
		// Exponential backoff: re-queue with a deferred eligibility timestamp.
		item.retries++;
		queue.push(item);
		const delay = Math.min(1000 * 2 ** item.retries, MAX_RETRY_DELAY_MS);
		setTimeout(() => {
			if (queued.has(url)) pumpQueue();
		}, delay);
		return;
	}
	queued.delete(url);
	downloadMeta.delete(url);
	consecutiveFailures++;
	if (consecutiveFailures >= FAILING_PAUSE_THRESHOLD) {
		// Circuit breaker: CDN or network is down — stop hammering it.
		pausedUntil = Date.now() + FAILING_PAUSE_MS;
		consecutiveFailures = 0;
		if (pauseTimer) clearTimeout(pauseTimer);
		pauseTimer = setTimeout(() => {
			pausedUntil = 0;
			pumpQueue();
		}, FAILING_PAUSE_MS);
	}
}

if (browser && navigator.serviceWorker) {
	navigator.serviceWorker.addEventListener('message', async (event) => {
		const data = event.data as { type?: string; url?: string; mimeType?: string; error?: string; base?: string; ext?: string; area?: number; size?: number } | null;
		if (!data || !data.url) return;

		if (data.type === 'MEDIA_CACHED') {
			const { url, mimeType, size } = data;
			inFlight.delete(url);
			activeDownloads.update((set) => {
				if (!set.has(url)) return set;
				const next = new Set(set);
				next.delete(url);
				return next;
			});
			cachedMediaUrls.add(url);
			consecutiveFailures = 0;

			const meta = downloadMeta.get(url);
			await indexStoredMedia(url, meta?.postId ?? '0', mimeType ?? '', size ?? 0);

			// Save post metadata to IndexedDB
			if (meta) {
				try {
					if (meta.post) {
						// meta.post may be a Svelte $state proxy (captured from
						// component props at queue time) — IDB structured clone
						// rejects proxies. This is a plain .ts module, so no runes
						// here: JSON round-trip reads through proxies and produces
						// plain structured-cloneable data.
						const plainPost: TumblrPost = JSON.parse(JSON.stringify(meta.post));
						const existing = await getCachedPostById(meta.postId);
						if (!existing) {
							await putCachedPostEntry(meta.postId, freshEntry(plainPost, meta.blogName));
						} else {
							existing.post = plainPost;
							existing.updatedAt = Date.now();
							await putCachedPostEntry(meta.postId, existing);
						}
					}
				} catch (e) {
					console.error('Failed to save metadata to IndexedDB for', url, e);
				}
				downloadMeta.delete(url);
			}

			// Dispatch event so CachedMedia can retry loading
			window.dispatchEvent(new CustomEvent('postferry-media-cached', { detail: { url } }));
			pumpQueue();
			maybeNotifyDrain();
		} else if (data.type === 'MEDIA_CACHE_ERROR') {
			const { url, error } = data;
			inFlight.delete(url);
			activeDownloads.update((set) => {
				if (!set.has(url)) return set;
				const next = new Set(set);
				next.delete(url);
				return next;
			});
			console.error('Background download failed:', url, error);
			window.dispatchEvent(new CustomEvent('postferry-media-error', { detail: { url, error } }));
			handleFailure(url, error ?? 'unknown');
			pumpQueue();
			maybeNotifyDrain();
		} else if (data.type === 'RESOLVE_UPGRADE') {
			// The SW is about to cache a higher-res rendition; answer with the
			// lower-res siblings from the IDB asset index so it can drop them.
			const lower = await db.mediaUrls
				.where('base')
				.equals(data.base ?? '')
				.filter((row) => row.url !== data.url && row.url.endsWith(`.${data.ext}`) && (row.size ?? 0) < (data.area ?? 0))
				.primaryKeys();
			if (lower.length > 0) {
				navigator.serviceWorker.controller?.postMessage({ type: 'DROP_MEDIA', urls: lower });
			}
			for (const url of lower) dropCachedUrl(String(url));
			if (lower.length > 0) await db.mediaUrls.bulkDelete(lower);
		}
	});
}

// Requests parked while the SW controller is not yet active. Flushed once,
// in park order, when the controller appears.
const controllerWaiters = new Map<string, SlimMediaMeta>();
let controllerWaitArmed = false;

function armControllerWait(): void {
	if (controllerWaitArmed || !browser) return;
	const sw = navigator.serviceWorker;
	if (!sw) return;
	// Controller may already be set by the time this module loads (warm
	// navigation) — controllerchange won't fire in that case, so report
	// immediately.
	if (sw.controller) {
		console.log('[SW] Service worker is controlling the page (already active)');
		return;
	}
	controllerWaitArmed = true;
	sw.addEventListener('controllerchange', () => {
		controllerWaitArmed = false;
		// Re-dispatch every parked request in original order.
		const parked = [...controllerWaiters.entries()];
		controllerWaiters.clear();
		console.log(`[SW] Service worker took control of the page — flushing ${parked.length} parked download request${parked.length === 1 ? '' : 's'}`);
		for (const [url, meta] of parked) {
			requestMediaDownload(url, meta);
		}
	});
}


export function requestMediaDownload(
	url: string,
	meta: SlimMediaMeta,
	priority: DownloadPriority = 'visible'
) {
	if (!browser || !url) return;

	// No-op if the blob is already stored, already queued, or already in flight.
	if (cachedMediaUrls.has(url)) return;
	if (queued.has(url) || inFlight.has(url)) return;

	// SW not controlling yet (first load before clients.claim, or
	// registration still settling): park the request and retry once the
	// controller appears, instead of dropping the work with a warning.
	if (!navigator.serviceWorker?.controller) {
		if (!controllerWaiters.has(url)) {
			controllerWaiters.set(url, meta);
			armControllerWait();
		}
		return;
	}

	// Bulk never widens the queue unboundedly: cap at 2 000 pending items,
	// newest bulk requests win (LRU-style drop of the oldest bulk entries).
	if (queue.length >= 2000 && priority === 'bulk') return;
	while (queue.length >= 2000) {
		const victimIdx = queue.findIndex((q) => q.priority === 'bulk');
		const dropIdx = victimIdx >= 0 ? victimIdx : 0;
		const dropped = queue.splice(dropIdx, 1)[0];
		queued.delete(dropped.url);
		downloadMeta.delete(dropped.url);
	}

	downloadMeta.set(url, meta);
	const item: QueueItem = { url, priority, retries: 0 };
	queue.push(item);
	queued.set(url, item);
	pumpQueue();
}
