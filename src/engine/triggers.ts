/* engine/triggers — the reactive trigger bus: condition matching, region/value selectors, and the
   effect vocabulary (TRAP_EFFECTS). Ported from the prototype, made pure: effects mutate CombatState
   and emit events via a sink; no DOM. Shared by traps and tricks (same mechanism, see `kind`). */

import type { Card } from '../core/affine'
import type { Board } from '../core/sets'
import { countSetsExcluding } from '../core/sets'
import type { Rng } from '../core/rng'
import type { FavorBias } from '../core/generate'
import type { Condition, Selector, Bias, Effect, Trigger } from '../data/schema'
import type { CombatState, Pending } from './state'
import { WOUND_CAP_PER_EXCHANGE, woundQuantum } from './state'
import { extendRound, shortenRound, tryWard, reformSlots } from './ops'
import type { EventSink } from './events'
import { type MatchDescriptor, weightedRoll } from './resolve'
import { cardColor, cardShape, cardMag, isLive, liveSlots, pickRandom, gridDims, rowSlots, colSlots } from './select'

/** ⚠ LEGACY SCALE: trap/trick damage + enemy-heal amounts in game-data are still authored against
 *  the HP-30 world; this converts them to the HP-100 rebase in ONE place. The data rebase
 *  (numbers workshop) re-authors the amounts and retires this. */
const LEGACY_DMG_SCALE = 10 / 3
const legacyDmg = (n: number): number => Math.max(1, Math.round(n * LEGACY_DMG_SCALE))

const TOKEN_COLOR: Record<string, number> = { red: 0, green: 1, blue: 2 }
const TOKEN_SHAPE: Record<string, number> = { attack: 0, defend: 1, move: 2 }
const TOKEN_NUMBER: Record<string, number> = { one: 0, two: 1, three: 2 }
const BIAS_W = 8

/** Resolve a token value on an axis to its numeric index. */
function tokVal(axis: string, v: string): number {
  if (axis === 'color') return TOKEN_COLOR[v] ?? 0
  if (axis === 'shape') return TOKEN_SHAPE[v] ?? 0
  return TOKEN_NUMBER[v] ?? 0
}
function descAxisValue(desc: MatchDescriptor, axis: string): number | null {
  return axis === 'color' ? desc.sameColor : axis === 'shape' ? desc.sameShape : desc.sameNumber
}
function descAxisValues(desc: MatchDescriptor, axis: string): [number, number, number] {
  return axis === 'color' ? desc.colors : axis === 'shape' ? desc.shapes : desc.numbers
}

/** Does this match satisfy the trigger's condition? Supports compound `all` (AND). */
export function condMet(when: Condition | undefined, desc: MatchDescriptor): boolean {
  if (!when) return true
  if ('all' in when) return when.all.every((c) => condMet(c, desc))
  const v = descAxisValue(desc, when.axis)
  const target = when.value != null ? tokVal(when.axis, when.value) : null
  switch (when.mode) {
    case 'all_same':
      return target != null ? v === target : v != null
    case 'all_different':
      return v == null
    case 'contains':
      return target != null && descAxisValues(desc, when.axis).includes(target)
    case 'not_value':
      return v != null && v !== target
    default:
      return true
  }
}

// ---- selectors ----
function liveAt(s: CombatState, idxs: number[]): number[] {
  return idxs.filter((i) => isLive(s, i))
}

function geometrySlots(s: CombatState, sel: Selector, rng: Rng): number[] {
  const { cols, rows } = gridDims(s)
  const which = sel.which
  let idxs: number[] = []
  switch (sel.geometry) {
    case 'row':
      idxs = rowSlots(s, sel.index ?? (which === 'top' ? 0 : which === 'bottom' ? rows - 1 : which === 'center' ? rows >> 1 : Math.floor(rng() * rows)))
      break
    case 'column':
      idxs = colSlots(s, sel.index ?? (which === 'left' ? 0 : which === 'right' ? cols - 1 : which === 'center' ? cols >> 1 : Math.floor(rng() * cols)))
      break
    case 'corners':
      idxs = [0, cols - 1, (rows - 1) * cols, (rows - 1) * cols + cols - 1].filter((j) => j >= 0 && j < s.board.length)
      break
    case 'border':
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) { const j = r * cols + c; if (j < s.board.length) idxs.push(j) }
      break
    case 'center':
    case 'inner':
      for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) { const j = r * cols + c; if (j < s.board.length) idxs.push(j) }
      break
    case 'diagonal': {
      const len = Math.min(rows, cols)
      for (let k = 0; k < len; k++) { const c = which === 'anti' ? cols - 1 - k : k; idxs.push(k * cols + c) }
      break
    }
    case 'half':
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const half = which === 'bottom' ? r >= rows / 2 : which === 'left' ? c < cols / 2 : which === 'right' ? c >= cols / 2 : r < rows / 2
        if (half) { const j = r * cols + c; if (j < s.board.length) idxs.push(j) }
      }
      break
    case 'random':
      return pickRandom(liveSlots(s), sel.count ?? 3, rng)
    default:
      idxs = []
  }
  return liveAt(s, idxs)
}

