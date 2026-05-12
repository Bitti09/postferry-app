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
// For a single instance, an in-memory Map is fine.
export const tokenSecretsMap = new Map<string, string>();
