import './ui/styles.css'
import { mountApp } from './ui/app'

// The new client (TODO.md §A, step 5): a functional rebuild over the engine. The single-file
// prototype (prototype/set-combat.html) remains the polished oracle/live game during migration.
const root = document.querySelector<HTMLDivElement>('#app')
if (root) mountApp(root)

// PWA: register the service worker (installable + offline). BASE_URL = /set-core/ in prod, / in dev.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => {})
  })
}

