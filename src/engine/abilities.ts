/* engine/abilities — the full ability pool keyed by id (each class draws 3 into its loadout).
   Ported from the prototype ABILITIES, made pure + DOM-free: a cast mutates CombatState and emits
   events (the UI narrates from the events). Auto-targeting is deterministic via the injected Rng.
   These compose the select.ts targeting toolkit + the triggers.ts transmute verb. */

import type { Rng } from '../core/rng'
import type { FavorBias } from '../core/generate'
import type { CombatState } from './state'
import { clockCapMs } from './state'
import type { EventSink } from './events'
import { weightedRoll } from './resolve'
import { SHAPE_ATTACK, SHAPE_DEFEND, SHAPE_MOVE } from './resolve'
import { transmute, reformSlots } from './triggers'
import { firePassives } from './passives'
import { gainBlock, healPlayer, dealAbilityDamage, castDamageHook, pushClock, addTactics } from './ops'
import {
  COLOR_RED, COLOR_GREEN, COLOR_BLUE, BIAS_W,
  cardColor, cardShape, cardMag, liveSlots, woundedSlots, deadestCandidates,
  randOf, pickPreferred, prefAll, prefLowMag, prefHighMag, prefColorDiverse, offsetSlots, FIREBALL_BLAST,
} from './select'

export interface Ability {
  id: string
  name: string
  icon: string
  cost: [number, number, number] // [red, green, blue] mana
  desc: string
  cast(s: CombatState, rng: Rng, sink: EventSink): void
}

/** A pre-rolled intrinsic hit on the enemy (respects the ethereal mana-spent rule). */
function dealRolled(s: CombatState, max: number, rng: Rng, sink: EventSink): number {
  return dealAbilityDamage(s, weightedRoll(max, rng), sink)
}
const fizzle = (sink: EventSink, id: string) => sink.emit({ type: 'abilityFizzled', id })

