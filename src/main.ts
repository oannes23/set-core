import './ui/styles.css'
import { mountApp } from './ui/app'

// The live client (TODO.md §A complete): a functional rebuild over the engine. The single-file
// prototypes are archived under prototype/ as the behavioral oracle the rebuild was diffed against.
const root = document.querySelector<HTMLDivElement>('#app')
if (root) mountApp(root)

// PWA: register the service worker (installable + offline). BASE_URL = /set-core/ in prod, / in dev.
// PROD-only: a SW caching Vite's unhashed dev-server modules is the classic "stale dev" footgun.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => {})
  })
}

