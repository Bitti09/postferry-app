// ─── Re-export shim for `src/lib/stores/mediaCache` import paths ────────────

export {
	getCachedBlobUrl,
	isMediaCached,
	bulkIsMediaCached,
	downloadAndCacheMedia,
	clearMediaCache,
	clearMediaForPost,
	gcOrphanBlobs,
	getMediaCacheStats,
	getMediaForPost,
	revokeBlobUrl,
	revokeAllBlobUrls,
	bulkCacheMedia,
	getMediaId,
	getResolutionScore,
	type CachedBlobResult,
	type SlimMediaMeta,
	type StoredBlob,
	type BlobsIndexEntry,
	type MediaRef
} from '$lib/cache/blobs';