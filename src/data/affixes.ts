/* data/affixes — the THEMED AFFIX CATALOG (CRAWL §7). The thematic overlay retrofitted onto the
   descriptive design surface: each affix carries a SYSTEM-descriptive key (`sys` — dev mode shows it)
   and a thematic NAME (normal play). The catalog is the single source for naming + slot/tier gating +
   mechanics; the loot roller draws from it (inverse budget), and dev.ts derives its name map here.

   FUNCTIONAL TODAY (`live: true`): the STAT-patch family (folds via gearStatBonus) and the scoped RIDER
   family (folds via gearRiders — both already in the contest). STAGED (`live: false`): procs / crit /
   reactive / utility / unique — authored with names + the mechanic note, but their combat effect needs
   the affix-proc engine + the new gear-exclusive mechanics (crit/dodge/penetration). The roller only
   mints LIVE affixes, so every dropped affix functions; the staged set is the design + the next slice. */

import { RARITY, RARITIES, freshUid, type Affix, type AffixComponent, type EquipSlot, type Rarity, type StatKey, type ProcEffect } from '../engine/items'
import type { Condition } from './schema'
import type { Rng } from '../core/rng'

export type AffixFamily = 'stat' | 'rider' | 'proc' | 'crit' | 'reactive' | 'utility' | 'unique'

export interface AffixDef {
  sys: string // SYSTEM-descriptive key (= Affix.label; the dev-mode display + the AFFIX_THEME key)
  name: string // the thematic name (normal play)
  family: AffixFamily
  slots: EquipSlot[] | 'any' // slot-gating
  minRarity: Rarity // tier-gate: the lowest rarity this affix can roll at
  weight: number
  live: boolean // true = the mechanic functions today; false = STAGED (needs the affix-proc engine)
  note: string // the mechanic, in words (dev tooltip + design ledger)
  build?: (mag: number) => AffixComponent[] // LIVE only: realize the mechanic at a magnitude unit
}

const LOOTTIER_K = 0.02 // affix magnitude × (1 + lootTier·k) — sim §12
const STAT_BASE = 2 // an off-stat patch ≈ +2–3 at mid loot-tier (sim §12 Part C)
const stat = (s: StatKey): ((mag: number) => AffixComponent[]) => (mag) => [{ c: 'stat', stat: s, amount: Math.max(1, Math.round(STAT_BASE * mag)) }]
const atkRider = (mag: number): AffixComponent[] => [{ c: 'rider', riders: { atkDamagePerCard: Math.max(1, Math.round(mag)) } }]
const blkRider = (mag: number): AffixComponent[] => [{ c: 'rider', riders: { blockPerDefendCard: Math.max(1, Math.round(mag)) } }]
const manaRider = (mag: number): AffixComponent[] => [{ c: 'rider', riders: { manaPerMatch: Math.max(1, Math.round(mag)) } }]
/** ON-MATCH proc builder: a condition on the matched set → a player effect (the affix-proc engine).
 *  Magnitudes are SMALL + the procs are CONDITIONED (so the per-round value stays bounded — sim §12;
 *  a proc-value sim is the tuning gate). */
const procC = (when: Condition | undefined, mk: (mag: number) => { effect: ProcEffect; label: string }): ((mag: number) => AffixComponent[]) =>
  (mag) => { const { effect, label } = mk(mag); return [{ c: 'proc', proc: { when, effect, label } }] }
const round1 = (mag: number, k = 1): number => Math.max(1, Math.round(mag * k))

