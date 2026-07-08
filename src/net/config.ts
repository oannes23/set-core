/* net/config — the Embassy's runtime switches. ALL of online is gated here: the master enable flag,
   the server URL (the official instance OR a self-host — SERVICE.md: anyone can run their own), and the
   honor-system `modded` flag. When any mod is loaded the client sets `modded` and makes NO Embassy
   requests at all (the mod-gate); when disabled the same. localStorage-backed + listener-driven like
   ui/dev.ts. This is UI/runtime state — the engine/core never see it (offline-first invariant). */

/** The default OFFICIAL instance base URL, baked in at BUILD TIME from `VITE_EMBASSY_URL` (see the
 *  repo's `.env` files). Empty ⇒ "no server configured" ⇒ Embassy unavailable until the player sets a
 *  URL in the Registry (self-hosters point this at their own instance). A per-device override typed
 *  into the Registry persists in localStorage and WINS over this default (see setServerUrl / read()). */
export const DEFAULT_OFFICIAL_URL = import.meta.env.VITE_EMBASSY_URL ?? ''

export interface EmbassyConfig {
  /** master switch — OFF until the player consents at the Embassy (SERVICE.md consent gate). */
  enabled: boolean
  /** base URL of the Embassy service (official default or a self-host). */
  serverUrl: string
  /** set true when ANY modded content is loaded → the Embassy is fully disabled (no requests). */
  modded: boolean
}

const KEY = 'setcore.embassy.config.v1'

const DEFAULTS: EmbassyConfig = { enabled: false, serverUrl: DEFAULT_OFFICIAL_URL, modded: false }

let cfg: EmbassyConfig = read()

function read(): EmbassyConfig {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const p = JSON.parse(raw) as Partial<EmbassyConfig>
    return {
      enabled: typeof p.enabled === 'boolean' ? p.enabled : DEFAULTS.enabled,
      serverUrl: typeof p.serverUrl === 'string' ? p.serverUrl : DEFAULTS.serverUrl,
      // `modded` is set by the content loader at runtime, not persisted as truth — start from default.
      modded: DEFAULTS.modded,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

const listeners = new Set<(c: EmbassyConfig) => void>()
export function onConfigChange(fn: (c: EmbassyConfig) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function commit(next: EmbassyConfig): void {
  cfg = next
  try {
    // persist enable + url only; `modded` is a live runtime fact re-derived each session.
    localStorage.setItem(KEY, JSON.stringify({ enabled: cfg.enabled, serverUrl: cfg.serverUrl }))
  } catch {
    /* best-effort */
  }
  for (const fn of listeners) fn(cfg)
}

export function getConfig(): EmbassyConfig {
  return cfg
}
export function setEnabled(on: boolean): void {
  if (on !== cfg.enabled) commit({ ...cfg, enabled: on })
}
export function setServerUrl(url: string): void {
  if (url !== cfg.serverUrl) commit({ ...cfg, serverUrl: url })
}
/** Called by the content loader: flip the mod-gate when modded content is (un)loaded. */
export function setModded(on: boolean): void {
  if (on !== cfg.modded) commit({ ...cfg, modded: on })
}

/** PURE availability test (exported for tests + the gate): online is reachable only when enabled, a
 *  server URL is set, and the game is unmodded. The single predicate every request path checks. */
export function isAvailable(c: EmbassyConfig = cfg): boolean {
  return c.enabled && !c.modded && c.serverUrl.trim().length > 0
}
