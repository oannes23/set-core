/* engine/triggers — the reactive trigger bus: condition matching, region/value selectors, and the
   effect vocabulary (TRAP_EFFECTS). Ported from the prototype, made pure: effects mutate CombatState
   and emit events via a sink; no DOM. Shared by traps and tricks (same mechanism, see `kind`). */

import type { Card } from '../core/affine'
import type { Board } from '../core/sets'
import { countSetsExcluding } from '../core/sets'
import type { Rng } from '../core/rng'
import { patch, patchFavor, type FavorBias } from '../core/generate'
import type { Condition, Selector, Bias, Effect, Trigger } from '../data/schema'
import type { CombatState, Pending } from './state'
import { DMG_REGEN_MS } from './state'
import { pushClock, tryWard } from './ops'
import type { EventSink } from './events'
import { type MatchDescriptor, weightedRoll } from './resolve'
import { cardColor, cardShape, cardMag, isLive, liveSlots, pickRandom, gridDims, rowSlots, colSlots } from './select'

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
      const amt = e.scale === 'set_mag' ? scaledBySetMag(desc) : e.amount != null ? e.amount : weightedRoll(e.max ?? 4, rng)
      hurtPlayer(s, amt, s.foe.name, sink)
      return `⚔${amt}`
    }
    case 'instant_attack':
      enemyAttack(s, rng, sink)
      sink.emit({ type: 'enemyStrikes' })
      return 'strikes!'
    case 'advance_timer': {
      const sec = e.scale === 'set_mag' ? scaledBySetMag(desc) : (e.seconds ?? 3)
      s.nextAttackAt -= sec * 1000
      sink.emit({ type: 'clockChanged', deltaSeconds: -sec })
      return `−${sec}s`
    }
    case 'delay_attack': {
      const sec = e.seconds ?? 5
      const applied = pushClock(s, sec, sink)
      return applied > 0 ? `+${applied}s` : null
    }
    case 'enemy_heal': {
      const a = e.amount ?? 4
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

/** A landed standard attack shatters a live rune — a Wound: that slot can't reform for DMG_REGEN_MS.
 *  Stand Ground intercepts the shatter (the board verb) — the DAMAGE still landed (Block's lane). */
export function shatterCard(s: CombatState, rng: Rng, sink: EventSink): void {
  if (tryWard(s, 'shatter', sink)) return
  const [i] = pickRandom(liveSlots(s), 1, rng)
  if (i == null) return
  s.board[i] = null
  s.pending.set(i, { reformAt: s.now + DMG_REGEN_MS })
  sink.emit({ type: 'cardsShattered', slots: [i] })
}

/** The enemy's scheduled (or instant) attack. 0-damage foes (the dummy) can't hurt you. A hit that
 *  beats Block and bites actual HP also shatters a rune (a Wound) — traps that deal damage do not. */
export function enemyAttack(s: CombatState, rng: Rng, sink: EventSink): void {
  const raw = s.foe.damage > 0 ? weightedRoll(s.foe.damage, rng) : 0
  if (raw === 0) {
    sink.emit({ type: 'playerBlocked' })
  } else {
    const hpBefore = s.playerHP
    hurtPlayer(s, raw, s.foe.name, sink)
    if (s.running && s.playerHP < hpBefore) shatterCard(s, rng, sink)
  }
  s.nextAttackAt = s.now + s.foe.cadence * 1000
}

export const EMPTY_DESC: MatchDescriptor = {
  sameColor: null, sameShape: null, sameNumber: null, colors: [0, 0, 0], shapes: [0, 0, 0], numbers: [0, 0, 0],
}

/** Reform-on-tick is handled by the reducer; expose the regen helper it uses (bias-aware).
 *  Locked slots are excluded from the floor count, so the reform restores a MAKEABLE set —
 *  the lock-layer invariant (TRAPS.md §6.1), not just a paper floor through a locked card. */
export function reformSlots(s: CombatState, slots: number[], bias: FavorBias | undefined, rng: Rng): void {
  const fill = slots.filter((i) => s.board[i] == null)
  if (!fill.length) return
  const locked = s.locked.size ? new Set(s.locked.keys()) : undefined
  const next = bias ? patchFavor(s.board, fill, s.gen, rng, bias, locked) : patch(s.board, fill, s.gen, rng, undefined, locked)
  for (const i of fill) {
    s.board[i] = next[i]
    s.pending.delete(i)
  }
}
