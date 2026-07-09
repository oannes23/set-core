/* ui/prefs — player-facing UI PREFERENCES, localStorage-backed with an in-memory cache (exactly the
   pattern of ui/dev). NON-engine, NON-save: these steer the fresh-save funnel + accessibility, never
   gameplay determinism. The read is garbage-hardened (defaults on any malformed payload). The pure
   DECISION helpers (bootRoute / showQuestCue) take explicit args so they unit-test without storage. */

const KEY = 'setcore.prefs.v1'

export interface Prefs {
  tutorialSeen: boolean // the guided intro has launched at least once → don't auto-funnel again
  questCueSeen: boolean // the one-time "▶ next: the Goblin Warren" town cue has been shown/dismissed
  colorblind: boolean // redundant card encoding: CVD-safe palette + a hue-independent shape pip per colour
}

const DEFAULTS: Prefs = { tutorialSeen: false, questCueSeen: false, colorblind: false }

function read(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>
    return { tutorialSeen: p.tutorialSeen === true, questCueSeen: p.questCueSeen === true, colorblind: p.colorblind === true }
  } catch {
    return { ...DEFAULTS }
  }
}

let cache: Prefs = read()

/** The current preferences (a copy of the in-memory cache; hydrated from localStorage at load). */
export function getPrefs(): Prefs {
  return { ...cache }
}

/** Set one preference (best-effort persist; the in-memory cache always updates so it holds this session). */
export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  if (cache[key] === value) return
  cache = { ...cache, [key]: value }
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    /* private mode / quota — the in-memory cache still holds this session */
  }
}

// ── pure decisions (no storage; unit-tested) ──

/** Where a boot lands. The fresh-save funnel (create → guided tutorial) fires ONLY for a brand-new
 *  player — no heroes AND the tutorial has never run; everyone else (returning, or mid-roster) → town. */
export function bootRoute(rosterLen: number, tutorialSeen: boolean): 'funnel' | 'town' {
  return rosterLen === 0 && !tutorialSeen ? 'funnel' : 'town'
}

/** Whether town shows the one-time "▶ next: the Goblin Warren" quest cue — right after the tutorial,
 *  once, and only when there's an active hero to send into the Gates. */
export function showQuestCue(tutorialSeen: boolean, questCueSeen: boolean, hasHero: boolean): boolean {
  return tutorialSeen && !questCueSeen && hasHero
}
