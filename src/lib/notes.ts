import type { TumblrNote } from 'postferry';

/**
 * Canonical note identity. A single reply, like, reblog or original post
 * event is uniquely identified by blog + timestamp + type. Used by both the
 * IndexedDB merge and the in-memory post page so "load more" cannot duplicate.
 */
export function noteKey(note: Pick<TumblrNote, 'blog_name' | 'timestamp' | 'type'>): string {
	return `${note.blog_name}_${note.timestamp}_${note.type}`;
}

export function dedupeNotes(notes: ReadonlyArray<TumblrNote | null | undefined>): TumblrNote[] {
	const seen = new Set<string>();
	const out: TumblrNote[] = [];
	for (const note of notes) {
		if (!note) continue;
		const key = noteKey(note);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(note);
	}
	return out;
}
