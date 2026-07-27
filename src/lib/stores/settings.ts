// ─── Settings store ─────────────────────────────────────────────────────────

import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import { loadSettings, saveSettings, DEFAULT_SETTINGS, type Settings } from '$lib/cache/meta';

export { DEFAULT_SETTINGS, type Settings };

function createSettingsStore() {
	let ready = false;
	const { subscribe, set, update } = writable<Settings>({ ...DEFAULT_SETTINGS });

	if (browser) {
		void loadSettings()
			.then((loaded) => {
				let next = loaded;
				if (!next.autoCacheMedia) {
					next = { ...next, autoCacheMedia: true };
					void saveSettings(next);
				}
				set(next);
				ready = true;
			})
			.catch(() => {
				ready = true;
			});
	}

	return {
		subscribe,
		set: (value: Settings) => {
			if (browser) void saveSettings(value);
			set(value);
		},
		update: (updater: (value: Settings) => Settings) => {
			update((current) => {
				const next = updater(current);
				if (browser) void saveSettings(next);
				return next;
			});
		},
		isReady(): boolean {
			return ready;
		}
	};
}

export const settings = createSettingsStore();