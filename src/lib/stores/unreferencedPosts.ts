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
import { browser } from '$app/env';
import { findUnreferencedPosts, type UnreferencedPostSummary } from '#lib/cache/posts';
import { accounts } from './accounts';
import { getCachedFollowedBlogs } from '#lib/cache/meta';
import type { TumblrBlog } from '#lib/types';

// The storage cursor returns only the fields the caches page renders, so a
// 10k-post library never materializes as full CachedPostEntry objects in JS.
export type { UnreferencedPostSummary };

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
			const entries = await findUnreferencedPosts(followed, accountBlogs);
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