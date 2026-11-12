import { defineEnvVars } from '@sveltejs/kit/env';

/**
 * SvelteKit 3 reads environment variables from this explicit declaration.
 * `static: true` inlines the build-time value; `public` stays false so the
 * Tumblr credentials remain server-only.
 */
export const variables = defineEnvVars({
	TUMBLR_CONSUMER_KEY: {
		static: true,
		description: 'Tumblr OAuth consumer key'
	},
	TUMBLR_CONSUMER_SECRET: {
		static: true,
		description: 'Tumblr OAuth consumer secret'
	},
	TUMBLR_CALLBACK_URL: {
		static: false,
		// Optional: when unset, the request's forwarded scheme/host is used.
		schema: (value: string | undefined) => value ?? '',
		description:
			'Callback URL registered on the Tumblr app, used verbatim for oauth_callback'
	}
});