export const AFFIXES: AffixDef[] = [
  // ── STAT patches (LIVE) — the off-stat fixers; any slot (patch what your base gear lacks) ──
  { sys: 'FlatPower', name: 'Mighty', family: 'stat', slots: 'any', minRarity: 'white', weight: 10, live: true, note: '+Power (raw stat)', build: stat('power') },
  { sys: 'FlatEndurance', name: 'Stalwart', family: 'stat', slots: 'any', minRarity: 'white', weight: 10, live: true, note: '+Endurance (raw stat)', build: stat('endurance') },
  { sys: 'FlatSpeed', name: 'Fleet', family: 'stat', slots: 'any', minRarity: 'white', weight: 10, live: true, note: '+Speed (raw stat)', build: stat('speed') },
  // ── scoped RIDERS (LIVE) — flat per-card, slot-appropriate (the bounded power channel) ──
  { sys: 'AttackDamagePerCard', name: 'Honed', family: 'rider', slots: ['weapon', 'relic'], minRarity: 'green', weight: 6, live: true, note: '+damage per Attack card', build: atkRider },
  { sys: 'BlockPerDefendCard', name: 'Warding', family: 'rider', slots: ['armor', 'relic'], minRarity: 'green', weight: 6, live: true, note: '+Block per Defend card', build: blkRider },
  { sys: 'ManaPerMatch', name: 'Channeling', family: 'rider', slots: ['weapon', 'relic', 'trinket1'], minRarity: 'green', weight: 5, live: true, note: '+mana per mono-colour set', build: manaRider },
  // ── PROCS (LIVE via the affix-proc engine) — on-match, CONDITIONED + small (sim §12: procs run hot) ──
  { sys: 'OnMatchBonusDamage', name: 'Savage', family: 'proc', slots: ['weapon', 'relic'], minRarity: 'blue', weight: 4, live: true, note: 'all-Attack match → bonus damage', build: procC({ axis: 'shape', mode: 'all_same', value: 'attack' }, (m) => { const a = round1(m); return { effect: { kind: 'damage', amount: a }, label: `⚔+${a}` } }) },
  { sys: 'OnMatchBonusDamage_red', name: 'Searing', family: 'proc', slots: ['weapon'], minRarity: 'blue', weight: 3, live: true, note: 'all-Fire match → bonus burn damage', build: procC({ axis: 'color', mode: 'all_same', value: 'red' }, (m) => { const a = round1(m); return { effect: { kind: 'damage', amount: a }, label: `🔥+${a}` } }) },
  { sys: 'OnMatchManaGain', name: 'Attuned', family: 'proc', slots: ['relic', 'trinket1'], minRarity: 'blue', weight: 3, live: true, note: 'mono-colour match → +mana (to that colour)', build: procC({ axis: 'color', mode: 'all_same' }, (m) => { const a = round1(m, 0.7); return { effect: { kind: 'mana', amount: a }, label: `✦+${a}` } }) },
  { sys: 'OnMatchHeal', name: 'Renewing', family: 'proc', slots: ['armor', 'trinket1'], minRarity: 'blue', weight: 3, live: true, note: 'all-Defend match → small heal', build: procC({ axis: 'shape', mode: 'all_same', value: 'defend' }, (m) => { const a = round1(m, 1.5); return { effect: { kind: 'heal', amount: a }, label: `+${a}hp` } }) },
  { sys: 'OnMatchDelayEnemy', name: 'Time-Eater', family: 'proc', slots: ['relic', 'trinket1'], minRarity: 'purple', weight: 2, live: true, note: 'rainbow-colour match → delay the foe 1s', build: procC({ axis: 'color', mode: 'all_different' }, () => ({ effect: { kind: 'delay', seconds: 1 }, label: '⏳+1s' })) },
  { sys: 'OnMatchChurn', name: "Trickster's", family: 'proc', slots: ['trinket1'], minRarity: 'blue', weight: 3, live: false, note: 'on a match: churn the deadest card toward your bias (STAGED — needs proc-churn plumbing)' },
  // ── gear-EXCLUSIVE (LIVE via GearMods — deterministic; gear's identity) ──
  { sys: 'Penetration', name: 'Sundering', family: 'crit', slots: ['weapon', 'relic'], minRarity: 'blue', weight: 3, live: true, note: 'ignore some foe Endurance in the Attack contest (anti-armour)', build: (m) => [{ c: 'mod', mod: 'penetration', amount: round1(m, 1.5) }] },
  { sys: 'FlatDamageReduction', name: 'Ironhide', family: 'utility', slots: ['armor', 'relic'], minRarity: 'green', weight: 4, live: true, note: 'flat damage reduction (Soak; permanent, pre-Block)', build: (m) => [{ c: 'mod', mod: 'soak', amount: round1(m, 1.5) }] },
  { sys: 'DodgeChance', name: 'Evasive', family: 'utility', slots: ['armor', 'trinket1'], minRarity: 'blue', weight: 3, live: true, note: '+dodge chance (Speed-adjacent; +flat on the per-swing roll)', build: (m) => [{ c: 'mod', mod: 'dodge', amount: Math.min(0.2, 0.03 * m) }] },
  { sys: 'Lifesteal', name: 'Sanguine', family: 'proc', slots: ['weapon', 'trinket1'], minRarity: 'purple', weight: 2, live: true, note: 'heal a fraction of damage dealt (offensive sustain)', build: (m) => [{ c: 'mod', mod: 'lifesteal', amount: Math.min(0.2, 0.04 * m) }] },
  // CRIT (LIVE — the shared exchange-delight channel; a narrow §5.7 carve-out, player-only, capped).
  // Both are always useful because there's a 5% global base to build on (no dead-affix combo trap).
  { sys: 'CritChance', name: 'Keen', family: 'crit', slots: ['weapon', 'trinket1'], minRarity: 'blue', weight: 4, live: true, note: '+crit chance (adds to the 5% base; capped at 20%)', build: (m) => [{ c: 'mod', mod: 'critChance', amount: Math.min(0.1, 0.02 * m) }] },
  { sys: 'CritMultiplier', name: 'Vorpal', family: 'crit', slots: ['weapon'], minRarity: 'purple', weight: 2, live: true, note: '+crit damage multiplier (scales every crit — base ×1.5 + this)', build: (m) => [{ c: 'mod', mod: 'critMult', amount: Math.min(1.0, 0.25 * m) }] },
  // ── REACTIVE (LIVE via the affix-proc engine's player-side events: wound / kill / lowHP) ──
  { sys: 'OnWoundThorns', name: 'Barbed', family: 'reactive', slots: ['armor', 'relic'], minRarity: 'blue', weight: 3, live: true, note: 'on taking a wound → reflect damage at the foe', build: (m) => [{ c: 'proc', proc: { event: 'wound', effect: { kind: 'damage', amount: round1(m, 2) }, label: `🌵${round1(m, 2)}` } }] },
  { sys: 'OnWoundWard', name: "Guardian's", family: 'reactive', slots: ['armor', 'relic'], minRarity: 'purple', weight: 2, live: true, note: 'on taking a wound → bank a Stand-Ground charge', build: () => [{ c: 'proc', proc: { event: 'wound', effect: { kind: 'charges', amount: 1 }, label: '🛡+1' } }] },
  { sys: 'OnKillHeal', name: 'Carnage', family: 'reactive', slots: ['weapon', 'trinket1'], minRarity: 'blue', weight: 3, live: true, note: 'on a kill → heal (carries to the next room)', build: (m) => [{ c: 'proc', proc: { event: 'kill', effect: { kind: 'heal', amount: round1(m, 3) }, label: `+${round1(m, 3)}hp` } }] },
  { sys: 'OnLowHPSurge', name: 'Cornered', family: 'reactive', slots: ['armor', 'trinket1'], minRarity: 'purple', weight: 2, live: true, note: 'while below 30% HP → a Block surge each round', build: (m) => [{ c: 'proc', proc: { event: 'lowHP', effect: { kind: 'block', amount: round1(m, 2.5) }, label: `🛡+${round1(m, 2.5)}` } }] },
  // ── UTILITY (STAGED) ──
  { sys: 'FavorBias', name: 'Fated', family: 'utility', slots: ['trinket1'], minRarity: 'green', weight: 3, live: false, note: 'a passive deal-bias toward a chosen value (locked-board-safe)' },
  // ── UNIQUE (STAGED, orange) — curated named templates; locked + random affixes (§7) ──
  { sys: 'Unique_Heartseeker', name: 'Heartseeker', family: 'unique', slots: ['weapon'], minRarity: 'orange', weight: 1, live: false, note: 'orange unique: rainbow Attacks always crit' },
  { sys: 'Unique_Aegis', name: 'the Aegis', family: 'unique', slots: ['armor', 'relic'], minRarity: 'orange', weight: 1, live: false, note: 'orange unique: negate the first strike each fight' },
]

