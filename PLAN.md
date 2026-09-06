# tmblr — Optimization & Feature Plan

Scope: multi-account everywhere, cache-first media + feeds at thousands-of-images scale, full Tumblr API usage, and a real download function that always saves the highest resolution shown.
Docs: Tumblr API v2 + tumblr.js v5 verified via Context7 (`/websites/tumblr_github_io_tumblr_js`) and tumblr.com/docs/en/api/v2. Key facts used: `userLikes` paginates with `before`/`after` (offset caps at 1000), `userDashboard` supports `since_id`/`before_id`, `limit` max 20 per page, `tagged` is api-key-global (not account-scoped) and paginates only by `before` timestamp, Tumblr media CDN sends `access-control-allow-origin: *` (verified live).

---

## P0 — Correctness bugs found during scan

1. **Viewed media is never persisted.** `service-worker.ts` handles `/api/media/proxy` cache-first, but on a miss it does `fetch(event.request)` and returns *without* `cache.put` into `tmblr-media`. Only explicit `CACHE_MEDIA` messages write the cache. Fix: SW fetches the target URL itself, `cache.put`s it, then responds (see P1.1).
2. **`parseTumblrMediaUrl` misses real Tumblr size patterns.** Regex `^(.*?_)(?:(\d+)|([a-zA-Z0-9]+))\.` doesn't match `s1280x1920`-style variants (`.../s512x512u_c1/...`, `sNNNxNNN` segments), so cache-upgrade dedupe misfires on a large share of assets. Rewrite to canonicalize both `_1280` and `sWxH` forms.
3. **`activeDownloads` O(n²) Set copying.** `requestMediaDownload` calls `setActive(url, true)` at *queue* time, and every add/remove copies the whole Set (`new Set(set)`). 5 000 queued items → ~12.5 M Set-element copies. Fix: mark active only when dispatched (in `pumpQueue`), or replace with a mutable Set + version counter.
4. **`vite.config.ts` hardcodes PWA `mode: 'development'`** — production builds ship a dev service worker. Derive from `process.env.NODE_ENV` / vite `mode`.
5. **Proxy retry double-downloads.** `/api/media/proxy` on `!res.ok` re-fetches the whole asset with a second `fetch`. Replace with a single strategy (direct SW fetch + proxy fallback in P1.1 makes this mostly moot). Also: `Connection: keep-alive` is a forbidden fetch header (ignored — remove), and client aborts are not propagated → add `request.signal` pass-through so aborted scrolls don't keep server-side downloads running.

## P1 — Media pipeline: cache-first, thousands of images, no double hop

1. **SW fetches Tumblr media directly; kill the Node proxy hop for images.**
   - CDN already returns `ACAO: *` → the SW can `fetch(targetUrl)` cross-origin with a *readable* (non-opaque) response, `cache.put(targetUrl, res)` into `tmblr-media`, respond, and broadcast `MEDIA_CACHED`. `/api/media/proxy` stays only as fallback for hosts without CORS and for first-play video `Range` streaming.
   - Win: halves transfer + latency for every uncached image, works with the app server down, removes the proxy as a bandwidth bottleneck for bulk caching.
2. **Display sized variants; cache exactly what's displayed.**
   - Grid cards currently request the full-size (often 1280 px/original) URL for ~200 px cells → decode + bandwidth waste at 7-column scale.
   - `mediaUrls.ts`: extend `MediaExtraction` with per-item `variants: MediaObject[]` (the NPF `media` arrays already carry width/height/`has_original_dimensions` — currently discarded by `pickBestMediaUrl`).
   - Add `variantUrl(best, targetPx)` that rewrites the size suffix (`_1280` → `_500`, `s1280x1920` → `s500x...`) using the fixed canonical parser (P0.2).
   - Grid: ~500 px variant; Lightbox/Slideshow: max variant; cache stores the displayed variant. No duplicate blobs per asset.
3. **Download queue overhaul (`stores/downloads.ts` + SW).**
   - Priorities: `visible` (mount/autoCache) > `prefetch` (idle) > `bulk` ("Cache All"). Higher priority dequeues first; bulk never starves scrolling.
   - Raise concurrency: ~8 image slots, separate 2-slot video lane (videos are large + Range-sensitive).
   - Cancellation: `PostCard` sends `CANCEL_MEDIA` on destroy for still-queued items; visible-first prevents re-queue churn.
   - Failure handling: per-URL retry with exponential backoff (max 3), poison-item drop, and a circuit-breaker pause after N consecutive failures.
   - `postMessage` correlation ids so responses map 1:1 to requests (today broadcast hits all clients).