export const ABILITIES: Record<string, Ability> = {
  // ---- AUTO-TARGET bolts: aim at a random deadest off-colour card, reforge it toward colour + verb ----
  firebolt: {
    id: 'firebolt', name: 'Firebolt', icon: '🔥', cost: [4, 0, 0], desc: '15 dmg · burns a deadest off-red card → Fire/Attack',
    cast(s, rng, sink) {
      dealRolled(s, 15, rng, sink)
      const pick = randOf(deadestCandidates(s, COLOR_RED), rng)
      if (pick != null) transmute(s, [pick], { bias: { color: COLOR_RED, colorW: BIAS_W, shape: SHAPE_ATTACK, shapeW: BIAS_W } }, sink)
    },
  },
  frostbolt: {
    id: 'frostbolt', name: 'Frostbolt', icon: '❄️', cost: [0, 0, 5], desc: '8 dmg · 5 slow · freezes a deadest off-blue card → Frost/Move',
    cast(s, rng, sink) {
      dealRolled(s, 8, rng, sink)
      pushClock(s, 5, sink) // a 5s slow, now CAPPED at the clock ceiling (respects the clock-cap invariant)
      const pick = randOf(deadestCandidates(s, COLOR_BLUE), rng)
      if (pick != null) transmute(s, [pick], { bias: { color: COLOR_BLUE, colorW: BIAS_W, shape: SHAPE_MOVE, shapeW: BIAS_W } }, sink)
    },
  },
  heal: {
    id: 'heal', name: 'Heal', icon: '💚', cost: [0, 5, 0], desc: '15 HP max · closes wounds + reseeds green',
    cast(s, rng, sink) {
      healPlayer(s, weightedRoll(15, rng), sink)
      const greenBias: FavorBias = { color: COLOR_GREEN, colorW: BIAS_W } // keep green, redraw shape/number
      const roll = Math.floor(rng() * 6) // 0..5 total slots reseeded green
      const wounds = woundedSlots(s).slice(0, roll) // close your wounds FIRST (immediately)...
      const greens = pickPreferred(s, liveSlots(s, (c) => cardColor(c) === COLOR_GREEN), Math.max(0, roll - wounds.length), () => 1, rng)
      if (wounds.length) {
        reformSlots(s, wounds, greenBias, rng) // wounds knit shut now, no cooldown
        sink.emit({ type: 'cardsReformed', slots: wounds })
      }
      if (greens.length) transmute(s, greens, { bias: greenBias }, sink) // chosen greens burst + reform green
    },
  },
  block: {
    id: 'block', name: 'Block', icon: '🛡️', cost: [2, 2, 2], desc: '+10 block · churns up to 3 Defends',
    cast(s, rng, sink) {
      gainBlock(s, 10, rng, sink)
      // scatter up to 3 spent Defend cards — favour colour variety + lighter ones; regen is neutral
      const picks = pickPreferred(s, liveSlots(s, (c) => cardShape(c) === SHAPE_DEFEND), 3, prefAll(prefLowMag, prefColorDiverse), rng)
      if (picks.length) transmute(s, picks, {}, sink)
    },
  },
  // ---- SPATIAL AoE that auto-aims like Firebolt: catches neighbours; damage scales with what it razes ----
  fireball: {
    id: 'fireball', name: 'Fireball', icon: '💥', cost: [7, 0, 0], desc: '13-tile blast on a deadest card (catches neighbors) → Fire/Attack',
    cast(s, rng, sink) {
      const center = randOf(deadestCandidates(s, COLOR_RED), rng)
      const hits = center == null ? [] : offsetSlots(s, center, FIREBALL_BLAST).filter((i) => s.board[i] && !s.pending.has(i) && !s.locked.has(i))
      if (!hits.length) { fizzle(sink, 'fireball'); return }
      const cap = hits.reduce((acc, i) => acc + cardMag(s.board[i]!) + 2, 0) // each razed card worth 2/3/4
      dealAbilityDamage(s, weightedRoll(cap, rng), sink)
      transmute(s, hits, { bias: { color: COLOR_RED, colorW: BIAS_W, shape: SHAPE_ATTACK, shapeW: BIAS_W } }, sink)
    },
  },
  // ---- VALUE-FILTER mass select: freeze EVERY Attack; tempo gained scales with how many ----
  glaciate: {
    id: 'glaciate', name: 'Glaciate', icon: '🧊', cost: [0, 0, 7], desc: 'freeze every Attack → Move + big slow',
    cast(s, rng, sink) {
      const attacks = liveSlots(s, (c) => cardShape(c) === SHAPE_ATTACK)
      if (!attacks.length) { fizzle(sink, 'glaciate'); return }
      pushClock(s, attacks.length * 2, sink) // +2s per frozen Attack, capped
      transmute(s, attacks, { bias: { shape: SHAPE_MOVE, shapeW: BIAS_W } }, sink) // shape-only: stays snappy
    },
  },
  // ---- PREFERENCE by magnitude + NUMBER-axis bias: reap heaviest for HP, leave light green shoots ----
  wildgrowth: {
    id: 'wildgrowth', name: 'Wildgrowth', icon: '🌿', cost: [0, 6, 0], desc: 'reap 3 heaviest → heal + light green',
    cast(s, rng, sink) {
      const picks = pickPreferred(s, liveSlots(s), 3, prefHighMag, rng)
      if (!picks.length) { fizzle(sink, 'wildgrowth'); return }
      const ripeness = picks.reduce((acc, i) => acc + cardMag(s.board[i]!) + 1, 0)
      healPlayer(s, ripeness * 2, sink)
      transmute(s, picks, { bias: { color: COLOR_GREEN, colorW: BIAS_W, mag: 0, magW: BIAS_W } }, sink) // green · light
    },
  },
  // ---- COLOUR FLOODS: off-colour mana dump → reforge the whole board to one element at max magnitude ----
  callflames: {
    id: 'callflames', name: 'Call Flames', icon: '🔥', cost: [0, 4, 4], desc: 'every non-red card → max-magnitude Fire',
    cast(s, _rng, sink) { transmute(s, liveSlots(s, (c) => cardColor(c) !== COLOR_RED), { bias: { color: COLOR_RED, colorW: BIAS_W, mag: 2, magW: BIAS_W } }, sink) },
  },
  callfrost: {
    id: 'callfrost', name: 'Call Frost', icon: '❄️', cost: [4, 4, 0], desc: 'every non-blue card → max-magnitude Frost',
    cast(s, _rng, sink) { transmute(s, liveSlots(s, (c) => cardColor(c) !== COLOR_BLUE), { bias: { color: COLOR_BLUE, colorW: BIAS_W, mag: 2, magW: BIAS_W } }, sink) },
  },
  callwilds: {
    id: 'callwilds', name: 'Call Wilds', icon: '🌿', cost: [4, 0, 4], desc: 'every non-green card → max-magnitude Nature',
    cast(s, _rng, sink) { transmute(s, liveSlots(s, (c) => cardColor(c) !== COLOR_GREEN), { bias: { color: COLOR_GREEN, colorW: BIAS_W, mag: 2, magW: BIAS_W } }, sink) },
  },
  // ---- SHAPE FLOODS / consumers: reshape the board along the verb axis ----
  cleave: {
    id: 'cleave', name: 'Cleave', icon: '🪓', cost: [4, 0, 0], desc: '15 dmg · razes a deadest card → heavy Attack',
    cast(s, rng, sink) {
      dealRolled(s, 15, rng, sink)
      const pick = randOf(deadestCandidates(s, COLOR_RED), rng)
      if (pick != null) transmute(s, [pick], { bias: { shape: SHAPE_ATTACK, shapeW: BIAS_W, mag: 2, magW: BIAS_W } }, sink)
    },
  },
  berserk: {
    id: 'berserk', name: 'Berserk', icon: '😤', cost: [4, 0, 0], desc: 'every Defend → heavy Attack',
    cast(s, _rng, sink) { transmute(s, liveSlots(s, (c) => cardShape(c) === SHAPE_DEFEND), { bias: { shape: SHAPE_ATTACK, shapeW: BIAS_W, mag: 2, magW: BIAS_W } }, sink) },
  },
  rampage: {
    id: 'rampage', name: 'Rampage', icon: '💢', cost: [2, 2, 2], desc: 'damage per Attack on board, then resets them',
    cast(s, rng, sink) {
      const atk = liveSlots(s, (c) => cardShape(c) === SHAPE_ATTACK)
      if (!atk.length) { fizzle(sink, 'rampage'); return }
      const cap = atk.reduce((acc, i) => acc + cardMag(s.board[i]!) + 2, 0) // each Attack worth 2/3/4
      dealAbilityDamage(s, weightedRoll(cap, rng), sink)
      transmute(s, atk, {}, sink)
    },
  },
  bulwark: {
    id: 'bulwark', name: 'Bulwark', icon: '🧱', cost: [2, 2, 2], desc: '+8 block · every non-Defend → heavy Defend',
    cast(s, rng, sink) {
      gainBlock(s, 8, rng, sink)
      transmute(s, liveSlots(s, (c) => cardShape(c) !== SHAPE_DEFEND), { bias: { shape: SHAPE_DEFEND, shapeW: BIAS_W, mag: 2, magW: BIAS_W } }, sink)
    },
  },
  quickstrike: {
    id: 'quickstrike', name: 'Quick Strike', icon: '🗡️', cost: [3, 0, 0], desc: 'damage per Attack, then they flow into Moves',
    cast(s, rng, sink) {
      const atk = liveSlots(s, (c) => cardShape(c) === SHAPE_ATTACK)
      const cap = atk.reduce((acc, i) => acc + cardMag(s.board[i]!) + 1, 0) || 4
      dealRolled(s, cap, rng, sink)
      if (atk.length) transmute(s, atk, { bias: { shape: SHAPE_MOVE, shapeW: BIAS_W } }, sink)
    },
  },
  smokebomb: {
    id: 'smokebomb', name: 'Smoke Bomb', icon: '💨', cost: [0, 3, 0], desc: '+6 block · big enemy slow',
    cast(s, rng, sink) { gainBlock(s, 6, rng, sink); pushClock(s, 8, sink) },
  },
  // ---- GREEN sinks (a mono-green defensive + a mono-green strike) so every class can spend Nature ----
  thornwall: {
    id: 'thornwall', name: 'Thornwall', icon: '🌵', cost: [0, 4, 0], desc: '+8 block · every Attack → heavy Defend (briars)',
    cast(s, rng, sink) {
      gainBlock(s, 8, rng, sink)
      transmute(s, liveSlots(s, (c) => cardShape(c) === SHAPE_ATTACK), { bias: { shape: SHAPE_DEFEND, shapeW: BIAS_W, mag: 2, magW: BIAS_W } }, sink)
    },
  },
  venomstrike: {
    id: 'venomstrike', name: 'Venom Strike', icon: '🐍', cost: [0, 4, 0], desc: '12 dmg · poisons a deadest off-green card → Nature/Attack',
    cast(s, rng, sink) {
      dealRolled(s, 12, rng, sink)
      const pick = randOf(deadestCandidates(s, COLOR_GREEN), rng)
      if (pick != null) transmute(s, [pick], { bias: { color: COLOR_GREEN, colorW: BIAS_W, shape: SHAPE_ATTACK, shapeW: BIAS_W } }, sink)
    },
  },
  thornvines: {
    id: 'thornvines', name: 'Thorn Vines', icon: '🌹', cost: [0, 4, 0], desc: '10 dmg · roots the foe +5s (thorns ensnare)',
    cast(s, rng, sink) { dealRolled(s, 10, rng, sink); pushClock(s, 5, sink) }, // green offence + crowd control
  },
  // ---- BLUE sinks (control/tempo, not just frost-caster) so martial classes can spend Frost too ----
  rally: {
    id: 'rally', name: 'Rally', icon: '📯', cost: [0, 0, 4], desc: 'command the line: +6s clock · bank 4 Tactics',
    cast(s, _rng, sink) { pushClock(s, 6, sink); addTactics(s, 4, sink) },
  },
  coldblade: {
    id: 'coldblade', name: 'Cold Blade', icon: '🥶', cost: [0, 0, 3], desc: '10 dmg · +4s tempo (a frigid strike)',
    cast(s, rng, sink) { dealRolled(s, 10, rng, sink); pushClock(s, 4, sink) },
  },
  riposte: {
    id: 'riposte', name: 'Riposte', icon: '🤺', cost: [0, 0, 4], desc: '+6 block · 8 dmg counter',
    cast(s, rng, sink) { gainBlock(s, 6, rng, sink); dealRolled(s, 8, rng, sink) },
  },
  timewarp: {
    id: 'timewarp', name: 'Time Warp', icon: '⏳', cost: [2, 2, 2], desc: 'slam enemy clock to its cap + 6 dmg',
    cast(s, rng, sink) {
      dealRolled(s, 6, rng, sink)
      const before = s.nextAttackAt
      s.nextAttackAt = s.now + clockCapMs(s)
      const applied = Math.round((s.nextAttackAt - before) / 1000)
      if (applied > 0) sink.emit({ type: 'clockChanged', deltaSeconds: applied })
    },
  },
}

