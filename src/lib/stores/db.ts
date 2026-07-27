// ─── Re-export shim for `src/lib/stores/*` import paths ─────────────────────
// The cache layer lives at `src/lib/cache/**`; everything below just
// re-exports the same symbols so old imports keep working.

export {
	getCachedPostById,
	getCachedPostsPage,
	bulkSetPosts,
	removeCachedPost,
	clearPosts,
	clearAllPosts,
	clearPostCache,
	clearPostsForBlog,
	mergePostMeta,
	mergeNotes,
	loadNotes,
	clearNotesForPost,
	findUnreferencedPosts,
	putCachedPostEntry,
	buildEntryFromApi,
	type CachedPostEntry,
	type NoteTotals
} from '$lib/cache/posts';

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

export {
	clearCache,
	loadAllAccountInfos,
	setAccountInfo,
	getCachedBlogInfo,
	setCachedBlogInfo,
	loadAllFollowedBlogLists,
	saveFollowedBlogsForAccount,
	getCachedFollowedBlogs,
	getCachedAvatar,
	loadAllAccounts,
	saveAccount,
	deleteAccount,
	saveAllAccounts,
	loadSettings,
	saveSettings,
	DEFAULT_SETTINGS,
	getMeta,
	setMeta,
	type CachedBlogInfo,
	type CachedFollowedList,
	type Settings
} from '$lib/cache/meta';

export {
	extractMedia,
	getAllMediaUrls,
	getPrimaryMediaUrl,
	getVideoUrls,
	getImageUrls
} from '$lib/mediaUrls';