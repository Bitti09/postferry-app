/**
 * fetch() wrapper that always settles. A hung request must never leave a page
 * spinner spinning forever; the caller sees a TimeoutError instead.
 */
export async function fetchWithTimeout(
	url: string,
	init: RequestInit = {},
	timeoutMs = 45_000
): Promise<Response> {
	const external = init.signal;
	const controller = new AbortController();
	const timer = setTimeout(() => {
		controller.abort(new DOMException('Request timed out', 'TimeoutError'));
	}, timeoutMs);

	const onAbort = () => controller.abort(external?.reason);
	if (external?.aborted) controller.abort(external.reason);
	external?.addEventListener('abort', onAbort, { once: true });

	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timer);
		external?.removeEventListener('abort', onAbort);
	}
}
