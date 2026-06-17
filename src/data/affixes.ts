/* data/affixes — the THEMED AFFIX CATALOG (CRAWL §7). The thematic overlay retrofitted onto the
   descriptive design surface: each affix carries a SYSTEM-descriptive key (`sys` — dev mode shows it)
   and a thematic NAME (normal play). The catalog is the single source for naming + slot/tier gating +
   mechanics; the loot roller draws from it (inverse budget), and dev.ts derives its name map here.

   FUNCTIONAL TODAY (`live: true`): the STAT-patch family (folds via gearStatBonus) and the scoped RIDER
   family (folds via gearRiders — both already in the contest). STAGED (`live: false`): procs / crit /
   reactive / utility / unique — authored with names + the mechanic note, but their combat effect needs
   the affix-proc engine + the new gear-exclusive mechanics (crit/dodge/penetration). The roller only
   mints LIVE affixes, so every dropped affix functions; the staged set is the design + the next slice. */

import { RARITY, RARITIES, freshUid, type Affix, type AffixComponent, type EquipSlot, type Rarity, type StatKey, type ProcEffect, type ProcEvent, type Riders, type GearMods } from '../engine/items'
import type { Condition } from './schema'
import type { Rng } from '../core/rng'
import affixData from './content/affixes.yaml'

export type AffixFamily = 'stat' | 'rider' | 'proc' | 'crit' | 'reactive' | 'utility' | 'unique'

// ── the affix MAGNITUDE DSL (MODDING.md Phase 2) — the declarative replacement for the old build()
//    closures, so the catalog is pure data (→ content/affixes.yaml). Two magnitude ops cover every
//    live affix: an INTEGER `scaled(m,k) = max(1, round(m·k))` (k default 1) and a FRACTION
//    `min(cap, perUnit·m)`. A proc damage/heal/block/mana scales by k; charges/delay are literal. ──
type RiderKey = keyof Riders
type ModKey = keyof GearMods

export type ProcSpec =
  | { kind: 'damage' | 'heal' | 'block'; k?: number } // amount = scaled(m,k)
  | { kind: 'mana'; k?: number; color?: number } // amount = scaled(m,k); color omitted → matched mono colour
  | { kind: 'charges'; amount: number } // literal
  | { kind: 'delay'; seconds: number } // literal

/** How to realize an affix at a magnitude unit `m`. Replaces `build: (mag)=>AffixComponent[]`. */
export type AffixSpec =
  | { c: 'stat'; stat: StatKey; k?: number }
  | { c: 'rider'; rider: RiderKey; k?: number }
  | { c: 'mod'; mod: ModKey; k?: number } // integer mod (penetration / soak)
  | { c: 'mod'; mod: ModKey; perUnit: number; cap: number } // fractional mod (dodge / lifesteal / crit*)
  | { c: 'proc'; when?: Condition; event?: ProcEvent; effect: ProcSpec; label: string }

const scaled = (m: number, k = 1): number => Math.max(1, Math.round(m * k))

/** Interpret an AffixSpec at magnitude `m` into the engine's AffixComponent[] (the folds in
 *  engine/gear.ts are unchanged — only the catalog→instance step is now data-driven). The proc
 *  `label`'s `{a}` placeholder is filled with the computed amount. */
export function buildAffixComponents(spec: AffixSpec, m: number): AffixComponent[] {
  switch (spec.c) {
    case 'stat':
      return [{ c: 'stat', stat: spec.stat, amount: scaled(m, spec.k) }]
    case 'rider': {
      const riders: Partial<Riders> = {}
      riders[spec.rider] = scaled(m, spec.k)
      return [{ c: 'rider', riders }]
    }
    case 'mod':
      return 'perUnit' in spec
        ? [{ c: 'mod', mod: spec.mod, amount: Math.min(spec.cap, spec.perUnit * m) }]
        : [{ c: 'mod', mod: spec.mod, amount: scaled(m, spec.k) }]
    case 'proc': {
      const e = spec.effect
      let effect: ProcEffect
      let a = 0
      if (e.kind === 'charges') effect = { kind: 'charges', amount: e.amount }
      else if (e.kind === 'delay') effect = { kind: 'delay', seconds: e.seconds }
      else if (e.kind === 'mana') { a = scaled(m, e.k); effect = e.color != null ? { kind: 'mana', amount: a, color: e.color } : { kind: 'mana', amount: a } }
      else { a = scaled(m, e.k); effect = { kind: e.kind, amount: a } }
      return [{ c: 'proc', proc: { ...(spec.when ? { when: spec.when } : {}), ...(spec.event ? { event: spec.event } : {}), effect, label: spec.label.replace('{a}', String(a)) } }]
    }
  }
}

