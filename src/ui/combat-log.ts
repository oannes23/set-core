/* ui/combat-log — PURE string formatters for the combat log (no DOM, no V). These cover the parts of
   the log with real branching: the exchange "receipt" detail (matches/weapon/crit split, the
   telegraph→slip→soak→guard breakdown) and the newly-surfaced silent mechanics (wound knits, the
   guard no-carry drop, dread escalation, board churn, lock). The app wraps these in <span>/classes and
   feeds them to `log()`. Tested in combat-log.test.ts — keep the logic here, never in app.ts. */
import type { CombatEvent } from '../engine/events'

type SwingMath = Extract<CombatEvent, { type: 'swingMath' }>
type BlockMath = Extract<CombatEvent, { type: 'blockMath' }>

/** The offense breakdown for a rollover swing: matches + weapon + crit. Empty when there's nothing
 *  beyond the headline damage — a bare match with no gear rider and no crit just repeats the number. */
export function offenseRecap(sm: SwingMath | undefined): string {
  if (!sm || (sm.weapon <= 0 && !sm.crit)) return ''
  const bits: string[] = []
  if (sm.matches > 0) bits.push(`${sm.matches} match`)
  if (sm.weapon > 0) bits.push(`+${sm.weapon} gear`)
  if (sm.crit) bits.push(`✦crit ×${sm.mult.toFixed(1)}`)
  return bits.join(' · ')
}

/** The defense breakdown for a landed strike: telegraph reaching you → swings slipped → soak → guard.
 *  Empty when there's no block math (e.g. the unguardable dread bleed). `telegraph` is already the
 *  post-dodge amount the engine reports (state.ts §2.3), so the slip count rides alongside it. */
export function defenseRecap(bm: BlockMath | undefined): string {
  if (!bm) return ''
  const bits: string[] = [`telegraph ${bm.telegraph}`]
  if (bm.dodged > 0) bits.push(`slip ${bm.dodged}`)
  if (bm.soaked > 0) bits.push(`soak −${bm.soaked}`)
  if (bm.block > 0) bits.push(`guard −${bm.block}`)
  return bits.join(' · ')
}

/** The scar count folded onto a strike line: "2 wounds" / "1 wound" / '' when nothing scarred. */
export function woundTail(count: number): string {
  return count > 0 ? `${count} wound${count === 1 ? '' : 's'}` : ''
}

/** The wound-knit at the deal (one mends per draw): "A wound knits — 1 card mends." */
export function knitLine(count: number): string {
  return count <= 1 ? 'A wound knits — 1 card mends.' : `Wounds knit — ${count} cards mend.`
}

/** The guard no-carry drop (BALANCE §2.1): banked Defend that went UNSPENT — it never carries a round. */
export function guardDropLine(wasted: number): string {
  return `Your guard drops — ${wasted} Defend unspent, it doesn't carry.`
}

/** Lock attribution: "2 cards lock (4s)." / unlock: "Cards come free." */
export function lockLine(count: number, seconds: number): string {
  return `${count} card${count === 1 ? '' : 's'} lock${count === 1 ? 's' : ''} (${seconds}s).`
}

/** Board-warp attribution for a transmute with no named trap/trick line of its own (an ambient drift
 *  tick, or a hostile pull that didn't announce). Keeps the source honest without double-narrating. */
export function churnLine(source: 'drift' | 'trap' | 'trick', count: number): string {
  const cards = `${count} card${count === 1 ? '' : 's'}`
  if (source === 'trap') return `A trap twists ${cards}.`
  if (source === 'trick') return `A turn of fortune reshapes ${cards}.`
  return `The board drifts — ${cards} reshape.`
}

export interface DreadStep { level: number; foeMult: number; playerMult: number }

/** The dread-escalation line, fired only when dread NEWLY bites — it crossed the onset, or climbed a
 *  whole step further while already past it. `prev` is the last level we announced (start at 0). Returns
 *  null when there's nothing new to say. Step-gated on the integer level so the 0.5/round rise doesn't
 *  spam a line every rollover. */
export function dreadLine(prev: number, cur: DreadStep, onset: number): string | null {
  if (cur.level < onset || Math.floor(cur.level) <= Math.floor(prev)) return null
  return `Dread rises (${Math.round(cur.level)}) — their blows ×${cur.foeMult.toFixed(1)}, yours ×${cur.playerMult.toFixed(1)}.`
}
