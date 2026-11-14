import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import adapter from "@sveltejs/adapter-auto";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL(".", import.meta.url)), "");
  const allowedHosts = (env.VITE_ALLOWED_HOSTS || process.env.VITE_ALLOWED_HOSTS || "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);

  return {
    server: {
      // Set VITE_ALLOWED_HOSTS in the environment or .env; it is never
      // hard-coded here.
      allowedHosts,
    },
    plugins: [
      tailwindcss(),
      sveltekit({
        adapter: adapter(),
        compilerOptions: {
          // Force runes mode for the project, except for libraries.
          runes: ({ filename }) =>
            filename.split(/[/\\]/).includes("node_modules") ? undefined : true,
        },
      }),
    ],
  };
});
