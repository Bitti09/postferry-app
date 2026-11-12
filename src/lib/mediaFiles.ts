/**
 * Media blob storage on the Origin Private File System.
 *
 * Nothing media-related goes into Cache Storage: OPFS is a real file system,
 * readable from both the window and the service worker, and it can serve
 * byte-accurate Range requests for video. File names are a deterministic hash
 * of the URL, so the page and the SW always agree without an index round-trip.
 */

export const MEDIA_DIR = 'media';

const EXT_TYPES: Record<string, string> = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	svg: 'image/svg+xml',
	mp4: 'video/mp4',
	webm: 'video/webm',
	mov: 'video/quicktime',
	m4v: 'video/mp4',
	mp3: 'audio/mpeg',
	m4a: 'audio/mp4',
	ogg: 'audio/ogg',
	oga: 'audio/ogg',
	wav: 'audio/wav',
};

function extensionOf(url: string): string {
	const clean = url.split('#')[0].split('?')[0];
	const match = clean.match(/\.([a-zA-Z0-9]{1,5})$/);
	return match ? match[1].toLowerCase() : 'bin';
}

/** Deterministic, filesystem-safe file name for a media URL. */
export function mediaFileName(url: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < url.length; i++) {
		hash ^= url.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return `${(hash >>> 0).toString(16).padStart(8, '0')}.${extensionOf(url)}`;
}

export function mediaContentType(url: string): string {
	return EXT_TYPES[extensionOf(url)] ?? 'application/octet-stream';
}

async function root(): Promise<FileSystemDirectoryHandle | null> {
	try {
		if (!navigator.storage?.getDirectory) return null;
		return await navigator.storage.getDirectory();
	} catch {
		return null;
	}
}

async function mediaDir(create: boolean): Promise<FileSystemDirectoryHandle | null> {
	const base = await root();
	if (!base) return null;
	try {
		return await base.getDirectoryHandle(MEDIA_DIR, { create });
	} catch {
		return null;
	}
}

/** Read a cached media file, or null when it is not on disk. */
export async function readMediaFile(url: string): Promise<File | null> {
	const dir = await mediaDir(false);
	if (!dir) return null;
	try {
		const handle = await dir.getFileHandle(mediaFileName(url));
		const file = await handle.getFile();
		return file.size > 0 ? file : null;
	} catch {
		return null;
	}
}

/**
 * Persist a fetched response body as a media file. Streams where the runtime
 * supports it; `createSyncAccessHandle` is the fast path in workers.
 */
export async function writeMediaFile(url: string, response: Response): Promise<boolean> {
	const dir = await mediaDir(true);
	if (!dir || !response.body) return false;
	const handle = await dir.getFileHandle(mediaFileName(url), { create: true });

	const syncHandle = handle as unknown as {
		createSyncAccessHandle?: () => Promise<{
			truncate(size: number): void;
			write(buffer: ArrayBuffer, options?: { at?: number }): number;
			flush(): void;
			close(): void;
		}>;
	};
	if (typeof syncHandle.createSyncAccessHandle === 'function') {
		const access = await syncHandle.createSyncAccessHandle();
		try {
			const buffer = await response.arrayBuffer();
			access.truncate(0);
			access.write(buffer, { at: 0 });
			access.flush();
		} finally {
			access.close();
		}
		return true;
	}

	try {
		const writable = await handle.createWritable();
		await response.body.pipeTo(writable);
		return true;
	} catch {
		return false;
	}
}

export async function deleteMediaFile(url: string): Promise<boolean> {
	const dir = await mediaDir(false);
	if (!dir) return false;
	try {
		await dir.removeEntry(mediaFileName(url));
		return true;
	} catch {
		return false;
	}
}

export interface StoredMediaFile {
	name: string;
	size: number;
}

export async function listMediaFiles(): Promise<StoredMediaFile[]> {
	const dir = await mediaDir(false);
	if (!dir) return [];
	const out: StoredMediaFile[] = [];
	try {
		for await (const [name, handle] of dir.entries()) {
			if (handle.kind !== 'file') continue;
			const file = await (handle as FileSystemFileHandle).getFile();
			out.push({ name, size: file.size });
		}
	} catch {
		// directory unavailable or iteration interrupted
	}
	return out;
}

export async function clearMediaFiles(): Promise<void> {
	const dir = await mediaDir(false);
	if (!dir) return;
	const names: string[] = [];
	for await (const [name, handle] of dir.entries()) {
		if (handle.kind === 'file') names.push(name);
	}
	await Promise.allSettled(names.map((name) => dir.removeEntry(name)));
}
