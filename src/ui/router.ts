/* ui/router — the scene shell: the single DOM root, scene mount + teardown, scene-scoped timers, and
   the one shared hover tooltip. Pure DOM (no unit tests — verified by build + smoke). The teardown
   ORDER is load-bearing (several past stray-FX / dangling-listener bugs lived here), so the sequence
   below is preserved exactly. app.ts registers a per-scene teardown via `setSceneTeardown` (kills the
   live combat View + the coaching layer) because the router can't see those module globals. */

import { $ } from './dom'

let ROOT: HTMLElement | null = null
let lastSceneMount: ((root: HTMLElement) => void) | null = null
let sceneTimers: number[] = []
let onSceneLeave: (() => void) | null = null

/* Body-level singleton overlays swept on every scene change (their own cleanup timers die with the
   scene). Anything appended to <body> (not ROOT) belongs here, and any scene-scoped delay must use
   sceneTimeout — then no scene leaks FX, listeners, or timers onto the next. */
const BODY_SINGLETONS = ['coachscrim', 'coachpop', 'briefing', 'burstlayer', 'bamlayer', 'ptint', 'levelup', 'xbreak']

/** Install the app's DOM root (called once from mountApp). */
export function setRoot(el: HTMLElement): void {
  ROOT = el
}
/** Register the per-scene teardown (V + coaching) the router invokes before swapping scenes. */
export function setSceneTeardown(fn: () => void): void {
  onSceneLeave = fn
}
/** Re-mount the current scene (used on a dev-mode flip so static scenes re-resolve). No-op pre-mount. */
export function remountScene(): void {
  if (lastSceneMount) goScene(lastSceneMount)
}

/** A setTimeout scoped to the current scene — cleared automatically on the next scene change. */
export function sceneTimeout(fn: () => void, ms: number): number {
  const id = window.setTimeout(fn, ms)
  sceneTimers.push(id)
  return id
}

/** Swap to a new scene: tear down the live view + every scene-scoped artifact (timers, tooltip,
   modal listener, coaching, body singletons, stray FX), then mount fresh. Order preserved. */
export function goScene(mount: (root: HTMLElement) => void): void {
  if (!ROOT) return
  lastSceneMount = mount
  onSceneLeave?.() // app: stop the combat loop (cancel raf, drop V) + coachTeardown — before its DOM goes away
  for (const id of sceneTimers) clearTimeout(id)
  sceneTimers = []
  clearTimeout(tipTimer)
  hideTip()
  ;(document.getElementById('confirmmodal') as (HTMLElement & { _cancel?: () => void }) | null)?._cancel?.() // full cleanup (keydown listener)
  for (const id of BODY_SINGLETONS) document.getElementById(id)?.remove()
  document.body.classList.remove('xbreak-on') // the breakdown-popover dim never survives a scene change
  document.querySelectorAll('.mspark, .flycard').forEach((e) => e.remove()) // body-level FX strays (their cleanup timers died above)
  ROOT.innerHTML = ''
  mount(ROOT)
}

/* ============================================================
   TOOLTIPS — one shared, styled, fast hover tooltip (replaces native `title`, which is slow + ugly).
   Any element with `data-tip` (body) and/or `data-tip-title` (header) gets it, via one delegated
   listener. Anchored above the element (flips below if no room), pointer-events-none, snappy delay.
   ============================================================ */
let tipEl: HTMLElement | null = null
let tipTimer = 0
const TIP_SEL = '[data-tip],[data-tip-title]'
export function initTooltips(): void {
  if (tipEl) return // once
  tipEl = $(`<div id="tooltip"></div>`)
  document.body.appendChild(tipEl)
  document.addEventListener('mouseover', (e) => {
    const el = (e.target as HTMLElement).closest?.(TIP_SEL) as HTMLElement | null
    if (!el) return
    clearTimeout(tipTimer)
    tipTimer = window.setTimeout(() => showTip(el), 80) // pops far quicker than native title
  })
  document.addEventListener('mouseout', (e) => {
    const el = (e.target as HTMLElement).closest?.(TIP_SEL) as HTMLElement | null
    if (el && !el.contains((e as MouseEvent).relatedTarget as Node)) { clearTimeout(tipTimer); hideTip() }
  })
  document.addEventListener('mousedown', () => { clearTimeout(tipTimer); hideTip() }) // never let a tip (or a pending one) linger over a click
}
function showTip(el: HTMLElement): void {
  if (!tipEl || !el.isConnected) return
  const title = el.dataset.tipTitle ?? ''
  const body = el.dataset.tip ?? ''
  if (!title && !body) return
  tipEl.innerHTML = `${title ? `<div class="tt-title">${title}</div>` : ''}${body ? `<div class="tt-body">${body}</div>` : ''}`
  tipEl.classList.add('show') // measurable now
  const r = el.getBoundingClientRect()
  const tr = tipEl.getBoundingClientRect()
  const left = Math.max(8, Math.min(r.left + r.width / 2 - tr.width / 2, window.innerWidth - tr.width - 8))
  const above = r.top - tr.height - 8
  const below = above < 8
  tipEl.style.left = `${left}px`
  tipEl.style.top = `${below ? r.bottom + 8 : above}px`
  tipEl.classList.toggle('below', below)
}
function hideTip(): void { tipEl?.classList.remove('show') }
