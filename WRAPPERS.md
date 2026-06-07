# Shipping the client — wrappers

The web client is the shipping client (no Godot needed for a 2D timer/turn game). It reaches every
target through thin wrappers around the same `dist/` build.

## Web / PWA — DONE & verified
The built app is an installable, offline-capable PWA:
- `public/manifest.webmanifest` (relative `start_url`/`scope` → works under the `/set-core/` subpath)
- `public/sw.js` — a dependency-free cache-falling-back-to-network service worker
- `public/icon.svg`, registered in `src/main.ts` via `import.meta.env.BASE_URL + 'sw.js'`

Verified (CDP, headless Chrome): manifest valid, service worker registers + activates with the
`/set-core/` scope, app renders. Install from the browser; works offline after first load.

## Desktop / Steam — Tauri (documented; needs the Rust toolchain to run)
Tauri wraps the web build in a tiny Rust webview shell (small binaries, native menus, auto-update).
Not executed here (requires Rust + the Tauri CLI):

    pnpm add -D @tauri-apps/cli
    pnpm tauri init           # point frontendDist at ../dist, devUrl at the vite dev server
    pnpm build && pnpm tauri build   # → native installers per OS

Note: for Tauri, set Vite `base: './'` (or `/`) for the desktop build — the `/set-core/` subpath is a
GitHub-Pages concern only. Gate it on an env flag so Pages and Tauri builds can coexist.

## Mobile / App Store + Play — Capacitor (documented; needs Xcode / Android SDK to run)
Capacitor wraps the build in a native iOS/Android shell. Not executed here (requires Xcode / Android
Studio):

    pnpm add -D @capacitor/cli && pnpm add @capacitor/core
    pnpm cap init set.core dev.setcore.app --web-dir dist
    pnpm cap add ios && pnpm cap add android
    pnpm build && pnpm cap sync     # then open in Xcode / Android Studio to run + submit

Same `base: './'` note as Tauri.

## When to actually do the native wrappers
Only when a store launch is a real goal. Until then the PWA covers web + installable desktop/mobile.
The build is wrapper-ready now — these are config steps, not a port.
