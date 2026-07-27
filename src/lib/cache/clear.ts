// ─── Cache clear helpers ────────────────────────────────────────────────────
// Cross-store atomic clears. `clearCache` wipes posts + blobs + blobsIndex in
// one tx so a half-cleared state can never be observed. `meta` and `accounts`
// are wiped too — v7 is a clean break, old auth metadata is invalid.

import { browser } from '$app/environment';
import { STORES, idbTx } from './db';
import { revokeAllBlobUrls } from './blobs';

export async function clearCache(): Promise<void> {
	if (!browser) return;
	revokeAllBlobUrls();
	await idbTx([
		{ store: STORES.posts, op: 'clear' },
		{ store: STORES.blobs, op: 'clear' },
		{ store: STORES.blobsIndex, op: 'clear' },
		{ store: STORES.meta, op: 'clear' },
		{ store: STORES.accounts, op: 'clear' },
		{ store: STORES.accountInfos, op: 'clear' },
		{ store: STORES.blogInfos, op: 'clear' },
		{ store: STORES.settings, op: 'clear' },
		{ store: STORES.followedBlogs, op: 'clear' },
		{ store: STORES.avatars, op: 'clear' }
	]);
}

export async function clearMediaCache(): Promise<void> {
	if (!browser) return;
	revokeAllBlobUrls();
	await idbTx([
		{ store: STORES.blobs, op: 'clear' },
		{ store: STORES.blobsIndex, op: 'clear' }
	]);
}