/** sys → thematic name (dev.ts merges this into its name map; displayName resolves affix labels). */
export const AFFIX_THEME: Record<string, string> = Object.fromEntries(AFFIXES.map((d) => [d.sys, d.name]))

const fits = (d: AffixDef, slot: EquipSlot): boolean =>
  d.slots === 'any' || d.slots.includes(slot) || (slot === 'trinket2' && d.slots.includes('trinket1'))

function weightedPick(pool: AffixDef[], rng: Rng): AffixDef {
  const total = pool.reduce((s, d) => s + d.weight, 0)
  let r = rng() * total
  for (const d of pool) { r -= d.weight; if (r < 0) return d }
  return pool[pool.length - 1]
}

/** Roll a gear instance's affixes (CRAWL §7 inverse budget + sim §12): a random 1..maxAffixes distinct
 *  LIVE affixes that fit the slot + are unlocked at the rarity tier, each scaled by perAffixPower ×
 *  loot-tier. STAGED (non-live) affixes are catalogued but never rolled, so every drop functions. */
export function rollAffixes(slot: EquipSlot, rarity: Rarity, lootTier: number, rng: Rng): Affix[] {
  const budget = RARITY[rarity]
  if (budget.maxAffixes === 0) return []
  const eligible = AFFIXES.filter((d) => d.live && d.build && fits(d, slot) && RARITIES.indexOf(rarity) >= RARITIES.indexOf(d.minRarity))
  if (!eligible.length) return []
  const count = 1 + Math.floor(rng() * budget.maxAffixes) // random 1..max — the per-drop variance
  const magUnit = budget.perAffixPower * (1 + lootTier * LOOTTIER_K)
  const out: Affix[] = []
  const used = new Set<string>()
  for (let i = 0; i < count; i++) {
    const pool = eligible.filter((d) => !used.has(d.sys))
    if (!pool.length) break
    const def = weightedPick(pool, rng)
    used.add(def.sys)
    out.push({ id: `${def.sys}_${freshUid()}`, label: def.sys, components: def.build!(magUnit) })
  }
  return out
}