/** Resolve a selector into live board slots: a region and/or a value filter (intersected). */
export function selectSlots(s: CombatState, sel: Selector, rng: Rng): number[] {
  let slots = sel.geometry ? geometrySlots(s, sel, rng) : liveSlots(s)
  if (sel.axis != null && sel.value != null) {
    const get = sel.axis === 'color' ? cardColor : sel.axis === 'shape' ? cardShape : cardMag
    const target = tokVal(sel.axis, sel.value)
    const pred = sel.mode === 'not_value' ? (c: Card) => get(c) !== target : (c: Card) => get(c) === target
    slots = slots.filter((i) => pred(s.board[i] as Card))
  }
  if (sel.pick === 'highest_mag') slots.sort((a, b) => cardMag(s.board[b] as Card) - cardMag(s.board[a] as Card))
  return slots
}

function biasFromSpec(b: Bias | undefined): FavorBias | undefined {
  if (!b) return undefined
  const w = Math.max(1, Math.round(BIAS_W * (b.intensity ?? 1)))
  if (b.axis === 'color') return { color: tokVal('color', b.value), colorW: w }
  if (b.axis === 'shape') return { shape: tokVal('shape', b.value), shapeW: w }
  return { mag: tokVal('number', b.value), magW: w }
}

// ---- board verbs (pure: mutate state.board / pending / locked, emit events) ----

/** Transmute slots: destroy now, reform after `gapMs` (0 = next reform tick). Regen optionally biased.
 *  `source` attributes the pull for the UI's tug readability (undefined = a player cast). */
export function transmute(s: CombatState, slots: number[], opts: { bias?: FavorBias; gapMs?: number; hostile?: boolean; source?: 'churn' | 'drift' | 'trap' | 'trick' }, sink: EventSink): void {
  const live = slots.filter((i) => isLive(s, i))
  if (!live.length) return
  for (const i of live) {
    s.board[i] = null
    const p: Pending = { reformAt: s.now + (opts.gapMs ?? 0) }
    if (opts.bias) p.bias = opts.bias
    s.pending.set(i, p)
  }
  sink.emit({ type: 'cardsTransmuted', slots: live, gapMs: opts.gapMs ?? 0, hostile: opts.hostile, source: opts.source })
}

/** Makeable sets that don't use any locked slot — the lock floor (never lock below FLOOR makeable). */
function makeableSetCount(board: Board, lockedKeys: Set<number>): number {
  return countSetsExcluding(board, lockedKeys)
}

/** Lock slots for `durationMs`, honoring the makeable-set floor (FLOOR completable from unlocked cards). */
export function lockSlots(s: CombatState, slots: number[], durationMs: number, sink: EventSink): number {
  const cand = [...new Set(slots)].filter((i) => s.board[i] != null && !s.pending.has(i) && !s.locked.has(i))
  const locked: number[] = []
  const tentative = new Set(s.locked.keys())
  for (const i of cand) {
    tentative.add(i)
    if (makeableSetCount(s.board, tentative) >= s.gen.floor) {
      s.locked.set(i, s.now + durationMs)
      locked.push(i)
    } else {
      tentative.delete(i) // would drop below floor — skip this one
    }
  }
  if (locked.length) sink.emit({ type: 'cardsLocked', slots: locked, untilMs: s.now + durationMs })
  return locked.length
}

// ---- effects ----

/** Severity scaled by the springing set's TOTAL magnitude (CRAWL tuning, the "Confusion v2" law):
 *  a modest 1+2+3 rainbow pays the old mild price; a greedy 3/3/3 set pays for its weight.
 *  total 6 → 2 · total 9 → 5 (clamped ≥1; tick triggers with no match descriptor resolve to 1). */
function scaledBySetMag(desc: MatchDescriptor): number {
  const total = desc.numbers[0] + desc.numbers[1] + desc.numbers[2] + 3 // numbers are 0-indexed magnitudes
  return Math.max(1, total - 4)
}

