import { defineConfig } from 'vite'
import yaml from '@modyfi/vite-plugin-yaml'

// The modular client is the front door: root `index.html` is the Vite entry (the legacy launcher
// moved to `prototype/index.html` as an archive). Dev/preview open at root; the production build
// targets a GitHub Pages PROJECT site served from a subpath (https://<user>.github.io/set-core/),
// so assets must be base-prefixed for the build but NOT for local dev.
//
// `yaml()` transforms `import x from './foo.yaml'` into a parsed JS object AT BUILD TIME (the
// content-moddability track — MODDING.md). It is a devDependency: the parser never reaches the
// shipped runtime bundle. vitest reuses this same pipeline, so tests load the identical content.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/set-core/' : '/',
  build: { outDir: 'dist' },
  plugins: [yaml()],
}))
