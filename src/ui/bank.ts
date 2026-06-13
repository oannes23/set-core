/* ui/bank — the SHARED ACCOUNT BANK (CRAWL §3 town-economy plan): one Gold pool for the whole
   roster, its OWN localStorage key, so it survives a hero's death (the tithe bites it; the run's
   carried gold banks into it on any safe exit). This is the first slice of the B2 economy core —
   the item Storage (the unified bag) joins this same envelope later. Pure transforms are exported
   for tests; storage I/O is best-effort (mirrors save.ts).

   GOLD is a separate counter from the item satchel/Storage by design (decided 2026-06-13): it never
   takes inventory space — items are the slot game, gold is the pool. */

export interface Bank { gold: number }

const KEY = 'setcore.bank.v1' // separate from the roster key (survives hero death)
const SCHEMA_V = 1
export const DEATH_TITHE = 0.12 // a run-ending death costs 12% of BANKED gold (the exit ladder, §6)

interface Envelope { v: number; gold: number }

export function sanitizeBank(x: unknown): Bank {
  if (typeof x !== 'object' || x === null) return { gold: 0 }
  const g = (x as Partial<Envelope>).gold
  return { gold: typeof g === 'number' && Number.isFinite(g) && g > 0 ? Math.floor(g) : 0 }
}
export function parseBank(raw: string | null): Bank {
  try {
    if (!raw) return { gold: 0 }
    return sanitizeBank(JSON.parse(raw))
  } catch {
    return { gold: 0 }
  }
}

// ---- pure transforms (no I/O; tested) ----
export const addGold = (b: Bank, n: number): Bank => ({ gold: Math.max(0, b.gold + Math.max(0, Math.round(n))) })
/** Spend up to `n` (clamped at the balance); returns the new bank + whether it could afford it. */
export function spendGold(b: Bank, n: number): { bank: Bank; ok: boolean } {
  const cost = Math.max(0, Math.round(n))
  if (cost > b.gold) return { bank: b, ok: false }
  return { bank: { gold: b.gold - cost }, ok: true }
}
/** The death tithe: forfeit a fraction of BANKED gold. Returns the new bank + the amount lost. */
export function applyTithe(b: Bank, frac = DEATH_TITHE): { bank: Bank; lost: number } {
  const lost = Math.floor(b.gold * frac)
  return { bank: { gold: b.gold - lost }, lost }
}

// ---- convenience I/O wrappers (best-effort) ----
export function loadBank(): Bank {
  try {
    return parseBank(localStorage.getItem(KEY))
  } catch {
    return { gold: 0 }
  }
}
export function saveBank(b: Bank): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: SCHEMA_V, gold: b.gold }))
  } catch {
    /* storage unavailable — the in-memory bank still works this session */
  }
}
/** Bank N gold (load → add → save) and return the new total. */
export function bankGold(n: number): number {
  const b = addGold(loadBank(), n)
  saveBank(b)
  return b.gold
}
/** Apply the death tithe to the banked pool (load → tithe → save) and return what was lost. */
export function bankTithe(frac = DEATH_TITHE): number {
  const { bank, lost } = applyTithe(loadBank(), frac)
  saveBank(bank)
  return lost
}
