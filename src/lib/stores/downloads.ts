import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import type { SlimMediaMeta } from '$lib/cache/blobs';
import { db } from '$lib/cache/newDb';
import { getCachedPostById, freshEntry, putCachedPostEntry } from '$lib/cache/posts';

export const activeDownloads = writable<Set<string>>(new Set());

// Keep track of metadata for urls currently downloading so we can save to IndexedDB when done
const downloadMeta = new Map<string, SlimMediaMeta>();

if (browser && navigator.serviceWorker) {
	navigator.serviceWorker.addEventListener('message', async (event) => {
		if (event.data && event.data.type === 'MEDIA_CACHED') {
			const { url, mimeType } = event.data;
			if (url) {
				// Remove from active UI state
				activeDownloads.update(set => {
					const next = new Set(set);
					next.delete(url);
					return next;
				});

				// Save post metadata to IndexedDB
				const meta = downloadMeta.get(url);
				if (meta) {
					try {
						await db.mediaUrls.put({ url, postId: meta.postId, type: mimeType || '' });
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
			}
		} else if (event.data && event.data.type === 'MEDIA_CACHE_ERROR') {
			const { url, error } = event.data;
			if (url) {
				activeDownloads.update(set => {
					const next = new Set(set);
					next.delete(url);
					return next;
				});
				downloadMeta.delete(url);
				console.error('Background download failed:', url, error);
				window.dispatchEvent(new CustomEvent('tmblr-media-error', { detail: { url, error } }));
			}
		}
	});
}

export function requestMediaDownload(url: string, meta: SlimMediaMeta) {
	if (!browser || !url) return;
	
	// Wait for SW controller to be active
	if (!navigator.serviceWorker?.controller) {
		console.warn('Cannot download media: Service Worker not controlling the page.');
		return;
	}

	downloadMeta.set(url, meta);
	
	activeDownloads.update(set => {
		const next = new Set(set);
		next.add(url);
		return next;
	});

	navigator.serviceWorker.controller.postMessage({
		type: 'CACHE_MEDIA',
		url
	});
}
