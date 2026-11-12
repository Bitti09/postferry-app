# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project
npx sv create my-app
```

To recreate this project with the same configuration:

```sh
# recreate this project
npx sv@0.15.1 create --template minimal --types ts --add tailwindcss="plugins:typography" --install npm .
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.


## API library (`postferry`)

`postferry` is an unofficial, standalone, zero-runtime-dependency client for
the Tumblr API v2 and NPF. It lives in its own repository and is installed as
a GitHub dependency:

- Repository: <https://github.com/Bitti09/postferry>
- Package: `postferry`
- License and disclaimer: see that repository's `README.md` and `LICENSE`.

- Typed endpoints and NPF/legacy post types.
- OAuth 1.0a (WebCrypto HMAC-SHA1), API-key and OAuth 2.0 bearer auth.
- Correct pagination per endpoint (`offset`/`since_id` for the dashboard,
  `before` timestamps for posts/likes/tagged, `/notes` for note pages).
- Retries with `Retry-After`, bounded multi-account fan-out, and feed merging
  that preserves per-account `likedBy`/`rebloggedBy`/`sources`.

```sh
pnpm install
pnpm check   # app typecheck
pnpm build   # app build
```

The package's own tests and build live in the `postferry` repository. The app
has no local copy of the API package.