export interface AffixDef {
  sys: string // SYSTEM-descriptive key (= Affix.label; the dev-mode display + the AFFIX_THEME key)
  name: string // the thematic name (normal play)
  family: AffixFamily
  slots: EquipSlot[] | 'any' // slot-gating
  minRarity: Rarity // tier-gate: the lowest rarity this affix can roll at
  weight: number
  live: boolean // true = the mechanic functions today; false = STAGED (needs the affix-proc engine)
  note: string // the mechanic, in words (dev tooltip + design ledger)
  make?: AffixSpec // LIVE only: the declarative recipe realized at a magnitude unit (the magnitude DSL)
}

/** content/affixes.yaml — the themed affix catalog (a list). Pure data now that build() is a `make` spec. */
export type AffixFile = AffixDef[]

const LOOTTIER_K = 0.02 // affix magnitude × (1 + lootTier·k) — sim §12

export const AFFIXES: AffixDef[] = affixData as AffixFile

/** sys → thematic name (dev.ts merges this into its name map; displayName resolves affix labels). */
export const AFFIX_THEME: Record<string, string> = Object.fromEntries(AFFIXES.map((d) => [d.sys, d.name]))

/** sys → the full AffixDef (for the item tooltip's mechanic note). */
const AFFIX_BY_SYS: Record<string, AffixDef> = Object.fromEntries(AFFIXES.map((d) => [d.sys, d]))
export const affixBySys = (sys: string): AffixDef | undefined => AFFIX_BY_SYS[sys]

const fits = (d: AffixDef, slot: EquipSlot): boolean =>
  d.slots === 'any' || d.slots.includes(slot) || (slot === 'trinket2' && d.slots.includes('trinket1'))

function weightedPick(pool: AffixDef[], rng: Rng): AffixDef {
  const total = pool.reduce((s, d) => s + d.weight, 0)
  let r = rng() * total
  for (const d of pool) { r -= d.weight; if (r < 0) return d }
  return pool[pool.length - 1]
}

/** The per-affix magnitude unit at a given rarity + loot-tier (inverse budget × loot-tier scalar —
 *  sim §12). Shared by the loot roller and the smith's Enchant so a crafted affix matches a dropped one. */
export const affixMagUnit = (rarity: Rarity, lootTier: number): number =>
  RARITY[rarity].perAffixPower * (1 + lootTier * LOOTTIER_K)

/** The LIVE, buildable affixes that fit a slot + are unlocked at a rarity tier — the rollable/enchantable
 *  pool. STAGED (non-live) affixes are catalogued but excluded, so every minted affix functions. */
export const eligibleAffixes = (slot: EquipSlot, rarity: Rarity): AffixDef[] =>
  AFFIXES.filter((d) => d.live && d.make && fits(d, slot) && RARITIES.indexOf(rarity) >= RARITIES.indexOf(d.minRarity))

/** Mint ONE affix instance from a def at a rarity + loot-tier (the smith Enchant unit; also the loot
 *  roller's per-draw step). Deterministic in magnitude — the only randomness is the fresh instance id. */
export const mintAffix = (def: AffixDef, rarity: Rarity, lootTier: number): Affix =>
  ({ id: `${def.sys}_${freshUid()}`, label: def.sys, components: buildAffixComponents(def.make!, affixMagUnit(rarity, lootTier)) })

/** Roll a gear instance's affixes (CRAWL §7 inverse budget + sim §12): a random 1..maxAffixes distinct
 *  LIVE affixes that fit the slot + are unlocked at the rarity tier, each scaled by perAffixPower ×
 *  loot-tier. STAGED (non-live) affixes are catalogued but never rolled, so every drop functions. */
export function rollAffixes(slot: EquipSlot, rarity: Rarity, lootTier: number, rng: Rng): Affix[] {
  const budget = RARITY[rarity]
  if (budget.maxAffixes === 0) return []
  const eligible = eligibleAffixes(slot, rarity)
  if (!eligible.length) return []
  const count = 1 + Math.floor(rng() * budget.maxAffixes) // random 1..max — the per-drop variance
  const out: Affix[] = []
  const used = new Set<string>()
  for (let i = 0; i < count; i++) {
    const pool = eligible.filter((d) => !used.has(d.sys))
    if (!pool.length) break
    const def = weightedPick(pool, rng)
    used.add(def.sys)
    out.push(mintAffix(def, rarity, lootTier))
  }
  return out
}
