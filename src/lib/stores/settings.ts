import { writable } from "svelte/store";

interface Settings {
    autoCacheMedia: boolean;
    mediaColumns: string;
    blogCardColumns: string;
}

const defaultSettings: Settings = {
    autoCacheMedia: true,
    mediaColumns: 'auto',
    blogCardColumns: 'auto'
};

function createSettingsStore() {
    // Load from local storage if available.
    const stored = typeof window !== 'undefined' ? localStorage.getItem('tmblr_settings') : null;
    let initial: Settings = defaultSettings;

    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            initial = { ...defaultSettings, ...parsed };
        } catch {
            initial = defaultSettings;
        }
    }

    // Migration: older installs persisted autoCacheMedia=false by default.
    // Enable auto-cache by default unless the user explicitly turns it off afterward.
    if (!initial.autoCacheMedia) {
        initial = { ...initial, autoCacheMedia: true };
        if (typeof window !== 'undefined') {
            localStorage.setItem('tmblr_settings', JSON.stringify(initial));
        }
    }

    const { subscribe, set, update } = writable<Settings>(initial);

    return {
        subscribe,
        set: (value: Settings) => {
            if (typeof window !== 'undefined') {
                localStorage.setItem('tmblr_settings', JSON.stringify(value));
            }
            set(value);
        },
        update: (updater: (value: Settings) => Settings) => {
            update((current) => {
                const next = updater(current);
                if (typeof window !== 'undefined') {
                    localStorage.setItem('tmblr_settings', JSON.stringify(next));
                }
                return next;
            });
        }
    };
}

export const settings = createSettingsStore();
