// ─── Unreferenced-Post Index ────────────────────────────────────────────────
// Slim summaries of posts whose `cachedFromBlog` is not in any current
// followed-blog list or connected account. Coalesces concurrent scans via a
// module-level in-flight promise — no race window.
//
// The summaries intentionally strip the full TumblrPost payload — for 10k+
// cached posts, holding every CachedPostEntry in JS just to power the badges
// on the caches page is what we got into trouble with. Each entry carries
// only the fields the UI renders, plus the cachedAt timestamp so the summary
// list can be sorted without re-walking storage.

import { writable, type Readable } from 'svelte/store';
import { browser } from '$app/environment';
import { findUnreferencedPosts } from '$lib/cache/posts';
import { accounts } from './accounts';
import { getCachedFollowedBlogs } from '$lib/cache/meta';
import type { TumblrBlog } from '$lib/types';

// Slim shape used by the caches page badges. The cursor walks on the
// storage side; the page only ever holds these summaries in memory.
// CoreStorage is migrating `findUnreferencedPosts` to return this directly;
// until that lands we map the legacy `CachedPostEntry` shape into it.
type SlimEntry = {
	id: number;
	blogName: string;
	timestamp?: number;
	cachedAt: number;
	summary?: string;
	type?: string;
	tags?: string[];
};

export type UnreferencedPostSummary = SlimEntry;

export interface UnreferencedState {
	entries: UnreferencedPostSummary[];
	scanning: boolean;
	lastScannedAt: number | null;
}

const internal = writable<UnreferencedState>({
	entries: [],
	scanning: false,
	lastScannedAt: null
});

export const unreferencedPosts: Readable<UnreferencedState> = { subscribe: internal.subscribe };

let $accountsState: { blogName: string }[] = [];
accounts.subscribe((v) => ($accountsState = v));

let inFlight: Promise<void> | null = null;

export async function refreshUnreferencedPosts(): Promise<void> {
	if (!browser) return;
	if (inFlight) return inFlight;
	internal.update((s) => ({ ...s, scanning: true }));
	inFlight = (async () => {
		try {
			const followedBlogs = await getCachedFollowedBlogs();
			const followed = new Set<string>(followedBlogs.map((b: TumblrBlog) => b?.name).filter(Boolean));
			const accountBlogs = new Set<string>($accountsState.map((a) => a.blogName).filter(Boolean));
			// Returns slim summaries, not full CachedPostEntry. The cursor walks
			// happen on the storage side; the page only ever holds summaries in
			// memory.
			// CoreStorage will rename the return to `UnreferencedPostSummary[]`;
			// until that lands we map the legacy `CachedPostEntry` shape into the
			// slim fields we actually need here.
			const raw = (await findUnreferencedPosts(followed, accountBlogs)) as unknown as Array<{
				post?: { id?: number; type?: string; tags?: string[]; summary?: string; timestamp?: number };
				cachedAt?: number;
				cachedFromBlog?: string;
			}>;
			const entries: UnreferencedPostSummary[] = raw.map((e) => ({
				id: Number(e.post?.id ?? 0),
				blogName: String(e.cachedFromBlog ?? ''),
				timestamp: e.post?.timestamp,
				cachedAt: e.cachedAt ?? Date.now(),
				summary: e.post?.summary,
				type: e.post?.type,
				tags: e.post?.tags
			}));
			internal.set({ entries, scanning: false, lastScannedAt: Date.now() });
		} catch (e) {
			console.warn('[storage] refreshUnreferencedPosts failed', e);
			internal.update((s) => ({ ...s, scanning: false }));
		} finally {
			inFlight = null;
		}
	})();
	return inFlight;
}