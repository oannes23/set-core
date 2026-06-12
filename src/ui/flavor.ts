/* ui/flavor — combat-log wording: pure, deterministic, testable. The log's DATA spine (exact, bolded
   numbers) lives in app.ts; this module supplies the swappable flavour SKIN — varied verbs + foe voice,
   dialed by event rarity (frequent events whisper, rare ones shout: severity∝rarity for prose).
   Variety is a turn counter, never Math.random, so re-renders stay stable and consecutive lines differ. */

import type { Voice } from '../data/schema'

export type Tier = 'light' | 'med' | 'heavy'

/** Neutral fallback voice for any foe without an authored one — nothing ever breaks. */
export const DEFAULT_VOICE: Required<Voice> = {
  hit: ['strikes', 'lashes at', 'hits'],
  heal: ['mends', 'knits whole'],
  zero: 'flails harmlessly',
}
/** Merge an authored (partial) voice over the default so every field is present. */
export function voiceOf(v: Voice | undefined): Required<Voice> {
  return { hit: v?.hit?.length ? v.hit : DEFAULT_VOICE.hit, heal: v?.heal?.length ? v.heal : DEFAULT_VOICE.heal, zero: v?.zero ?? DEFAULT_VOICE.zero }
}

// magnitude-tiered strike verbs (reuse the engine's light/med/heavy damage feel)
const STRIKE: Record<Tier, string[]> = {
  light: ['a glancing hit', 'a glancing blow', 'a light cut'],
  med: ['a solid strike', 'a clean hit', 'a firm blow'],
  heavy: ['a crushing blow', 'a savage strike', 'a brutal hit'],
}
const POOLS: Record<string, string[]> = {
  heal: ['knit a wound', 'mend a hurt', 'patch yourself up'],
  drain: ['siphons', 'leeches', 'drains', 'bleeds off'],
  magic: ['Your magic bites', 'Your spell sears', 'Arcane fire bites'],
}

// bespoke per-ability cast lines (UI flavour stays out of the engine); caller falls back to "You cast X."
export const ABILITY_FLAVOR: Record<string, string> = {
  firebolt: 'You hurl a <b>Firebolt</b> — it sears the foe and reforges a spent card into flaming Attack',
  frostbolt: 'You loose a <b>Frostbolt</b> — it bites and freezes a dead card into a Frost Move',
  fireball: 'You lob a <b>Fireball</b> — the blast catches a cluster and leaves Fire in its crater',
  cleave: 'You <b>Cleave</b> — steel bites deep and razes a card to heavy Attack',
  berserk: 'You go <b>Berserk</b> — every guard turns to a raised blade',
  rampage: 'You <b>Rampage</b> — every Attack on the board pours into the foe',
  quickstrike: 'You <b>Quick Strike</b> — Attacks land then flow on into Moves',
  bulwark: 'You raise a <b>Bulwark</b> — the board hardens into a wall of Defends',
  glaciate: 'You <b>Glaciate</b> — every blade freezes mid-swing into Move',
  wildgrowth: 'You channel <b>Wildgrowth</b> — the heaviest cards are reaped into life',
  callflames: 'You <b>Call Flames</b> — every cold card erupts into heavy Fire',
  callfrost: 'You <b>Call Frost</b> — the board glazes over into heavy Frost',
  callwilds: 'You <b>Call Wilds</b> — the board greens over into heavy Nature',
  heal: 'You <b>Heal</b> — wounds close and green seeds the board',
  block: 'You raise a <b>Block</b> — Defends churn up a heavier guard',
  smokebomb: 'You drop a <b>Smoke Bomb</b> — the foe gropes blindly, slowed',
  timewarp: 'You bend time — the round stretches and the exchange recedes',
}

let _turn = 0
/** Advance the variety counter once per interpret() batch so repeated actions rotate verbs. */
export function bumpTurn(): void { _turn++ }
/** Deterministic pick (stable across re-renders); salt distinguishes two same-batch picks. */
export function pick(pool: string[], salt = 0): string { return pool[((_turn + salt) % pool.length + pool.length) % pool.length] }
export function strikeWord(tier: Tier, salt = 0): string { return pick(STRIKE[tier], salt) }
export function healWord(salt = 0): string { return pick(POOLS.heal, salt) }
export function drainWord(salt = 0): string { return pick(POOLS.drain, salt) }
export function magicLead(salt = 0): string { return pick(POOLS.magic, salt) }
/** Tier a number against a reference max (foe.damage for hits, a nominal cap for your strikes). */
export function tierOf(amount: number, max: number): Tier {
  const f = max > 0 ? amount / max : 0
  return f >= 0.66 ? 'heavy' : f >= 0.33 ? 'med' : 'light'
}
/** Join clauses naturally: "a", "a and b", "a, b, and c". */
export function joinClauses(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
}
