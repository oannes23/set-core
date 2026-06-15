/* ui/dev — the DEV MODE toggle + the descriptive↔thematic name registry.

   Dev mode is an always-present, subtle corner switch (mounted in app.ts). It does two jobs:
   1. **Names:** normal play shows the THEMATIC overlay ("Vorpal"); dev mode shows the underlying
      SYSTEM-descriptive name ("CritMultiplier") — so the design surface is legible while building.
      `displayName(systemKey)` resolves either way off the live flag.
   2. **Instruments:** dev mode reveals extra system/balance numbers (the combat dev row, a town
      readout, the under-the-hood loot-roll trace) — gated UI-side by the `dev` body class.

   UI-only + localStorage-backed (like save.ts / bank.ts); the engine's determinism lives elsewhere.
   Listeners let the app re-render on toggle. The thematic table is a FIRST DRAFT (CRAWL §7) — it
   moves to the gear catalog when gear lands; until then it's the seed the name toggle switches. */

const KEY = 'setcore.devmode'
let on = read()

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/** Is dev mode currently on? */
export function isDev(): boolean {
  return on
}

const listeners = new Set<(on: boolean) => void>()
/** Subscribe to dev-mode flips (the app re-renders / re-paints). Returns an unsubscribe. */
export function onDevChange(fn: (on: boolean) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Set dev mode (best-effort persist) and notify listeners if it changed. */
export function setDev(next: boolean): void {
  if (next === on) return
  on = next
  try {
    localStorage.setItem(KEY, next ? '1' : '0')
  } catch {
    /* private mode / quota — the in-memory flag still works this session */
  }
  for (const fn of listeners) fn(on)
}

export function toggleDev(): void {
  setDev(!on)
}

/* ---- the descriptive↔thematic name registry ----
   The themed affix CATALOG (`data/affixes`) is the single source of truth for naming; dev.ts just
   re-exports its sys→thematic map. Normal play shows the thematic name; dev mode shows the system key. */
export { AFFIX_THEME } from '../data/affixes'
import { AFFIX_THEME as THEME } from '../data/affixes'

/** Resolve a hook's display name: the SYSTEM key in dev mode, the THEMATIC overlay otherwise.
 *  Falls back to the key itself if no thematic name is registered (so nothing renders blank). */
export function displayName(systemKey: string): string {
  if (on) return systemKey
  return THEME[systemKey] ?? systemKey
}