4. **Cache-on-view.** Lightbox and Slideshow render via proxy without caching; route their loads through the same SW path so everything seen once is offline (consistent with autoCache).
5. **Idle prefetch.** After feed settles (queue drained), background-cache the next ~2 rows of media. Respect `navigator.connection.saveData` and the existing `eviction.ts` caps (20k entries / 4 GB).
6. **Eviction/GC cost trims.** `enforceMediaCacheLimit` does `db.mediaUrls.orderBy('cachedAt').toArray()` (full table in RAM); switch to a Dexie cursor with early exit once `target` deletions are collected. Space `scheduleMediaMaintenance` to drain events + 5 min, not 15 s.
7. **Upgrade-on-download backed by IDB, not `cache.keys()` scans.** Today each higher-res download scans up to 20k cache keys. Store `base` + `size` columns on `mediaUrls` (Dexie v4 schema) and look up lower-res siblings by index; keep full scan only as migration fallback.

## P2 — Download function (save to disk, always highest resolution)

New `$lib/download.ts`; UI: Download buttons on PostCard overlay, Lightbox, Slideshow, and post detail ("save media").

1. **Resolve the true best source** from `variants` (P1.2): prefer `has_original_dimensions && !cropped`, then max area, `hd` flag as tiebreak — same rules as `pickBestMediaUrl` but returning the object, not just the URL. GIFs/WebP originals stay original; native video → largest rendition MP4; third-party provider embeds (YouTube etc.) → button disabled with tooltip (not downloadable).
2. **Acquisition path:** if the best URL is already in `tmblr-media` → read blob from Cache API. Else run it through the download queue as a `download`-priority item (reuses concurrency, backoff, progress UI). Never downgrades: the variant fetched for saving is always the original/best, independent of what the grid displayed.
3. **Save:** `Blob` → object URL → `<a download>` with filename `{blogName}_{postId}_{n}.{ext}` (ext from content-type/URL), then `revokeObjectURL`. Multi-item posts: sequential anchor clicks with ~300 ms spacing (browser multi-download prompt); no zip dependency.
4. **Cache upgrade tie-in:** after saving the original, replace any lower-res cached variant (via the P1.7 index lookup) so disk reflects what the user saved.
5. Progress: reuse `activeDownloads` state; bulk "download all shown" gated by the existing progress bar components.

## P3 — Multi-account on all pages

Dashboard, likes, and following already fan out per account (`accounts[]` payload, per-account cursors, dedupe). The rest don't:

1. **Server routes accept `accounts[]` uniformly.** Add `$lib/server/clients.ts`: `forAccounts(payload)` → validates, builds (and memoizes per token in a `Map`) `tumblr.js` `Client`s, runs a mapper, returns `[{ accountBlogName, result | error }]`. Cutover all 8 single-`account` routes: `search`, `blog/info`, `blog/likes`, `blog/posts`, `posts/detail`, `posts/like`, `posts/reblog`, `user/info`. Deletes the duplicated per-route client boilerplate.
2. **Endpoint scoping** (don't multiply calls pointlessly): `tagged` (search) is api-key-global → one call regardless of account count. `blog/posts`/`blog/info` are key-readable → one call; `blog/likes` needs an account that shares likes → try active accounts in order, first success wins. `posts/detail` + like-state: key-readable post fetch + per-account `likedBy`/`rebloggedBy` merge (schema already supports `Record<blogName, boolean>`; detail page already loops accounts for actions). Like/reblog act per selected account as today.
3. **Per-account fan-out guard client-side:** cap parallel account requests (~4) to stay polite across N accounts; per-account error isolation already exists (one 401 shouldn't kill the page) — keep and surface per-account badges on failure.
4. **Cursors stay per account** (`accountOffsets` maps) — already correct; extend the pattern to blog pages.

## P4 — Cache-first feeds on all pages

1. **Hydrate from IDB before network.** Feeds currently start empty and wait for Tumblr. `getCachedPostsPage` exists but is only used by `/caches`. Change `/` and `/likes` (and blog/detail) load flow: render IDB page instantly → network refresh merges on top (dedupe by id already in place). Offline = instant populated feed.
2. **Smart refresh instead of reload-all:** dashboard refetch uses `since_id` (top-up new posts) instead of full reset on account/filter-unchanged revisits; likes keeps `before`-cursor downward + `after` top-up.
3. **Trim feed payloads:** drop `notes_info: true` from dashboard/likes/blog-posts feed fetches (notes only needed on detail, which already paginates notes separately). Keeps `npf`, `reblog_info`. Meaningfully smaller JSON per page × every account.
4. **Blog/search pages get the same IDB merge + snapshot** (dashboard page lacks the `snapshot` scroll-restoration the likes page has — add it).
5. **`extractionCache` → `WeakMap<TumblrPost, MediaExtraction>`**: no size cap, auto-GC with posts, kills the `id:timestamp:bodyLen` string-key construction on every render.

## P5 — Misc

- `tokenSecretsMap` unbounded (OAuth handshakes) → cap/expire entries.
- Document that rate limiting is intentionally disabled (VPN/IP cycling, per user) — but keep the client-side account-fan cap from P3.3 as the politeness bound.
- `.gitignore` `dev-smoke.err`; delete the stray file.
- Lightbox `autoplay` video: add `muted` + `playsinline` (autoplay policy).

## P6 — Browser storage strategy (buckets, OPFS, quota)

Verified status: Storage Buckets API is **Chromium-only** (Chrome/Edge 122+, caniuse; no Firefox/Safari signal). OPFS + Cache Storage + IDB are universal. Bundled TS `lib.dom` has no `storageBuckets` types → add ~20-line ambient `.d.ts`.

1. **Two buckets with different eviction fates** (feature-detect `navigator.storageBuckets`, fallback = today's behavior + existing `persist()`):
   - `app-data`: the Dexie DB (`tmblr-cache-new`: accounts/tokens, settings, post index, cursors) → `open('app-data', { persisted: true, durability: 'strict' })`. This is the irreplaceable data — re-auth and an empty offline index are the real losses. Today `persist()` in `+layout.svelte` is all-or-nothing; under pressure Chrome can wipe the whole origin *including tokens*.
   - `media-cache`: the `tmblr-media` Cache Storage → `open('media-cache', { persisted: false, durability: 'relaxed' })`. Media is re-fetchable; make it the designated sacrifice zone so pressure eviction takes blobs, never credentials.
   - Bucket exposes `.indexedDB` / `.caches` — Dexie accepts an injected `indexedDB` factory; Cache API usage is unchanged (`bucket.caches.open('tmblr-media')` instead of `caches.open`). Buckets work in workers, so the SW can open `media-cache` too.
   - **Refactor cost flagged:** `db` is currently constructed at module load; moving it into a bucket needs an async `initDb()` (awaited in layout before stores hydrate) or a lazy proxy. Do this as its own step, not drive-by.
   - **Migration:** existing installs have data in the default origin space. One-time lazy migration during idle: copy `tmblr-media` keys into the bucket cache (chunked, background), copy IDB via Dexie `export`/table-by-table, then delete the old stores. If migration is interrupted, next run resumes — entries are content-addressed by URL.
2. **OPFS — only for video, not images.** Chrome's own guidance keeps Cache Storage for HTTP resources; images at 500 px variants are small and `cache.put`/`match` is ideal. Videos are the 4 GB-cap risk and where OPFS pays: streaming write (`response.body.pipeTo(writable)`, no full-buffer materialization), cheap `file.size` (vs `(await res.blob()).size`), ~9× faster large writes (100 MB ≈ 90 ms vs ≈ 850 ms IDB; Cache API sits between), random access for serving `Range` requests from the SW. Optional stage: SW serves video URLs from an OPFS file with 206 slicing; IDB keeps the index. Keep Cache Storage for images/posters/avatars regardless.
3. **Byte-aware eviction.** `eviction.ts` evicts by entry count (20k) and only halves on an `estimate()` overrun — a few huge videos defeat it. Store `size` (Content-Length) on `mediaUrls` rows (Dexie v4, alongside P1.7's `base`/`size` columns) and evict by `cachedAt`-ordered running byte total. With OPFS video this becomes exact (`file.size`).
4. **Quota hygiene.** Before "Cache All"/bulk downloads: `estimate()` headroom check (usage + expected > 90 % of quota → run maintenance first, warn); surface `persisted()` state and per-bucket usage on `/caches`. Keep `navigator.storage.persist()` for the fallback path on Firefox/Safari.

## Execution order & verification

Order: P0 → P1.1/P1.2 (pipeline core) → P2 (needs variants) → P1.3–1.7 → P3 → P4 → P6.1 (bucket split + migration) → P6.2–6.4 (OPFS video optional) → P5.
Per phase: `pnpm check` (svelte-check), dev server via `hub start`, browser-tab verification (`browser.open`): feed scroll with cache inspector page + `caches` page stats, offline toggle → media/posts still render, download function e2e (capture blob filename/size in a throwaway page script), multi-account smoke with 2 fake accounts on each page. `parseTumblrMediaUrl` gets unit checks against real `_1280` / `s512x512u_c1` / `s1280x1920` URL shapes. No new dependencies required (zip explicitly out).