function runEffect(s: CombatState, e: Effect, desc: MatchDescriptor, rng: Rng, sink: EventSink, hostile: boolean, wardable: boolean): string | null {
  if (e.chance != null && rng() >= e.chance) return null
  switch (e.effect) {
    case 'damage': {
      const raw = e.scale === 'set_mag' ? scaledBySetMag(desc) : e.amount != null ? e.amount : weightedRoll(e.max ?? 4, rng)
      const amt = legacyDmg(raw)
      hurtPlayer(s, amt, s.foe.name, sink)
      return `⚔${amt}`
    }
    case 'instant_attack':
      enemyAttack(s, rng, sink)
      sink.emit({ type: 'enemyStrikes' })
      return 'strikes!'
    case 'advance_timer': {
      // v3: the enemy yanks the ROUND shorter — the exchange comes sooner
      const sec = e.scale === 'set_mag' ? scaledBySetMag(desc) : (e.seconds ?? 3)
      const applied = shortenRound(s, sec, sink)
      return applied > 0 ? `−${applied}s` : null
    }
    case 'delay_attack': {
      const sec = e.seconds ?? 5
      const applied = extendRound(s, sec, sink)
      return applied > 0 ? `+${applied}s` : null
    }
    case 'enemy_heal': {
      const a = legacyDmg(e.amount ?? 4)
      const before = s.enemyHP
      s.enemyHP = Math.min(s.enemyMax, s.enemyHP + a)
      const healed = s.enemyHP - before
      if (healed > 0) sink.emit({ type: 'enemyHealed', amount: healed })
      return healed > 0 ? `enemy +${healed}` : null
    }
    case 'drain_tactics': {
      // v2: drains queued/banked CHARGES (the amounts in data were tuned for the 0-10 meter — halve, min 1)
      const a = Math.max(1, Math.round((e.amount ?? 4) / 2))
      const drained = Math.min(s.charges, a)
      s.charges -= drained
      if (drained > 0) sink.emit({ type: 'chargesDrained', amount: drained })
      return drained > 0 ? `−${drained} charge${drained > 1 ? 's' : ''}` : null
    }
    case 'drain_mana': {
      const c = e.color != null ? tokVal('color', e.color) : 0
      const a = e.amount ?? 3
      const before = s.mana[c]
      s.mana[c] = Math.max(0, s.mana[c] - a)
      const drained = before - s.mana[c]
      if (drained > 0) sink.emit({ type: 'manaDrained', color: c, amount: drained })
      return drained > 0 ? `−${drained}` : null
    }
    case 'transmute': {
      if (wardable && tryWard(s, 'transmute', sink)) return '🛡warded' // Stand Ground eats the reshape
      let slots = e.select ? selectSlots(s, e.select, rng) : []
      // an ordered pick (highest_mag) takes the TOP of the sort; only unordered picks sample randomly
      if (e.count != null && slots.length > e.count) slots = e.select?.pick === 'highest_mag' ? slots.slice(0, e.count) : pickRandom(slots, e.count, rng)
      if (!slots.length) return null
      // attribution for the tug: a punishing trap, a favorable trick, or the quiet ambient drift
      const source = !wardable ? ('trick' as const) : hostile ? ('trap' as const) : ('drift' as const)
      transmuteFor(s, slots, biasFromSpec(e.bias), e.gap ?? 0, hostile, source, sink)
      return `↯${slots.length}`
    }
    case 'lock': {
      if (wardable && tryWard(s, 'lock', sink)) return '🛡warded'
      let slots = e.select ? selectSlots(s, e.select, rng) : []
      if (e.count != null && slots.length > e.count) slots = e.select?.pick === 'highest_mag' ? slots.slice(0, e.count) : pickRandom(slots, e.count, rng)
      const n = lockSlots(s, slots, (e.seconds ?? 4) * 1000, sink)
      return n ? `🔒${n}` : null
    }
    default:
      return null
  }
}

/** transmute with a regen that may favour a bias — the actual reform happens on a tick (gap), but we
 *  precompute the reform via patch/patchFavor at reform time. Here we just mark pending (see tick). */
function transmuteFor(s: CombatState, slots: number[], bias: FavorBias | undefined, gapMs: number, hostile: boolean, source: 'trap' | 'trick' | 'drift', sink: EventSink): void {
  transmute(s, slots, { gapMs, hostile, source, ...(bias ? { bias } : {}) }, sink)
}

/** Apply a single trigger's effects; emit `triggerSprung` if anything landed. */
export function runTrigger(s: CombatState, trigger: Trigger, desc: MatchDescriptor, rng: Rng, sink: EventSink): void {
  // a trap razing your cards reads as aggression (boom); a favorable trick or ambient drift stays calm (morph)
  const hostile = trigger.kind !== 'trick' && !trigger.quiet
  // Stand Ground intercepts every non-trick board verb — including quiet ambient drift (it's still
  // the enemy pulling the rope), but never a favorable trick (don't ward your own gifts)
  const wardable = trigger.kind !== 'trick'
  const labels: string[] = []
  for (const eff of trigger.do) {
    const r = runEffect(s, eff, desc, rng, sink, hostile, wardable)
    if (r != null) labels.push(r)
    if (!s.running) break // an effect ended the fight — don't run the rest against a settled state
  }
  if (labels.length) sink.emit({ type: 'triggerSprung', trigger, label: labels.join(' · ') })
}

