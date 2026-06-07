import { defineConfig } from 'vite'

// The repo root holds the legacy launcher (index.html) and the new app (app.html).
// Dev opens the app directly at root; the production build targets a GitHub Pages PROJECT
// site, which is served from a subpath (https://<user>.github.io/set-core/). So assets must
// be base-prefixed for the build but NOT for local dev. When the app supersedes the launcher,
// promote app.html -> index.html (and drop this `input`/`open`).
export default defineConfig(({ command, isPreview }) => ({
  // Production build + `vite preview` mirror Pages' subpath; plain `vite dev` stays at root.
  base: command === 'build' || isPreview ? '/set-core/' : '/',
  server: { open: '/app.html' },
  preview: { open: '/set-core/app.html' },
  build: {
    outDir: 'dist',
    rollupOptions: { input: { app: 'app.html' } },
  },
}))
