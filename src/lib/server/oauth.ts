import OAuth from 'oauth-1.0a';
import crypto from 'crypto';
import { TUMBLR_CONSUMER_KEY, TUMBLR_CONSUMER_SECRET } from '$env/static/private';

export const oauth = new OAuth({
	consumer: {
		key: TUMBLR_CONSUMER_KEY,
		secret: TUMBLR_CONSUMER_SECRET
	},
	signature_method: 'HMAC-SHA1',
	hash_function(base_string, key) {
		return crypto.createHmac('sha1', key).update(base_string).digest('base64');
	}
});

// A Map to store oauth_token_secret temporarily between redirect and callback.
// In production with multiple instances, you'd use Redis or a database.
// For a single instance, an in-memory Map is fine. Capped + expired so
// abandoned handshakes can't grow it without bound.
export const tokenSecretsMap = new Map<string, string>();
const TOKEN_SECRET_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_SECRETS = 100;
const secretInsertedAt = new Map<string, number>();

export function rememberTokenSecret(token: string, secret: string): void {
	while (secretInsertedAt.size >= MAX_PENDING_SECRETS) {
		const oldest = secretInsertedAt.keys().next().value;
		if (oldest === undefined) break;
		secretInsertedAt.delete(oldest);
		tokenSecretsMap.delete(oldest);
	}
	tokenSecretsMap.set(token, secret);
	secretInsertedAt.set(token, Date.now());
}

export function takeTokenSecret(token: string): string | undefined {
	const insertedAt = secretInsertedAt.get(token);
	if (insertedAt !== undefined && Date.now() - insertedAt > TOKEN_SECRET_TTL_MS) {
		secretInsertedAt.delete(token);
		tokenSecretsMap.delete(token);
		return undefined;
	}
	secretInsertedAt.delete(token);
	return tokenSecretsMap.get(token);
}
