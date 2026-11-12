import type { AccountResult } from 'postferry';

export interface FeedPage<T> {
	items: T[];
	/** Per-account cursors for the next (older) page. Applied unconditionally. */
	cursors?: Record<string, string | number>;
	/** Per-account cursors for newer posts (top-up). Never touches `cursors`. */
	since?: Record<string, string | number>;
	accountResponses?: AccountResult<unknown>[];
}

export interface FeedPartialError {
	accountBlogName: string;
	error?: string;
	status?: number;
}

export interface PagedFeedContext {
	cursors: Record<string, string | number>;
	since: Record<string, string | number>;
	/** True when this request refreshes newer posts; never advance `cursors`. */
	topUp: boolean;
	signal: AbortSignal;
}

export interface PagedFeedOptions<T> {
	loadPage(context: PagedFeedContext): Promise<FeedPage<T>>;
	idOf(item: T): string;
	/** Merge a duplicate item returned by another page. */
	merge?: (current: T, incoming: T) => T;
	/** Stop after this many consecutive non-empty pages with no new ids. */
	maxEmptyPages?: number;
}

export interface FeedSnapshot<T> {
	items: T[];
	cursors: Record<string, string | number>;
	since: Record<string, string | number>;
	hasMore: boolean;
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
}

/**
 * Shared paged-feed controller.
 *
 * Guarantees:
 *  - Only the newest request can commit (monotonic generation).
 *  - Server cursors are applied even when every item was deduplicated, so a
 *    duplicate-only page always moves the feed forward instead of looping.
 *  - Top-up requests merge newer items without resetting the older cursors.
 */
export function createPagedFeed<T>(options: PagedFeedOptions<T>) {
	let items = $state<T[]>([]);
	let cursors = $state<Record<string, string | number>>({});
	let since = $state<Record<string, string | number>>({});
	let loading = $state(false);
	let hasMore = $state(true);
	let error = $state('');
	let partialErrors = $state<FeedPartialError[]>([]);

	let generation = 0;
	let controller: AbortController | null = null;
	let emptyPages = 0;
	let index = new Map<string, number>();
	let destroyed = false;

	function rebuildIndex(): void {
		index = new Map(items.map((item, position) => [options.idOf(item), position]));
	}

	function applyIncoming(incoming: ReadonlyArray<T>, topUp: boolean): number {
		const fresh: T[] = [];
		for (const item of incoming) {
			const id = options.idOf(item);
			const position = index.get(id);
			if (position === undefined) {
				index.set(id, items.length + fresh.length);
				fresh.push(item);
			} else if (options.merge) {
				items[position] = options.merge(items[position]!, item);
			}
		}

		if (fresh.length > 0) {
			items = topUp ? [...fresh, ...items] : [...items, ...fresh];
			rebuildIndex();
		}
		return fresh.length;
	}

	async function load(request: { reset?: boolean; topUp?: boolean } = {}): Promise<void> {
		if (destroyed) return;
		const { reset = false, topUp = false } = request;
		if (loading && !reset && !topUp) return;

		if (reset) {
			controller?.abort();
			items = [];
			index = new Map();
			cursors = {};
			since = {};
			hasMore = true;
			emptyPages = 0;
			error = '';
			partialErrors = [];
		} else if (!topUp && !hasMore) {
			return;
		}

		controller?.abort();
		const abort = new AbortController();
		controller = abort;
		const currentGeneration = ++generation;
		loading = true;

		try {
			const page = await options.loadPage({
				cursors: { ...cursors },
				since: { ...since },
				topUp,
				signal: abort.signal
			});
			if (destroyed || currentGeneration !== generation) return;

			// A refresh must never move the downward cursor, even if the server
			// accidentally returns new offsets.
			if (page.cursors && !topUp) cursors = { ...cursors, ...page.cursors };
			if (page.since) since = { ...since, ...page.since };

			partialErrors = (page.accountResponses ?? [])
				.filter((result) => !result.ok)
				.map((result) => ({
					accountBlogName: result.accountBlogName,
					error: result.error,
					status: result.status
				}));

			const incoming = page.items ?? [];
			const freshCount = applyIncoming(incoming, topUp);

			if (topUp) {
				// A top-up never ends the feed.
			} else if (incoming.length === 0) {
				hasMore = false;
				emptyPages = 0;
			} else if (freshCount === 0) {
				emptyPages++;
				if (emptyPages >= (options.maxEmptyPages ?? 2)) hasMore = false;
			} else {
				emptyPages = 0;
			}
		} catch (caught) {
			if (isAbortError(caught)) return;
			if (destroyed || currentGeneration !== generation) return;
			error = caught instanceof Error ? caught.message : String(caught);
		} finally {
			if (currentGeneration === generation) loading = false;
		}
	}

	function snapshot(): FeedSnapshot<T> {
		return $state.snapshot({ items, cursors, since, hasMore }) as FeedSnapshot<T>;
	}

	function restore(value: FeedSnapshot<T> | undefined | null): void {
		if (!value) return;
		generation++;
		controller?.abort();
		items = Array.isArray(value.items) ? value.items : [];
		cursors = value.cursors ?? {};
		since = value.since ?? {};
		hasMore = value.hasMore ?? true;
		loading = false;
		error = '';
		partialErrors = [];
		emptyPages = 0;
		rebuildIndex();
	}

	function destroy(): void {
		destroyed = true;
		controller?.abort();
	}

	return {
		get items(): T[] {
			return items;
		},
		get cursors(): Record<string, string | number> {
			return cursors;
		},
		get since(): Record<string, string | number> {
			return since;
		},
		get loading(): boolean {
			return loading;
		},
		get hasMore(): boolean {
			return hasMore;
		},
		get error(): string {
			return error;
		},
		get partialErrors(): FeedPartialError[] {
			return partialErrors;
		},
		loadMore: () => load(),
		reset: () => load({ reset: true }),
		refresh: () => load({ topUp: true }),
		load,
		snapshot,
		restore,
		destroy
	};
}
