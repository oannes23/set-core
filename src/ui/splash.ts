/* ui/splash — pure decision logic for the skippable breakdown cinematic (the exchange / win / spoils
   ledger). Kept out of app.ts so the click semantics are unit-testable. The DOM sequencing lives in
   playBreakdown; this only answers "given the current state, what does THIS click do?". */

export type SkipAction =
  | 'flush' // 3+ rapid clicks — fast-forward straight to the end
  | 'start' // clicked during the intro, before the first panel — begin it now
  | 'complete' // a panel is mid-animation — pop the rest of its terms (it still keeps its normal wait)
  | 'advance' // a panel finished and is in its wait — skip the wait, go to the next panel
  | 'finish' // the last panel is in its wait — release the cinematic

/** What a skip click does, from the cinematic's current state. `cur` is the current panel (−1 = intro
 *  not yet past), `panelDone` is whether the current panel's terms are all in (it's in its wait). A burst
 *  of `rapidThreshold` clicks inside the rapid window flushes regardless of where we are. */
export function skipAction(cur: number, panelDone: boolean, lastIndex: number, rapidCount: number, rapidThreshold: number): SkipAction {
  if (rapidCount >= rapidThreshold) return 'flush'
  if (cur < 0) return 'start'
  if (!panelDone) return 'complete'
  return cur >= lastIndex ? 'finish' : 'advance'
}

/** Roll the click timestamps to those inside the rapid window and append `now` — the length is the live
 *  rapid-click count. Pure (returns a new array); the caller keeps the result as its rolling buffer. */
export function rollClicks(prev: number[], now: number, windowMs: number): number[] {
  return [...prev.filter((t) => now - t < windowMs), now]
}