export function canAfford(s: CombatState, cost: [number, number, number]): boolean {
  return cost.every((c, i) => s.mana[i] >= c)
}

/** Pure hover-preview: which slots an ability WOULD act on. `sure` = always hit; `maybe` = a random
 *  pick among these (the cast resolves one). Used by the UI to ring targets on hover. No rng. */
export interface Preview { sure: number[]; maybe: number[] }
const oneOf = (cand: number[]): Preview => (cand.length <= 1 ? { sure: cand.slice(), maybe: [] } : { sure: [], maybe: cand.slice() })
const blastFoot = (s: CombatState, center: number) => offsetSlots(s, center, FIREBALL_BLAST).filter((i) => s.board[i] && !s.pending.has(i) && !s.locked.has(i))

export const ABILITY_PREVIEW: Record<string, (s: CombatState) => Preview> = {
  firebolt: (s) => oneOf(deadestCandidates(s, COLOR_RED)),
  frostbolt: (s) => oneOf(deadestCandidates(s, COLOR_BLUE)),
  cleave: (s) => oneOf(deadestCandidates(s, COLOR_RED)),
  heal: (s) => ({ sure: [], maybe: [...woundedSlots(s), ...liveSlots(s, (c) => cardColor(c) === COLOR_GREEN)] }),
  block: (s) => ({ sure: [], maybe: liveSlots(s, (c) => cardShape(c) === SHAPE_DEFEND) }),
  fireball: (s) => {
    const foots = deadestCandidates(s, COLOR_RED).map((c) => blastFoot(s, c))
    if (foots.length <= 1) return { sure: foots[0] ?? [], maybe: [] }
    const all = [...new Set(foots.flat())]
    const sure = all.filter((j) => foots.every((f) => f.includes(j)))
    return { sure, maybe: all.filter((j) => !sure.includes(j)) }
  },
  glaciate: (s) => ({ sure: liveSlots(s, (c) => cardShape(c) === SHAPE_ATTACK), maybe: [] }),
  wildgrowth: (s) => ({ sure: [], maybe: liveSlots(s).sort((a, b) => cardMag(s.board[b]!) - cardMag(s.board[a]!)).slice(0, 5) }),
  callflames: (s) => ({ sure: liveSlots(s, (c) => cardColor(c) !== COLOR_RED), maybe: [] }),
  callfrost: (s) => ({ sure: liveSlots(s, (c) => cardColor(c) !== COLOR_BLUE), maybe: [] }),
  callwilds: (s) => ({ sure: liveSlots(s, (c) => cardColor(c) !== COLOR_GREEN), maybe: [] }),
  berserk: (s) => ({ sure: liveSlots(s, (c) => cardShape(c) === SHAPE_DEFEND), maybe: [] }),
  rampage: (s) => ({ sure: liveSlots(s, (c) => cardShape(c) === SHAPE_ATTACK), maybe: [] }),
  quickstrike: (s) => ({ sure: liveSlots(s, (c) => cardShape(c) === SHAPE_ATTACK), maybe: [] }),
  bulwark: (s) => ({ sure: liveSlots(s, (c) => cardShape(c) !== SHAPE_DEFEND), maybe: [] }),
  thornwall: (s) => ({ sure: liveSlots(s, (c) => cardShape(c) === SHAPE_ATTACK), maybe: [] }),
  venomstrike: (s) => oneOf(deadestCandidates(s, COLOR_GREEN)),
  // smokebomb / timewarp: no board target
}

/** Cast an ability: spend mana, run its effect, fire ability-passives (Spell Echo). No-op if unaffordable
 *  or unknown. Returns whether it fired (the reducer does the post-cast win check). */
export function castAbility(s: CombatState, id: string, rng: Rng, sink: EventSink): boolean {
  const ab = ABILITIES[id]
  if (!ab || !s.running || !canAfford(s, ab.cost)) return false
  for (let i = 0; i < 3; i++) s.mana[i] -= ab.cost[i]
  sink.emit({ type: 'abilityCast', id, mana: [ab.cost[0], ab.cost[1], ab.cost[2]] })
  castDamageHook(s, ab.cost, sink) // ethereal goblin: drain by mana spent
  ab.cast(s, rng, sink)
  firePassives(s, 'ability', null, rng, sink) // e.g. Spellblade's Spell Echo
  return true
}