/** Fire all foe triggers matching this event (`match` checks the condition; `tick` is gated upstream). */
export function fireTriggers(s: CombatState, on: 'match' | 'tick', desc: MatchDescriptor, rng: Rng, sink: EventSink): void {
  if (!s.running) return
  for (const t of s.foe.triggers) {
    if (t.on !== on) continue
    if (on === 'match' && !condMet(t.when, desc)) continue
    runTrigger(s, t, desc, rng, sink)
    if (!s.running) return
  }
}

// ---- shared combatant ops (used by effects + the reducer) ----

export function hurtPlayer(s: CombatState, raw: number, source: string, sink: EventSink): void {
  const absorbed = Math.min(s.block, raw)
  s.block -= absorbed
  const dmg = raw - absorbed
  if (dmg > 0) {
    s.playerHP = Math.max(0, s.playerHP - dmg)
    sink.emit({ type: 'playerDamaged', amount: dmg, absorbed, source })
    if (s.playerHP <= 0 && s.running) { // guard: never emit `lost` twice (multi-effect triggers)
      s.running = false
      s.result = 'lose'
      sink.emit({ type: 'lost' })
    }
  } else {
    sink.emit({ type: 'playerBlocked' })
  }
}

/** The v3 WOUND LAW (CRAWL §5.6 — computed, never authored): wounds = floor(hpDamage / (maxHP/10)),
 *  capped per exchange. Each wound shatters a live rune; it never time-reforms — one knits per draw
 *  phase, heals repair by law, all reform at combat end. Stand Ground intercepts each wound for 3
 *  charges (the backstop — Defend allocation is the PRIMARY prevention, since wounds key to damage
 *  SUFFERED). The HP damage itself already landed (Block's lane). */
export function inflictWounds(s: CombatState, hpDamage: number, rng: Rng, sink: EventSink): void {
  if (hpDamage <= 0) return
  const n = Math.min(WOUND_CAP_PER_EXCHANGE, Math.floor(hpDamage / woundQuantum(s)))
  const shattered: number[] = []
  for (let k = 0; k < n; k++) {
    if (tryWard(s, 'shatter', sink)) continue
    // FLOOR-AWARE pick (the lock-layer invariant, TRAPS §6 / CLAUDE.md hard rule 2 — the
    // floor-stress test caught blind picks breaking the makeable floor in ~13% of
    // locks-then-wounds exchanges): prefer a live slot whose shatter keeps ≥ floor sets
    // makeable from live, unlocked cards; else the wound consumes a LOCKED card (out of reach
    // anyway — the shatter eats the lock with it); else any live slot (no floor-preserving
    // option exists — the 1-knit-per-draw-phase law is the recovery path).
    const live = liveSlots(s)
    const lockedKeys = [...s.locked.keys()]
    const keepers = live.filter((j) => countSetsExcluding(s.board, new Set([...lockedKeys, j])) >= s.gen.floor)
    let i: number | undefined = pickRandom(keepers, 1, rng)[0]
    if (i == null) {
      const lockedLive = lockedKeys.filter((j) => s.board[j] != null && !s.pending.has(j))
      i = pickRandom(lockedLive, 1, rng)[0]
      if (i != null) s.locked.delete(i)
    }
    if (i == null) i = pickRandom(live, 1, rng)[0]
    if (i == null) break
    s.board[i] = null
    s.pending.set(i, { reformAt: 0, wound: true }) // never time-reforms (the reducer skips wound pendings)
    shattered.push(i)
  }
  if (shattered.length) sink.emit({ type: 'cardsShattered', slots: shattered })
}

/** An INSTANT attack (trap `instant_attack` effects) — lands mid-round, outside the exchange.
 *  Rolls fresh (traps stay surprising; the telegraph stays honest), consumes Block, and wounds
 *  by the law against its own bite. 0-damage foes (the dummy) can't hurt you. */
export function enemyAttack(s: CombatState, rng: Rng, sink: EventSink): void {
  const raw = s.foe.damage > 0 ? weightedRoll(s.foe.damage, rng) : 0
  if (raw === 0) {
    sink.emit({ type: 'playerBlocked' })
    return
  }
  const bite = Math.max(0, raw - s.block)
  hurtPlayer(s, raw, s.foe.name, sink)
  if (s.running && bite > 0) inflictWounds(s, bite, rng, sink)
}

export const EMPTY_DESC: MatchDescriptor = {
  sameColor: null, sameShape: null, sameNumber: null, colors: [0, 0, 0], shapes: [0, 0, 0], numbers: [0, 0, 0],
}

/** The regen helper moved to ops.ts (healPlayer's wound repair needs it without a cycle);
 *  re-exported here so existing imports (combat, abilities) keep working. */
export { reformSlots }
