import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	server: {
		// Comma-separated hostnames for tunnels/dev domains, e.g.
		// VITE_ALLOWED_HOSTS=your-dev-host.example.com,preview.example.com
		allowedHosts: process.env.VITE_ALLOWED_HOSTS
			? process.env.VITE_ALLOWED_HOSTS.split(',')
					.map((host) => host.trim())
					.filter(Boolean)
			: []
	},
	plugins: [
		tailwindcss(),
		sveltekit({
			adapter: adapter(),
			compilerOptions: {
				// Force runes mode for the project, except for libraries.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			}
		})
	]
});
