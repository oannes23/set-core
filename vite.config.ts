import { defineConfig } from 'vite'

// The repo root holds the legacy launcher (index.html) and the new app (app.html).
// Dev opens the app directly; the build emits the app to dist/. When the app supersedes
// the launcher, promote app.html -> index.html (and drop this `input`/`open`).
export default defineConfig({
  server: { open: '/app.html' },
  build: {
    outDir: 'dist',
    rollupOptions: { input: { app: 'app.html' } },
  },
})
