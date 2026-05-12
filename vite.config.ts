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
                start_url: '/',
                display: 'standalone',
                theme_color: '#000000',
                background_color: '#000000',
                icons: [
                    {
                        src: 'pwa-192x192.png',
                        sizes: '192x192',
                        type: 'image/png'
                    },
                    {
                        src: 'pwa-512x512.png',
                        sizes: '512x512',
                        type: 'image/png'
                    }
                ]
            }
        })
    ],
});