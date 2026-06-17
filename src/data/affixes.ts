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

const LOOTTIER_K = 0.02 // affix magnitude × (1 + lootTier·k) — sim §12

export const AFFIXES: AffixDef[] = [
  // ── STAT patches (LIVE) — the off-stat fixers; any slot (patch what your base gear lacks). k=2 ≈ +2–3 at mid tier ──
  { sys: 'FlatPower', name: 'Mighty', family: 'stat', slots: 'any', minRarity: 'white', weight: 10, live: true, note: '+Power (raw stat)', make: { c: 'stat', stat: 'power', k: 2 } },
  { sys: 'FlatEndurance', name: 'Stalwart', family: 'stat', slots: 'any', minRarity: 'white', weight: 10, live: true, note: '+Endurance (raw stat)', make: { c: 'stat', stat: 'endurance', k: 2 } },
  { sys: 'FlatSpeed', name: 'Fleet', family: 'stat', slots: 'any', minRarity: 'white', weight: 10, live: true, note: '+Speed (raw stat)', make: { c: 'stat', stat: 'speed', k: 2 } },
  // ── scoped RIDERS (LIVE) — flat per-card, slot-appropriate (the bounded power channel) ──
  { sys: 'AttackDamagePerCard', name: 'Honed', family: 'rider', slots: ['weapon', 'relic'], minRarity: 'green', weight: 6, live: true, note: '+damage per Attack card', make: { c: 'rider', rider: 'atkDamagePerCard' } },
  { sys: 'BlockPerDefendCard', name: 'Warding', family: 'rider', slots: ['armor', 'relic'], minRarity: 'green', weight: 6, live: true, note: '+Block per Defend card', make: { c: 'rider', rider: 'blockPerDefendCard' } },
  { sys: 'ManaPerMatch', name: 'Channeling', family: 'rider', slots: ['weapon', 'relic', 'trinket1'], minRarity: 'green', weight: 5, live: true, note: '+mana per mono-colour set', make: { c: 'rider', rider: 'manaPerMatch' } },
  // ── PROCS (LIVE via the affix-proc engine) — on-match, CONDITIONED + small (sim §12: procs run hot) ──
  { sys: 'OnMatchBonusDamage', name: 'Savage', family: 'proc', slots: ['weapon', 'relic'], minRarity: 'blue', weight: 4, live: true, note: 'all-Attack match → bonus damage', make: { c: 'proc', when: { axis: 'shape', mode: 'all_same', value: 'attack' }, effect: { kind: 'damage' }, label: '⚔+{a}' } },
  { sys: 'OnMatchBonusDamage_red', name: 'Searing', family: 'proc', slots: ['weapon'], minRarity: 'blue', weight: 3, live: true, note: 'all-Fire match → bonus burn damage', make: { c: 'proc', when: { axis: 'color', mode: 'all_same', value: 'red' }, effect: { kind: 'damage' }, label: '🔥+{a}' } },
  { sys: 'OnMatchManaGain', name: 'Attuned', family: 'proc', slots: ['relic', 'trinket1'], minRarity: 'blue', weight: 3, live: true, note: 'mono-colour match → +mana (to that colour)', make: { c: 'proc', when: { axis: 'color', mode: 'all_same' }, effect: { kind: 'mana', k: 0.7 }, label: '✦+{a}' } },
  { sys: 'OnMatchHeal', name: 'Renewing', family: 'proc', slots: ['armor', 'trinket1'], minRarity: 'blue', weight: 3, live: true, note: 'all-Defend match → small heal', make: { c: 'proc', when: { axis: 'shape', mode: 'all_same', value: 'defend' }, effect: { kind: 'heal', k: 1.5 }, label: '+{a}hp' } },
  { sys: 'OnMatchDelayEnemy', name: 'Time-Eater', family: 'proc', slots: ['relic', 'trinket1'], minRarity: 'purple', weight: 2, live: true, note: 'rainbow-colour match → delay the foe 1s', make: { c: 'proc', when: { axis: 'color', mode: 'all_different' }, effect: { kind: 'delay', seconds: 1 }, label: '⏳+1s' } },
  { sys: 'OnMatchChurn', name: "Trickster's", family: 'proc', slots: ['trinket1'], minRarity: 'blue', weight: 3, live: false, note: 'on a match: churn the deadest card toward your bias (STAGED — needs proc-churn plumbing)' },
  // ── gear-EXCLUSIVE (LIVE via GearMods — deterministic; gear's identity) ──
  { sys: 'Penetration', name: 'Sundering', family: 'crit', slots: ['weapon', 'relic'], minRarity: 'blue', weight: 3, live: true, note: 'ignore some foe Endurance in the Attack contest (anti-armour)', make: { c: 'mod', mod: 'penetration', k: 1.5 } },
  { sys: 'FlatDamageReduction', name: 'Ironhide', family: 'utility', slots: ['armor', 'relic'], minRarity: 'green', weight: 4, live: true, note: 'flat damage reduction (Soak; permanent, pre-Block)', make: { c: 'mod', mod: 'soak', k: 1.5 } },
  { sys: 'DodgeChance', name: 'Evasive', family: 'utility', slots: ['armor', 'trinket1'], minRarity: 'blue', weight: 3, live: true, note: '+dodge chance (Speed-adjacent; +flat on the per-swing roll)', make: { c: 'mod', mod: 'dodge', perUnit: 0.03, cap: 0.2 } },
  { sys: 'Lifesteal', name: 'Sanguine', family: 'proc', slots: ['weapon', 'trinket1'], minRarity: 'purple', weight: 2, live: true, note: 'heal a fraction of damage dealt (offensive sustain)', make: { c: 'mod', mod: 'lifesteal', perUnit: 0.04, cap: 0.2 } },
  // CRIT (LIVE — the shared exchange-delight channel; a narrow §5.7 carve-out, player-only, capped).
  // Both are always useful because there's a 5% global base to build on (no dead-affix combo trap).
  { sys: 'CritChance', name: 'Keen', family: 'crit', slots: ['weapon', 'trinket1'], minRarity: 'blue', weight: 4, live: true, note: '+crit chance (adds to the 5% base; capped at 20%)', make: { c: 'mod', mod: 'critChance', perUnit: 0.02, cap: 0.1 } },
  { sys: 'CritMultiplier', name: 'Vorpal', family: 'crit', slots: ['weapon'], minRarity: 'purple', weight: 2, live: true, note: '+crit damage multiplier (scales every crit — base ×1.5 + this)', make: { c: 'mod', mod: 'critMult', perUnit: 0.25, cap: 1.0 } },
  // ── REACTIVE (LIVE via the affix-proc engine's player-side events: wound / kill / lowHP) ──
  { sys: 'OnWoundThorns', name: 'Barbed', family: 'reactive', slots: ['armor', 'relic'], minRarity: 'blue', weight: 3, live: true, note: 'on taking a wound → reflect damage at the foe', make: { c: 'proc', event: 'wound', effect: { kind: 'damage', k: 2 }, label: '🌵{a}' } },
  { sys: 'OnWoundWard', name: "Guardian's", family: 'reactive', slots: ['armor', 'relic'], minRarity: 'purple', weight: 2, live: true, note: 'on taking a wound → bank a Stand-Ground charge', make: { c: 'proc', event: 'wound', effect: { kind: 'charges', amount: 1 }, label: '🛡+1' } },
  { sys: 'OnKillHeal', name: 'Carnage', family: 'reactive', slots: ['weapon', 'trinket1'], minRarity: 'blue', weight: 3, live: true, note: 'on a kill → heal (carries to the next room)', make: { c: 'proc', event: 'kill', effect: { kind: 'heal', k: 3 }, label: '+{a}hp' } },
  { sys: 'OnLowHPSurge', name: 'Cornered', family: 'reactive', slots: ['armor', 'trinket1'], minRarity: 'purple', weight: 2, live: true, note: 'while below 30% HP → a Block surge each round', make: { c: 'proc', event: 'lowHP', effect: { kind: 'block', k: 2.5 }, label: '🛡+{a}' } },
  // ── UTILITY (STAGED) ──
  { sys: 'FavorBias', name: 'Fated', family: 'utility', slots: ['trinket1'], minRarity: 'green', weight: 3, live: false, note: 'a passive deal-bias toward a chosen value (locked-board-safe)' },
  // ── UNIQUE (STAGED, orange) — curated named templates; locked + random affixes (§7) ──
  { sys: 'Unique_Heartseeker', name: 'Heartseeker', family: 'unique', slots: ['weapon'], minRarity: 'orange', weight: 1, live: false, note: 'orange unique: rainbow Attacks always crit' },
  { sys: 'Unique_Aegis', name: 'the Aegis', family: 'unique', slots: ['armor', 'relic'], minRarity: 'orange', weight: 1, live: false, note: 'orange unique: negate the first strike each fight' },
]

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
