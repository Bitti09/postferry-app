# Postferry

A multi-account Tumblr feed viewer and offline media library built with
SvelteKit 5. It is an unofficial, specialized reader — not a replacement for
Tumblr's dashboard.

It shows each connected account’s feed and likes in a separate tab, in the
exact order the API returned them, renders posts and notes, and keeps media
available offline through a service worker, IndexedDB, and the Origin Private
File System (OPFS).

## ⚠️ Notice ⚠️

---

This application is **NOT** official, endorsed, sponsored by, or otherwise
associated with Tumblr in any way, shape, or form.

It was built using the API reference documents, and like any other project
built using the API (including those made using this app) should conform to the
[Tumblr Application Developer and API License
Agreement](https://www.tumblr.com/docs/api_agreement). Be sure you also follow
it.

## Features

- **Per-account streams** for any number of active accounts, with a scrollable
  account tab bar. Each tab preserves its API order; there is no cross-account
  sort, merge, or dedupe.
- **Likes, following, blog posts, blog likes, tag search, and post detail**
  pages, with filters for text, photo, video, audio, quote, link, chat, and
  asks.
- **Offline media cache**: images and video are stored in OPFS with an
  IndexedDB index, served through the service worker (including byte ranges
  for video), and evicted by a size/entry LRU cap.
- **Installable PWA** with an app-shell cache and an offline post view.
- **Virtualized grid** and slideshow for large libraries.
- **OAuth 1.0a sign-in** for multiple Tumblr accounts; tokens stay in the
  browser and every Tumblr API call is proxied through server routes.
- **No Tumblr-specific code in the UI layer**: all API access goes through the
  separate [`postferry`](https://github.com/Bitti09/postferry) package.

## Tech stack

- SvelteKit 3 with Svelte 5 runes, TypeScript, Vite
- Tailwind CSS 4 + daisyUI
- Dexie (IndexedDB) for posts, accounts, settings, and the media index
- OPFS for media blobs; service worker for the app shell and offline reads
- [`postferry`](https://github.com/Bitti09/postferry) for the Tumblr API v2 and
  NPF client

## Requirements

- Node.js 22 or newer (developed on Node 24)
- pnpm 12 or newer
- A Tumblr OAuth application
  ([register one](https://www.tumblr.com/oauth/apps))
- Read access to the private `Bitti09/postferry` GitHub repository, because the
  package is installed as a git dependency

## Getting started

```sh
git clone git@github.com:Bitti09/postferry-app.git
cd postferry-app
pnpm install
cp .env.example .env
```

Fill in the three values in `.env`:

| Variable | Description |
| --- | --- |
| `TUMBLR_CONSUMER_KEY` | OAuth consumer key from your Tumblr app |
| `TUMBLR_CONSUMER_SECRET` | OAuth consumer secret |
| `TUMBLR_CALLBACK_URL` | The callback URL registered on the Tumblr app, exactly (scheme, host, path). For local development this is usually a tunnel such as `https://your-tunnel.example.com/api/auth/callback`; for production use `https://your-domain/api/auth/callback`. If unset, the app falls back to the request's forwarded scheme/host, which Tumblr will reject unless that URL is registered verbatim. |

Start the dev server:

```sh
pnpm dev
# open http://localhost:5173
```

If you develop through a tunnel or a custom hostname, allow it explicitly
instead of hard-coding it in `vite.config.ts`:

```sh
VITE_ALLOWED_HOSTS=your-tunnel.example.com pnpm dev
```

Then use **Add Account** on the feed to complete the OAuth flow.

## Scripts

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start Vite in development mode |
| `pnpm build` | Production build (client, server, and service worker) |
| `pnpm preview` | Preview the production build |
| `pnpm check` | `svelte-check` over the app |
| `pnpm check:watch` | Typecheck in watch mode |
| `pnpm prepare` | Regenerate SvelteKit types |

The `postferry` package has its own test suite and build commands in its
repository; the app has no local copy of that package.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Per-account feed tabs with filters, slideshow, and bulk media caching |
| `/likes` | Per-account likes tabs, each in API order |
| `/following` | Blogs followed by each account |
| `/accounts` | Connected accounts, activation, account info, and favourites caching |
| `/search` | Tumblr tag search |
| `/caches` | Offline media library, storage usage, filters, and cache clearing |
| `/settings` | Layout, caching, and display preferences |
| `/blog/[blogName]` | A blog's posts |
| `/blog/[blogName]/likes` | A blog's public likes |
| `/post/[blogName]/[postId]` | Post detail, trail, notes, likes, and offline media |
| `/debug-cache`, `/debug-upscaler` | Development-only diagnostics |

Server routes live under `src/routes/api/` and cover auth, per-account feeds, likes,
posts, blog info/posts/likes, following, user info, search, avatar proxying,
and media proxying.

## How it works

### API access

The browser sends the serialized account credentials with each API request.
The server routes validate the payload, call Tumblr through `postferry`, and
return normalized data. Every outbound request is checked against the
documented API quotas (300/minute, 1,000/hour, 5,000/day) and the per-user
like/reblog limits; once a window is exhausted the server rejects further
calls locally with a 429 instead of hammering Tumblr. OAuth request/access token exchanges happen in
`src/routes/api/auth/` and are also handled by `postferry`. No Tumblr API call
is made directly by the browser.

### Per-account streams

The dashboard and likes endpoints return one group per account, in the order
Tumblr returned that account’s posts. The client never sorts, deduplicates, or
interleaves across accounts. Each tab keeps its own cursor and lazy-loads only
when selected, so ten or more accounts do not fan out into a single burst.

Posts are still keyed by `id_string`, never the lossy numeric `id`, and cached
entries carry per-account `likedBy`/`rebloggedBy` plus a stable `cachedAt` and a
separate `updatedAt`.

### Offline cache

- Posts and metadata: a Dexie database in the persistent `postferry-data`
  storage bucket (or origin IndexedDB when buckets are unavailable).
- Media: OPFS directory `media`, keyed by a deterministic hash of the URL.
- App shell and navigation: service worker with an OPFS app directory.
- Startup cleanup: legacy database, cache, bucket, and localStorage names are
  deleted on first load. Only `postferry-*` storage is kept; pre-rename local
  data is intentionally discarded.
- Eviction: oldest media is removed first, capped at 20,000 entries / 4 GB,
  with a stricter byte cap when the browser reports pressure.
- Media URLs are recorded in `mediaUrls` so a post's blobs can be found without
  re-parsing content.

### Offline behavior

Feeds require the network. The cached library (`/caches`), cached post detail,
and cached media remain available offline. Use **Clear Cache** on `/caches` to
delete posts and media, or remove an account from `/accounts`.

## Data and privacy

- Account tokens and cached posts are stored in the browser's IndexedDB; media
  blobs are stored in OPFS. There is no application database or server-side
  session store.
- Tokens are sent to the app's own server routes so those routes can call
  Tumblr on your behalf. Do not deploy this app on a host you do not trust.
- Clearing site data or using **Clear Cache** removes local data. Uninstalling
  the PWA may leave the origin's storage in place until the browser clears it.
- The app requests persistent storage when available. Browsers decide whether
  to grant it.

## Deployment

The project uses `@sveltejs/adapter-auto`. Install the adapter for your target
(Node, Vercel, Netlify, Cloudflare, etc.) before deploying.

Set `TUMBLR_CONSUMER_KEY`, `TUMBLR_CONSUMER_SECRET`, and
`TUMBLR_CALLBACK_URL` in the hosting environment. The callback URL must match
the Tumblr application configuration exactly. Serve over HTTPS so the service
worker and OAuth callback work correctly.

## Checks and build

```sh
pnpm check
pnpm build
```

There is no app-level test runner; the API package is tested in
[`Bitti09/postferry`](https://github.com/Bitti09/postferry).

## API client

The Tumblr client is maintained separately as
[`postferry`](https://github.com/Bitti09/postferry). It provides typed methods
for the documented v2 endpoints, OAuth 1.0a/OAuth 2.0, NPF and legacy post
types, retries, multi-account fan-out, and feed merging. See its
`API-COVERAGE.md` for the endpoint and NPF coverage map.

## Personal use

This project is intended for **personal, local, single-user use**:

- Run it on your own machine and connect your own accounts with your own
  registered Tumblr application credentials.
- There is no public hosted instance maintained by this project. Each user runs
  their own copy.
- Personal/local use lowers exposure; it does **not** exempt you from Tumblr's
  terms or the Application Developer and API License Agreement.
- The offline library is a personal-use feature that may not satisfy the
  agreement’s three-day caching rules. The dashboard and likes views keep each
  account in API order; if you add a combined cross-account stream, seek written
  permission from Tumblr before deploying it.
- If you expose the app to other people, you are operating a Licensee
  Application and are responsible for the agreement's caching, attribution,
  privacy, and content-ordering requirements.

The software is provided as-is, without warranty. Use it at your own risk.

## Legal

This application is **not** official, endorsed, sponsored by, or otherwise
associated with Tumblr in any way, shape, or form.

It was built using the API reference documents, and like any other project
built using the API (including those made using this app) should conform to the
[Tumblr Application Developer and API License
Agreement](https://www.tumblr.com/docs/api_agreement). Be sure you also follow
it.

“Tumblr” and the Tumblr logo are trademarks of Tumblr, Inc. They are used here
only to describe API compatibility and do not imply endorsement. Do not use
this project's name or branding to suggest an official Tumblr product.

## License

Copyright (C) 2026 Bitti09.

This application is licensed under the **GNU Affero General Public License,
version 3 only** (`AGPL-3.0-only`). The full text is in [LICENSE](./LICENSE).

The AGPL treats network use as distribution: if you run a modified version and
let other people interact with it over a network, you must offer those users
the corresponding source code under the AGPL. If you deploy this app publicly,
make the source available from the deployed version or alongside it.

The separate [`postferry`](https://github.com/Bitti09/postferry) package remains
MIT-licensed and is compatible with this application's AGPL license. Its
copyright and license notices must be preserved when redistributing the app.
