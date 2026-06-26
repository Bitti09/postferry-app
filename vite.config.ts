import tailwindcss from "@tailwindcss/vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import { SvelteKitPWA } from '@vite-pwa/sveltekit';

export default defineConfig({
    plugins: [
        tailwindcss(),
        sveltekit(),
        SvelteKitPWA({
            srcDir: './src',
            mode: 'development',
            strategies: 'generateSW',
            registerType: 'autoUpdate',
            injectRegister: 'auto',
            devOptions: {
                enabled: true,
                type: 'module'
            },
            workbox: {
                globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
                globIgnores: ['**/node_modules/**/*']
            },
            manifest: {
                short_name: 'tmblr',
                name: 'tmblr Offline Reader',
                description: 'Offline-first Tumblr Reader',
                start_url: '/',
                display: 'standalone',
                theme_color: '#000000',
                background_color: '#000000',
                icons: [
                    {
                        src: 'pwa-192x192.png',
                        sizes: '192x192',
                        type: 'image/png',
                        purpose: 'any'
                    },
                    {
                        src: 'pwa-512x512.png',
                        sizes: '512x512',
                        type: 'image/png',
                        purpose: 'any'
                    }
                ],
                screenshots: [
                    {
                        src: 'screenshot-desktop.png',
                        sizes: '1280x720',
                        type: 'image/png',
                        form_factor: 'wide'
                    },
                    {
                        src: 'screenshot-mobile.png',
                        sizes: '750x1334',
                        type: 'image/png'
                    }
                ]
            }
        })
    ],
});