/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

import { immutable, assets } from '$app/manifest';
import { dev, version } from '$app/env';
import { self } from '$app/service-worker';
import {
	readMediaFile,
	writeMediaFile,
	deleteMediaFile,
	mediaContentType
} from '../lib/mediaFiles';

const sw = self;

/* ─── app shell: OPFS, never Cache Storage ────────────────────────────────── */

const APP_DIR = 'app';
const APP_VERSION = version;

// `$app/manifest` paths are relative to the base path. Resolving them against
// the service worker's own directory (which sits at the base) yields the
// absolute pathnames the fetch handler compares against.
const BASE_URL = new URL('.', self.location.href);
const ASSETS = [
	...immutable.map((entry) => new URL(entry.path, BASE_URL).pathname), // Vite output
	...assets.map((entry) => new URL(entry.path, BASE_URL).pathname) // `static`
];

const ASSET_PATHS = new Set<string>(ASSETS);

const SHELL_FILE = '__shell.html';

function appFileName(pathname: string): string {
	return encodeURIComponent(pathname);
}

async function appRoot(create: boolean): Promise<FileSystemDirectoryHandle | null> {
	try {
		const root = await self.navigator.storage.getDirectory();
		return await root.getDirectoryHandle(APP_DIR, { create });
	} catch {
		return null;
	}
}

async function appDir(create: boolean): Promise<FileSystemDirectoryHandle | null> {
	const root = await appRoot(create);
	if (!root) return null;
	try {
		return await root.getDirectoryHandle(APP_VERSION, { create });
	} catch {
		return null;
	}
}

async function writeAppFile(pathname: string, response: Response): Promise<boolean> {
	const dir = await appDir(true);
	if (!dir) return false;
	try {
		const handle = await dir.getFileHandle(appFileName(pathname), { create: true });
		const writable = await handle.createWritable();
		await response.body!.pipeTo(writable);
		return true;
	} catch {
		return false;
	}
}

async function readAppFile(pathname: string): Promise<File | null> {
	const dir = await appDir(false);
	if (!dir) return null;
	try {
		const handle = await dir.getFileHandle(appFileName(pathname));
		const file = await handle.getFile();
		return file.size > 0 ? file : null;
	} catch {
		return null;
	}
}

const SHELL_TYPES: Record<string, string> = {
	js: 'text/javascript',
	mjs: 'text/javascript',
	css: 'text/css',
	html: 'text/html',
	json: 'application/json',
	webmanifest: 'application/manifest+json',
	svg: 'image/svg+xml',
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
	ico: 'image/x-icon',
	woff: 'font/woff',
	woff2: 'font/woff2',
	txt: 'text/plain'
};

function shellType(pathname: string): string {
	const match = pathname.match(/\.([a-zA-Z0-9]+)$/);
	return (match && SHELL_TYPES[match[1].toLowerCase()]) || 'application/octet-stream';
}

function fileResponse(file: File, type: string): Response {
	return new Response(file, {
		status: 200,
		headers: {
			'Content-Type': type,
			'Content-Length': String(file.size)
		}
	});
}

async function precacheShell(): Promise<void> {
	const dir = await appDir(true);
	if (!dir) return;

	await Promise.allSettled(
		ASSETS.map(async (path) => {
			const absolute = new URL(path, self.location.origin);
			const response = await fetch(absolute, { credentials: 'same-origin' });
			if (response.ok) await writeAppFile(absolute.pathname, response.clone());
		})
	);

	// One HTML shell powers every navigation when the network is gone.
	try {
		const shell = await fetch(new URL('/', self.location.origin), { credentials: 'same-origin' });
		if (shell.ok) {
			const dirHandle = await dir.getFileHandle(SHELL_FILE, { create: true });
			const writable = await dirHandle.createWritable();
			await shell.body!.pipeTo(writable);
		}
	} catch {
		// network unavailable during install; retried on the first navigation
	}
}

