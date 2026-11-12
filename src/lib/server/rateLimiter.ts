import { TumblrApiError } from 'postferry';

/**
 * Server-side quota enforcement for outbound Tumblr API calls.
 *
 * The documented consumer-key limits are 1,000 calls/hour and 5,000/day; the
 * per-IP limit is 300/minute. This server has one consumer key, so it enforces
 * all three windows. A call is rejected locally with a 429 before it reaches
 * Tumblr instead of relying on Tumblr to stop us.
 *
 * Action limits (likes, follows, posts) are per blog/user and use a rolling
 * 24-hour window.
 */
const MINUTE = 60_000;
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

const GENERAL_LIMITS = [
	{ windowMs: MINUTE, max: 300 },
	{ windowMs: HOUR, max: 1_000 },
	{ windowMs: DAY, max: 5_000 }
] as const;

const ACTION_LIMITS: Record<Action, { windowMs: number; max: number }> = {
	likes: { windowMs: DAY, max: 1_000 },
	follows: { windowMs: DAY, max: 200 },
	posts: { windowMs: DAY, max: 250 }
};

export type Action = 'likes' | 'follows' | 'posts';

export class RateLimitError extends TumblrApiError {
	readonly retryAfterMs: number;

	constructor(message: string, retryAfterMs: number) {
		super(message, { status: 429 });
		this.name = 'RateLimitError';
		this.retryAfterMs = retryAfterMs;
	}
}

const generalTimestamps: number[] = [];
const actionTimestamps = new Map<string, number[]>();

function prune(timestamps: number[], now: number, windowMs: number): void {
	const cutoff = now - windowMs;
	let drop = 0;
	while (drop < timestamps.length && timestamps[drop]! < cutoff) drop++;
	if (drop > 0) timestamps.splice(0, drop);
}

function retryDelay(timestamps: number[], now: number, windowMs: number): number {
	const cutoff = now - windowMs;
	const oldest = timestamps.find((timestamp) => timestamp >= cutoff);
	return oldest !== undefined ? Math.max(0, oldest + windowMs - now) : windowMs;
}

/**
 * Reserve one general API call. Throws `RateLimitError` when any window is
 * exhausted; callers should surface it as a 429 rather than retrying blindly.
 */
export function checkRateLimit(): void {
	const now = Date.now();
	// One shared array, pruned only by the longest window; shorter windows are
	// counted with a filter so pruning for one minute cannot erase the day.
	prune(generalTimestamps, now, DAY);
	for (const limit of GENERAL_LIMITS) {
		const count = generalTimestamps.filter((timestamp) => timestamp >= now - limit.windowMs).length;
		if (count >= limit.max) {
			const wait = retryDelay(generalTimestamps, now, limit.windowMs);
			throw new RateLimitError(
				`Tumblr API rate limit reached (${limit.max} per ${limit.windowMs / 60_000} minutes). Retry in ${Math.ceil(wait / 1000)}s.`,
				wait
			);
		}
	}
	generalTimestamps.push(now);
}

/** Reserve one user action against the per-blog daily limits. */
export function checkActionLimit(action: Action, blogName: string): void {
	const limit = ACTION_LIMITS[action];
	const key = `${action}:${blogName}`;
	const timestamps = actionTimestamps.get(key) ?? [];
	const now = Date.now();
	prune(timestamps, now, limit.windowMs);

	if (timestamps.length >= limit.max) {
		const wait = retryDelay(timestamps, now, limit.windowMs);
		throw new RateLimitError(
			`Tumblr ${action} limit reached for ${blogName} (${limit.max} per day). Retry in ${Math.ceil(wait / 1000)}s.`,
			wait
		);
	}

	timestamps.push(now);
	actionTimestamps.set(key, timestamps);
}
