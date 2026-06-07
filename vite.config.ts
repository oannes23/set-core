import { defineConfig } from 'vite'

// The modular client is the front door: root `index.html` is the Vite entry (the legacy launcher
// moved to `prototype/index.html` as an archive). Dev/preview open at root; the production build
// targets a GitHub Pages PROJECT site served from a subpath (https://<user>.github.io/set-core/),
// so assets must be base-prefixed for the build but NOT for local dev.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/set-core/' : '/',
  build: { outDir: 'dist' },
}))
