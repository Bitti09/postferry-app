import { writable } from "svelte/store";

interface Settings {
    autoCacheMedia: boolean;
    mediaColumns: string;
    blogCardColumns: string;
}

const defaultSettings: Settings = {
    autoCacheMedia: false,
    mediaColumns: 'auto',
    blogCardColumns: 'auto'
};

function createSettingsStore() {
    // Load from local storage if available
    const stored = typeof window !== 'undefined' ? localStorage.getItem('tmblr_settings') : null;
    const initial = stored ? { ...defaultSettings, ...JSON.parse(stored) } : defaultSettings;

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
