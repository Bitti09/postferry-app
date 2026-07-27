// ─── Re-export shim for `src/lib/stores/postCache` import paths ─────────────

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