sw.addEventListener('install', (event) => {
	if (dev) {
		// Dev assets come from /@fs and /@vite; never precache them.
		event.waitUntil(sw.skipWaiting());
		return;
	}
	event.waitUntil(
		(async () => {
			await precacheShell();
			await sw.skipWaiting();
		})()
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			// Drop app-shell files/directories from older builds.
			const root = await appRoot(false);
			if (root) {
				for await (const [name, handle] of root.entries()) {
					if (name === APP_VERSION) continue;
					await root.removeEntry(name, { recursive: true }).catch(() => {});
				}
			}
			await sw.clients.claim();
		})()
	);
});

/* ─── fetch ──────────────────────────────────────────────────────────────── */

sw.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') return;

	const url = new URL(event.request.url);
	if (!url.protocol.startsWith('http')) return;

	// Cross-origin passes through untouched.
	if (url.origin !== self.location.origin) return;

	async function respond(): Promise<Response> {
		if (url.pathname.startsWith('/api/media/proxy')) {
			const targetUrl = url.searchParams.get('url');
			if (targetUrl) return respondWithMedia(targetUrl, event.request);
		}

		// API responses live in IndexedDB, not here.
		if (url.pathname.startsWith('/api/')) {
			try {
				return await fetch(event.request);
			} catch {
				return new Response('', { status: 504, statusText: 'Offline' });
			}
		}

		if (event.request.mode === 'navigate') {
			try {
				const response = await fetch(event.request);
				if (response.ok) {
					const shellDir = await appDir(true);
					if (shellDir) {
						const html = response.clone();
						const handle = await shellDir.getFileHandle(SHELL_FILE, { create: true });
						const writable = await handle.createWritable();
						await html.body!.pipeTo(writable).catch(() => {});
					}
				}
				return response;
			} catch {
				const shell = await readAppFile(SHELL_FILE);
				if (shell) return fileResponse(shell, 'text/html');
				return new Response('', { status: 504, statusText: 'Offline' });
			}
		}

		// Built assets and static files.
		if (ASSET_PATHS.has(url.pathname)) {
			const cached = await readAppFile(url.pathname);
			if (cached) return fileResponse(cached, shellType(url.pathname));
			try {
				const response = await fetch(event.request);
				if (response.ok) await writeAppFile(url.pathname, response.clone());
				return response;
			} catch {
				return new Response('', { status: 504, statusText: 'Offline' });
			}
		}

		try {
			return await fetch(event.request);
		} catch {
			const cached = await readAppFile(url.pathname);
			if (cached) return fileResponse(cached, shellType(url.pathname));
			return new Response('', { status: 504, statusText: 'Offline' });
		}
	}

	event.respondWith(respond());
});

/* ─── media ──────────────────────────────────────────────────────────────── */

function parseRangeHeader(header: string | null, size: number): { start: number; end: number } | null {
	if (!header) return null;
	const match = header.match(/^bytes=(\d*)-(\d*)$/);
	if (!match) return null;
	const [, rawStart, rawEnd] = match;
	let start: number;
	let end: number;
	if (rawStart === '') {
		const n = parseInt(rawEnd, 10);
		if (!Number.isFinite(n) || n <= 0) return null;
		start = Math.max(0, size - n);
		end = size - 1;
	} else {
		start = parseInt(rawStart, 10);
		end = rawEnd === '' ? size - 1 : Math.min(parseInt(rawEnd, 10), size - 1);
	}
	if (!Number.isFinite(start) || start > end || start >= size) return null;
	return { start, end };
}

async function serveMediaFromOpfs(
	targetUrl: string,
	rangeHeader: string | null
): Promise<Response | null> {
	const file = await readMediaFile(targetUrl);
	if (!file) return null;
	const type = mediaContentType(targetUrl);
	const range = parseRangeHeader(rangeHeader, file.size);
	if (range) {
		const slice = file.slice(range.start, range.end + 1);
		return new Response(slice, {
			status: 206,
			headers: {
				'Content-Type': type,
				'Content-Length': String(range.end - range.start + 1),
				'Content-Range': `bytes ${range.start}-${range.end}/${file.size}`,
				'Accept-Ranges': 'bytes'
			}
		});
	}
	return new Response(file, {
		status: 200,
		headers: {
			'Content-Type': type,
			'Content-Length': String(file.size),
			'Accept-Ranges': 'bytes'
		}
	});
}

async function respondWithMedia(targetUrl: string, request: Request): Promise<Response> {
	const rangeHeader = request.headers.get('range');
	const cached = await serveMediaFromOpfs(targetUrl, rangeHeader);
	if (cached) return cached;

	// Range requests on a miss must not be answered with a partial body.
	if (rangeHeader) {
		try {
			return await fetch(request);
		} catch {
			return new Response('', { status: 504, statusText: 'Offline' });
		}
	}

	const { response, status } = await fetchMediaWithFallback(targetUrl);
	if (response && response.ok) {
		const type = response.headers.get('content-type') || mediaContentType(targetUrl);
		const stored = await writeMediaFile(targetUrl, response.clone());
		const size = Number(response.headers.get('content-length') || 0);
		await broadcastToClients({
			type: 'MEDIA_CACHED',
			url: targetUrl,
			mimeType: type,
			size: Number.isFinite(size) ? size : 0
		});
		if (stored) {
			const fromDisk = await serveMediaFromOpfs(targetUrl, null);
			if (fromDisk) return fromDisk;
		}
		return response;
	}

	if (response) return response;
	return new Response('', {
		status: status ?? 504,
		statusText: status ? String(status) : 'Offline'
	});
}

async function fetchMediaWithFallback(
	targetUrl: string,
	rangeRequest?: Request
): Promise<{ response: Response | null; status: number | null }> {
	if (!rangeRequest) {
		try {
			const direct = await fetch(targetUrl, { credentials: 'omit' });
			if (direct.ok) return { response: direct, status: null };
			return { response: direct, status: direct.status };
		} catch {
			// fall through to the same-origin proxy
		}
	}
	try {
		const proxied = await fetch(
			rangeRequest ?? `/api/media/proxy?url=${encodeURIComponent(targetUrl)}`
		);
		return proxied.ok
			? { response: proxied, status: null }
			: { response: proxied, status: proxied.status };
	} catch {
		return { response: null, status: null };
	}
}

async function broadcastToClients(msg: Record<string, unknown>): Promise<void> {
	const allClients = await sw.clients.matchAll();
	for (const client of allClients) client.postMessage(msg);
}

/* ─── messages ───────────────────────────────────────────────────────────── */

sw.addEventListener('message', (event) => {
	const data = event.data as { type?: string; url?: string; urls?: string[] } | null;
	if (!data) return;

	if (data.type === 'CACHE_MEDIA' && data.url) {
		const targetUrl = data.url;
		event.waitUntil(
			(async () => {
				try {
					if (await readMediaFile(targetUrl)) {
						await broadcastToClients({
							type: 'MEDIA_CACHED',
							url: targetUrl,
							mimeType: mediaContentType(targetUrl),
							size: 0
						});
						return;
					}

					const { response, status } = await fetchMediaWithFallback(targetUrl);
					if (response && response.ok) {
						const type = response.headers.get('content-type') || mediaContentType(targetUrl);
						await writeMediaFile(targetUrl, response.clone());
						const size = Number(response.headers.get('content-length') || 0);
						await broadcastToClients({
							type: 'MEDIA_CACHED',
							url: targetUrl,
							mimeType: type,
							size: Number.isFinite(size) ? size : 0
						});
					} else {
						await broadcastToClients({
							type: 'MEDIA_CACHE_ERROR',
							url: targetUrl,
							error: status ? `HTTP ${status}` : 'unreachable'
						});
					}
				} catch (err) {
					await broadcastToClients({
						type: 'MEDIA_CACHE_ERROR',
						url: targetUrl,
						error: String(err)
					});
				}
			})()
		);
		return;
	}

	if (data.type === 'DROP_MEDIA' && Array.isArray(data.urls)) {
		event.waitUntil(
			(async () => {
				for (const url of data.urls ?? []) await deleteMediaFile(url);
			})()
		);
	}
});
