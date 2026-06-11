/* ui/app — a functional, playable UI over the engine. Renders the board/HUD, turns clicks into
   `completeSet` actions, runs the clock via `tick`, and interprets CombatEvents into feedback.
   Intentionally a clean rebuild (not pixel-parity with the prototype). Layout: a compact board on the
   left + a side rail (abilities/tactics stub, combat log) on the right — the abilities panel goes live
   in step 5. Plays the reactive board game: matches, traps & tricks, Tactics meter, enemy clock, gauntlets. */

import { systemRng, type Rng } from '../core/rng'
import { type Card, isSet, third, keyOf } from '../core/affine'
import { findSets, kOfSet } from '../core/sets'
import type { GenConfig } from '../core/generate'
import { GAMEDATA } from '../data/game-data'
import type { Dungeon, Trigger, Condition } from '../data/schema'
import { CLASSES, classById } from '../data/classes'
import { ABILITIES, canAfford, ABILITY_PREVIEW } from '../engine/abilities'
import { SHAPE_MOVE, matchDescriptor } from '../engine/resolve'
import { condMet } from '../engine/triggers'
import { PASSIVES } from '../engine/passives'
import { assembleFoe, pickWeightedFoe } from '../engine/foe'
import { colsForN, COMBAT_GEN, type Deps, type CombatAction } from '../engine/combat'
import { createRun, runReduce, type RunState } from '../engine/run'
import { CONSUMABLES } from '../engine/consumables'
import type { CombatState } from '../engine/state'
import { CHARGE_CAP, START_GRACE_MS } from '../engine/state'
import type { CombatEvent } from '../engine/events'
import { bumpTurn, pick, strikeWord, healWord, drainWord, magicLead, tierOf, joinClauses, voiceOf, ABILITY_FLAVOR } from './flavor'
import { type SavedChar, loadRoster, upsertChar, deleteChar, makeChar, freshId, CONSUMABLE_SLOTS } from './save'

const GEN: GenConfig = COMBAT_GEN
const $ = <T extends HTMLElement>(html: string): T => {
  const t = document.createElement('template')
  t.innerHTML = html.trim()
  return t.content.firstChild as T
}

// ---- card glyphs: Lucide line icons (MIT) — Attack=swords, Defend=shield, Move=footprints ----
const CARD_HEX = ['#f0565b', '#46c46a', '#5b94f5'] // red / green / blue (matches --c0/c1/c2)
interface SvgPart { tag: string; attr: Record<string, string | number>; fill?: boolean }
const SHAPE_PARTS: SvgPart[][] = [
  [ // swords (Attack)
    { tag: 'polyline', attr: { points: '14.5 17.5 3 6 3 3 6 3 17.5 14.5' } },
    { tag: 'line', attr: { x1: 13, x2: 19, y1: 19, y2: 13 } },
    { tag: 'line', attr: { x1: 16, x2: 20, y1: 16, y2: 20 } },
    { tag: 'line', attr: { x1: 19, x2: 21, y1: 21, y2: 19 } },
    { tag: 'polyline', attr: { points: '14.5 6.5 18 3 21 3 21 6 17.5 9.5' } },
    { tag: 'line', attr: { x1: 5, x2: 9, y1: 14, y2: 18 } },
    { tag: 'line', attr: { x1: 7, x2: 4, y1: 17, y2: 20 } },
    { tag: 'line', attr: { x1: 3, x2: 5, y1: 19, y2: 21 } },
  ],
  [{ tag: 'path', fill: true, attr: { d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z' } }], // shield (Defend)
  [ // footprints (Move)
    { tag: 'path', fill: true, attr: { d: 'M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z' } },
    { tag: 'path', fill: true, attr: { d: 'M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z' } },
    { tag: 'path', attr: { d: 'M16 17h4' } },
    { tag: 'path', attr: { d: 'M4 13h4' } },
  ],
]
const GLYPH_T = `translate(${50 - 12 * 1.85},${22 - 12 * 1.85}) scale(1.85)` // fit 24x24 Lucide into the 100x44 box
function partMarkup(p: SvgPart, hex: string): string {
  const attrs = Object.entries(p.attr).map(([k, v]) => `${k}="${v}"`).join(' ')
  return p.fill
    ? `<${p.tag} ${attrs} fill="${hex}"/>`
    : `<${p.tag} ${attrs} fill="none" stroke="${hex}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
}
/** A card as inline SVG: number+1 stacked shape glyphs (count = the number trait), recoloured by colour. */
function cardSVG(card: Card): string {
  const hex = CARD_HEX[card[0]]
  const inner = SHAPE_PARTS[card[1]].map((p) => partMarkup(p, hex)).join('')
  const n = card[3] + 1
  const gap = 52
  const startY = 80 - (n * gap) / 2 + gap / 2
  let glyphs = ''
  for (let s = 0; s < n; s++) glyphs += `<g transform="translate(10,${startY + s * gap - 22})"><g transform="${GLYPH_T}">${inner}</g></g>`
  return `<svg class="cardsvg" viewBox="0 0 120 160" preserveAspectRatio="xMidYMid meet">${glyphs}</svg>`
}

interface View {
  root: HTMLElement
  deps: Deps
  /** the run layer (gauntlet today; the crawl's room chain in B2) — owns combat progression */
  run: RunState
  /** the CURRENT combat (always === run.combat; kept as a direct ref for render-path brevity) */
  state: CombatState
  /** the persisted character playing this run (HP is written back on combat end) */
  char: SavedChar
  /** the session action log — every mutation goes through here (the step-6 seam) */
  actions: CombatAction[]
  classId: string
  loadout: string[] // the chosen class's ability ids (the active grid)
  coach: boolean // affordance arrows on (Training / Tutorial dungeons)
  coachCue: 'moves' | 'mana' | null // the guided stage's card cue (Move glow / mana-colour glow)
  manaColor: number // the colour the loadout needs most (dominant total cost) — glowed in the mana stage
  paused: boolean // coaching/briefing freeze gate — the clock loop stops dispatching ticks
  hitstopUntil: number // performance.now() until which ticks are frozen (impact freeze)
  preview: number[] | null // board slots currently ringed by an ability hover
  selected: number[]
  raf: number
  lastT: number
  boardSig: string
  refs: Record<string, HTMLElement>
  /** running combat tallies for the end-of-combat contribution chart (UI-only, replay-safe) */
  stats: { dealt: number; taken: number; blocked: number; healed: number; sets: number; traps: number }
  /** slot → who pulled it (consumed when the slot's new card renders — the tug-attribution tint) */
  morphSrc: Map<number, 'churn' | 'drift' | 'trap' | 'trick'>
  /** the always-on dev balance instruments (TRAPS §5.5 targets etc.) — display-only, replay-safe */
  dev: { reshapeYou: number; reshapeFoe: number; matches: number; springs: number; k1: number; wards: number; churns: number }
}
let V: View | null = null

export function mountApp(root: HTMLElement): void {
  initTooltips()
  ROOT = root
  goScene(characterSelectScene)
}

/* ============================================================
   SCENE ROUTER — every scene transition goes through goScene(): unmount the previous scene
   (cancel its rAF, flush every scene-scoped timer, sweep body-level singletons), clear the
   root, then mount. THE CONTRACT: anything a scene appends to document.body (not root) must
   be in BODY_SINGLETONS, and any scene-scoped delay must use sceneTimeout — then no scene
   can paint, tick, or burst over the next one.
   ============================================================ */
let ROOT: HTMLElement | null = null
// the briefing/coach/FX/vignette layers live on <body>; #tooltip is app-global (hidden, not swept)
const BODY_SINGLETONS = ['coachscrim', 'coachpop', 'briefing', 'burstlayer', 'ptint']
let sceneTimers: number[] = []
/** A setTimeout whose callback dies with the scene — use for ALL scene-scoped delays/FX. */
function sceneTimeout(fn: () => void, ms: number): number {
  const id = window.setTimeout(fn, ms)
  sceneTimers.push(id)
  return id
}
function goScene(mount: (root: HTMLElement) => void): void {
  if (!ROOT) return
  if (V) { cancelAnimationFrame(V.raf); V = null } // stop the combat loop before its DOM goes away
  for (const id of sceneTimers) clearTimeout(id)
  sceneTimers = []
  clearTimeout(tipTimer)
  hideTip()
  ;(document.getElementById('confirmmodal') as (HTMLElement & { _cancel?: () => void }) | null)?._cancel?.() // full cleanup (keydown listener)
  coachTeardown()
  for (const id of BODY_SINGLETONS) document.getElementById(id)?.remove()
  document.querySelectorAll('.mspark').forEach((e) => e.remove()) // body-level FX strays (their cleanup timers died above)
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
function initTooltips(): void {
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

/* ============================================================
   TOWN SCENES — split into two pages (TODO §B1):
   • characterSelectScene — the roster (create / select / delete / rest) on the left; the selected
     hero's SHEET (vitals · abilities · passive · gear placeholder · consumables) — or the creator —
     on the right. One context button advances to the dungeon picker (or creates a hero first).
   • dungeonSelectScene — dungeon summary (the persistent dungeon-level drift, the elite telegraph,
     elites, the boss) + foe picker + the consumable loadout, then Engage.
   Persistence lives here (the saved character carries HP across the boundary). Combat returns to
   character select. Inventory / storage / shop are TODO §B — the loadout is the interim free-pick.
   ============================================================ */
let selectedCharId: string | null = null // persists the chosen hero across scene + combat transitions

function characterSelectScene(root: HTMLElement): void {
  const wrap = $(`<div class="wrap"></div>`)
  wrap.appendChild($(`<h1>set.core</h1>`))
  wrap.appendChild($(`<div class="sub">town · choose your hero</div>`))
  const cols = $(`<div class="hub2"></div>`)
  const leftP = $(`<div class="panel"></div>`)
  const rightP = $(`<div class="panel"></div>`)
  cols.appendChild(leftP); cols.appendChild(rightP)
  wrap.appendChild(cols)
  const footer = $(`<div class="hubfoot"></div>`)
  wrap.appendChild(footer)
  wrap.appendChild($(`<div class="sub" style="margin-top:18px">Click cards to build a set (same-or-all-different on every trait). Set-mates flutter — the easier the set, the harder they flap; a rattling card completes one.</div>`))
  wrap.appendChild($(`<div class="sub" style="margin-top:10px;text-transform:none;letter-spacing:0;color:var(--ink-faint)">Archived single-file prototypes (the migration oracle): <a href="${import.meta.env.BASE_URL}prototype/" style="color:var(--phos);text-decoration:none">▸ /prototype/</a></div>`))
  root.appendChild(wrap)

  let roster = loadRoster()
  if (selectedCharId && !roster.some((c) => c.id === selectedCharId)) selectedCharId = null
  if (selectedCharId == null) selectedCharId = roster[0]?.id ?? null
  let creating = roster.length === 0 // no heroes yet → open straight into the creator
  let newClassId = CLASSES[0].id
  let nameInput: HTMLInputElement | null = null

  const renderCreator = (host: HTMLElement): void => {
    host.appendChild($(`<label>New hero</label>`))
    const nameIn = $<HTMLInputElement>(`<input class="nameinput" maxlength="18" placeholder="Name…">`)
    nameInput = nameIn
    host.appendChild(nameIn)
    const cgrid = $(`<div class="classgrid"></div>`)
    const blurb = $(`<div class="classblurb"></div>`)
    const paint = (): void => {
      cgrid.querySelectorAll('.classcard').forEach((el) => el.classList.toggle('sel', (el as HTMLElement).dataset.cid === newClassId))
      blurb.innerHTML = classBlurbHTML(newClassId)
    }
    for (const c of CLASSES) {
      const cc = $(`<div class="classcard" data-cid="${c.id}"><div class="ci">${c.icon}</div><div class="cn">${c.name}</div></div>`)
      cc.addEventListener('click', () => { newClassId = c.id; paint() })
      cgrid.appendChild(cc)
    }
    host.appendChild(cgrid); host.appendChild(blurb); paint()
  }

  const renderSheet = (host: HTMLElement, c: SavedChar): void => {
    const cls = classById(c.classId)
    host.appendChild($(`<div class="sheet-hd"><span class="ci">${cls.icon}</span><div class="cmeta"><div class="cn">${c.name}</div><div class="cc">${cls.name}</div></div></div>`))
    host.appendChild($(`<label style="margin-top:14px">Vitals</label>`))
    host.appendChild($(`<div class="sheet-stat">❤ HP <b>${c.hp}/${c.maxHp}</b></div>`))
    host.appendChild($(`<label style="margin-top:14px">Abilities</label>`))
    const ab = $(`<div class="sheet-abils"></div>`)
    for (const id of cls.abilities) {
      const a = ABILITIES[id]; if (!a) continue
      const cost = a.cost.map((n, i) => (n > 0 ? `${MANA_ICON[i]}${n}` : '')).filter(Boolean).join(' ')
      ab.appendChild($(`<div class="sheet-abil" data-tip-title="${a.name}${cost ? ` · ${cost}` : ''}" data-tip="${a.desc}"><span class="abi">${a.icon}</span><span class="abn">${a.name}</span><span class="abc">${cost}</span></div>`))
    }
    host.appendChild(ab)
    host.appendChild($(`<label style="margin-top:14px">Passive</label>`))
    host.appendChild($(`<div class="sheet-stat">${cls.passives.map((p) => PASSIVES[p]?.name).filter(Boolean).join(' · ') || '—'}</div>`))
    host.appendChild($(`<label style="margin-top:14px">Gear</label>`))
    host.appendChild($(`<div class="sheet-soon">— coming soon —</div>`))
    host.appendChild($(`<label style="margin-top:14px">Consumables</label>`))
    const consRow = $(`<div class="cons-row"></div>`)
    const loadout = (c.consumables ?? []).filter(Boolean)
    if (!loadout.length) consRow.appendChild($(`<div class="cons-empty">— set in the dungeon picker —</div>`))
    for (const id of loadout) {
      const cc = CONSUMABLES[id]; if (!cc) continue
      const tint = cc.color != null ? `var(--c${cc.color})` : 'var(--line2)'
      consRow.appendChild($(`<span class="cons-slot${cc.kind === 'scroll' ? ' scroll' : ''}" style="--cc:${tint}" data-tip-title="${cc.name}" data-tip="${cc.desc}"><span class="cons-ic">${cc.icon}</span></span>`))
    }
    host.appendChild(consRow)
    const actions = $(`<div class="sheet-actions"></div>`)
    if (c.hp < c.maxHp) {
      const rest = $<HTMLButtonElement>(`<button class="cta ghost">🌙 Rest (heal to full)</button>`)
      rest.addEventListener('click', () => { c.hp = c.maxHp; upsertChar(c); roster = loadRoster(); render() })
      actions.appendChild(rest)
    }
    const del = $<HTMLButtonElement>(`<button class="cta ghost danger">✕ Delete</button>`)
    del.addEventListener('click', () => confirmModal({ title: `Delete ${c.name}?`, body: 'This hero is gone for good.', confirmLabel: 'Delete', danger: true,
      onConfirm: () => { deleteChar(c.id); roster = loadRoster(); selectedCharId = roster[0]?.id ?? null; creating = roster.length === 0; render() } }))
    actions.appendChild(del)
    host.appendChild(actions)
  }

  const render = (): void => {
    leftP.innerHTML = ''; rightP.innerHTML = ''; footer.innerHTML = ''; nameInput = null
    // --- roster (heroes + a pinned "New Character" entry) ---
    leftP.appendChild($(`<label>Your heroes</label>`))
    const list = $(`<div class="roster"></div>`)
    for (const c of roster) {
      const cls = classById(c.classId)
      const card = $(`<div class="charcard${!creating && c.id === selectedCharId ? ' sel' : ''}" data-id="${c.id}"><span class="ci">${cls.icon}</span><div class="cmeta"><div class="cn">${c.name}</div><div class="cc">${cls.name} · ${c.hp}/${c.maxHp} HP</div></div></div>`)
      card.addEventListener('click', () => { creating = false; selectedCharId = c.id; render() })
      list.appendChild(card)
    }
    const newCard = $(`<div class="charcard newchar${creating ? ' sel' : ''}"><span class="ci">＋</span><div class="cmeta"><div class="cn">New Character</div><div class="cc">create a hero</div></div></div>`)
    newCard.addEventListener('click', () => { creating = true; render() })
    list.appendChild(newCard)
    leftP.appendChild(list)

    // --- right: the sheet, or the creator ---
    if (creating) renderCreator(rightP)
    else {
      const sel = roster.find((c) => c.id === selectedCharId)
      if (sel) renderSheet(rightP, sel)
      else rightP.appendChild($(`<div class="sheet-soon">Select a hero, or create one.</div>`))
    }

    // --- context button ---
    if (creating) {
      const createBtn = $<HTMLButtonElement>(`<button class="cta">＋ Create hero</button>`)
      createBtn.addEventListener('click', () => {
        const nm = nameInput?.value.trim() || classById(newClassId).name
        const ch = makeChar(nm, newClassId, freshId())
        upsertChar(ch); roster = loadRoster(); selectedCharId = ch.id; creating = false; render()
      })
      footer.appendChild(createBtn)
    } else if (selectedCharId) {
      const go = $<HTMLButtonElement>(`<button class="cta bob">Choose a dungeon ▶</button>`)
      go.addEventListener('click', () => { const sel = roster.find((c) => c.id === selectedCharId); if (sel) goScene((r) => dungeonSelectScene(r, sel)) })
      footer.appendChild(go)
    }
  }
  render()
}

function dungeonSelectScene(root: HTMLElement, char: SavedChar): void {
  const wrap = $(`<div class="wrap"></div>`)
  wrap.appendChild($(`<h1>set.core</h1>`))
  wrap.appendChild($(`<div class="sub">delve · ${char.name} — ${char.hp}/${char.maxHp} HP</div>`))
  const cols = $(`<div class="hub2"></div>`)
  const leftP = $(`<div class="panel"></div>`)
  const rightP = $(`<div class="panel"></div>`)
  cols.appendChild(leftP); cols.appendChild(rightP)
  wrap.appendChild(cols)
  const footer = $(`<div class="hubfoot"></div>`)
  wrap.appendChild(footer)
  root.appendChild(wrap)

  const dungeonIds = Object.keys(GAMEDATA.dungeons)
  let dungeonId = dungeonIds[0]
  let foeVal = ''

  // LEFT: dungeon + foe pickers, then the consumable loadout
  leftP.appendChild($(`<label>Dungeon</label>`))
  const dSel = $<HTMLSelectElement>(`<select id="dungeon"></select>`)
  for (const id of dungeonIds) dSel.appendChild($(`<option value="${id}">${GAMEDATA.dungeons[id].name}</option>`))
  leftP.appendChild(dSel)
  leftP.appendChild($(`<label style="margin-top:12px">Foe</label>`))
  const fSel = $<HTMLSelectElement>(`<select id="foe"></select>`)
  leftP.appendChild(fSel)
  leftP.appendChild($(`<label style="margin-top:14px">Consumables · ${CONSUMABLE_SLOTS} slots</label>`))
  const consWrap = $(`<div class="cons-loadout"></div>`)
  leftP.appendChild(consWrap)

  // RIGHT: the dungeon summary (re-rendered when the dungeon changes)
  const summary = $(`<div></div>`)
  rightP.appendChild(summary)

  const fillFoes = (): void => {
    const dg = GAMEDATA.dungeons[dungeonId]
    fSel.innerHTML = ''
    if (dg.sequence?.length) fSel.appendChild($(`<option value="sequence">▶ Run the gauntlet · ${dg.sequence.length} foes</option>`))
    dg.enemy_table.forEach((e) => fSel.appendChild($(`<option value="foe:${e.foe}">${GAMEDATA.creatures[e.foe]?.name ?? e.foe}</option>`)))
    dg.elite_pool.forEach((id) => fSel.appendChild($(`<option value="foe:${id}">★ ${GAMEDATA.creatures[id]?.name ?? id} (elite)</option>`)))
    if (dg.boss) fSel.appendChild($(`<option value="foe:${dg.boss}">☠ ${GAMEDATA.creatures[dg.boss]?.name} (boss)</option>`))
    fSel.value = dg.sequence?.length ? 'sequence' : dg.default_foe ? `foe:${dg.default_foe}` : fSel.options[0]?.value ?? ''
    foeVal = fSel.value
  }
  const renderSummary = (): void => {
    const dg = GAMEDATA.dungeons[dungeonId]
    const parts: string[] = [`<div class="dgn-hd"><div class="cn">${dg.name}</div><div class="cc">Difficulty ${dg.difficulty}${dg.theme ? ` · ${dg.theme.value} ${dg.theme.axis}` : ''}</div></div>`]
    const drift = dg.drift ? GAMEDATA.drifts[dg.drift] : null
    if (drift) parts.push(`<div class="dgn-line"><span class="dgn-k">${drift.icon ?? '🌫'} Dungeon drift</span><span class="dgn-v">${drift.name}${drift.desc ? ` — ${drift.desc}` : ''}</span></div>`)
    const mirror = dg.boss_mirror ? GAMEDATA.traps[dg.boss_mirror] : null
    if (mirror) parts.push(`<div class="dgn-line"><span class="dgn-k">${mirror.icon ?? '⚠'} Elite telegraph</span><span class="dgn-v">${mirror.name}</span></div>`)
    if (dg.elite_pool.length) parts.push(`<div class="dgn-line"><span class="dgn-k">★ Elites</span><span class="dgn-v">${dg.elite_pool.map((id) => GAMEDATA.creatures[id]?.name ?? id).join(' · ')}</span></div>`)
    if (dg.boss) { const b = GAMEDATA.creatures[dg.boss]; parts.push(`<div class="dgn-boss"><div class="dgn-k">☠ Boss</div><div class="cn">${b?.name ?? dg.boss}</div>${b?.desc ? `<div class="cc">${b.desc}</div>` : ''}</div>`) }
    summary.innerHTML = `<label>Expedition</label>` + parts.join('')
  }
  const renderLoadout = (): void => {
    consWrap.innerHTML = ''
    const allIds = Object.keys(CONSUMABLES)
    const potions = allIds.filter((id) => CONSUMABLES[id].kind === 'potion')
    const scrolls = allIds.filter((id) => CONSUMABLES[id].kind === 'scroll')
    for (let slot = 0; slot < CONSUMABLE_SLOTS; slot++) {
      const cur = char.consumables[slot] ?? ''
      const cc = CONSUMABLES[cur]
      const tint = cc?.color != null ? `var(--c${cc.color})` : 'var(--line2)'
      const row = $(`<div class="cons-edit"></div>`)
      row.appendChild($(`<span class="cons-slot${cc?.kind === 'scroll' ? ' scroll' : ''}" style="--cc:${tint}">${cc ? `<span class="cons-ic">${cc.icon}</span>` : ''}</span>`))
      const seln = $<HTMLSelectElement>(`<select></select>`)
      seln.appendChild($(`<option value="">(empty)</option>`))
      const pg = $(`<optgroup label="Potions"></optgroup>`)
      for (const id of potions) pg.appendChild($(`<option value="${id}">${CONSUMABLES[id].name}</option>`))
      seln.appendChild(pg)
      const sg = $(`<optgroup label="Scrolls"></optgroup>`)
      for (const id of scrolls) sg.appendChild($(`<option value="${id}">${CONSUMABLES[id].name}</option>`))
      seln.appendChild(sg)
      seln.value = cur
      seln.addEventListener('change', () => {
        const arr = char.consumables.slice()
        while (arr.length < CONSUMABLE_SLOTS) arr.push('')
        arr[slot] = seln.value
        char.consumables = arr
        upsertChar(char); renderLoadout()
      })
      row.appendChild(seln)
      consWrap.appendChild(row)
    }
  }

  dSel.addEventListener('change', () => { dungeonId = dSel.value; fillFoes(); renderSummary() })
  fSel.addEventListener('change', () => { foeVal = fSel.value })
  fillFoes(); renderSummary(); renderLoadout()

  // FOOTER: back to the roster, or enter the dungeon
  const back = $<HTMLButtonElement>(`<button class="cta ghost">◀ Back</button>`)
  back.addEventListener('click', () => goScene(characterSelectScene))
  footer.appendChild(back)
  const enter = $<HTMLButtonElement>(`<button class="cta bob"${char.hp <= 0 ? ' disabled' : ''}>▶ Enter dungeon</button>`)
  enter.addEventListener('click', () => { if (char.hp > 0) goScene((r) => begin(r, char, dungeonId, foeVal)) })
  footer.appendChild(enter)
  if (char.hp <= 0) footer.appendChild($(`<span class="sub" style="align-self:center;text-transform:none;letter-spacing:0">0 HP — Rest first (◀ Back).</span>`))
}

/** Loadout summary for the class blurb: tagline + ability names + passive name. */
function classBlurbHTML(id: string): string {
  const c = classById(id)
  const abil = c.abilities.map((a) => ABILITIES[a]?.name).filter(Boolean).join(' · ')
  const pas = c.passives.map((p) => PASSIVES[p]?.name).filter(Boolean).join(' · ')
  return `${c.icon} <b>${c.name}</b> — ${c.blurb}<br><b>Abilities:</b> ${abil} &nbsp; <b>Passive:</b> ${pas}`
}

// ---- begin combat ----
function begin(root: HTMLElement, char: SavedChar, dungeonId: string, foeVal: string): void {
  const rng: Rng = systemRng
  const dg: Dungeon = GAMEDATA.dungeons[dungeonId]
  let foeId: string
  let sequence: string[] | null = null
  if (foeVal === 'sequence' && dg.sequence) {
    sequence = dg.sequence.slice()
    foeId = sequence[0]
  } else if (foeVal.startsWith('foe:')) {
    foeId = foeVal.slice(4)
  } else {
    foeId = pickWeightedFoe(dg.enemy_table, rng)
  }
  const foe = assembleFoe(foeId, dg, GAMEDATA, rng)
  if (!foe) return
  const cls = classById(char.classId)
  const run = createRun({ foe, gen: GEN, playerMax: char.maxHp, passives: cls.passives, consumables: char.consumables, sequence, dungeonId }, rng)
  run.combat.playerHP = Math.max(0, Math.min(char.maxHp, char.hp)) // the hero enters at their persisted HP, not full
  V = { root, deps: { data: GAMEDATA, rng }, run, state: run.combat, char, actions: [], classId: cls.id, loadout: cls.abilities.slice(), coach: !!dg.coach, coachCue: null, manaColor: dominantManaColor(cls.abilities), paused: true, hitstopUntil: 0, preview: null, selected: [], raf: 0, lastT: 0, boardSig: '', refs: {}, stats: { dealt: 0, taken: 0, blocked: 0, healed: 0, sets: 0, traps: 0 }, morphSrc: new Map(), dev: { reshapeYou: 0, reshapeFoe: 0, matches: 0, springs: 0, k1: 0, wards: 0, churns: 0 } }
  buildPlay()
  renderBoard()
  updateBar()
  // brief the foe first; Engage starts the clock (and the guided intro, in the Tutorial)
  showBriefing(() => {
    if (!V) return
    V.paused = false
    V.lastT = 0
    hitstop(START_GRACE_MS) // freeze the clock for a beat after Engage — read the fresh board, no ticks advance
    loop(performance.now())
    // let the player SEE the board for a beat before the guided intro freezes it ("read the board").
    // capture V so a pending timer from a prior combat can't fire into a different one.
    if (dg.guided) sceneTimeout(() => coachStartGuided(), 650)
  })
}

// ---- play screen skeleton ----
function buildPlay(): void {
  if (!V) return
  V.root.innerHTML = ''
  const wrap = $(`<div class="wrap"></div>`)
  // foe header — tall (room for future foe art); also the stage for popup messaging (the tutorial)
  const head = $(`<div class="panel headpanel"></div>`)
  // PLACEHOLDER sprites (pixel art later): the duelists step toward whoever owns the board (the tug)
  head.appendChild($(`<div class="sprites"><span class="sprite you" id="spyou">🧙</span><span class="sprite foe" id="spfoe">👹</span></div>`))
  head.appendChild($(`<div class="foename" id="foename"></div>`))
  head.appendChild($(`<div class="foedesc" id="foedesc"></div>`))
  head.appendChild($(`<button class="fleebtn" id="fleebtn" data-tip-title="Flee" data-tip="Forfeit this encounter and retreat to town. Available any time.">🏃 Flee</button>`)) // any-time flee
  wrap.appendChild(head)

  // play area: left 2/3 (combat bar embedded above the board) · right 1/3 (Tactics / Abilities / log)
  const play = $(`<div class="play"></div>`)

  const left = $(`<div class="panel leftcol"></div>`)
  left.appendChild($(`
    <div class="bar combatbar">
      <div class="gauge you"><div class="lab"><span class="youname">You <span class="blockbadge" id="block"></span><span class="buffbadge" id="buffind"></span></span><span id="phpv"></span></div><div class="track"><span class="fill php" id="php"></span></div></div>
      <div class="gauge"><div class="lab"><span id="enemylab">Enemy</span><span id="ehpv"></span></div><div class="track"><span class="fill ehp" id="ehp"></span></div></div>
    </div>`))
  // enemy attack timer — a full-width meter that empties toward the next strike
  left.appendChild($(`
    <div class="timerbar">
      <div class="lab"><span>⚔ Enemy attack</span><span id="clock">—</span></div>
      <div class="track"><span class="fill atk" id="atkfill"></span></div>
    </div>`))
  // the TUG BAR — board composition: enemy theme share vs your Maneuver-bias share (shown when both exist)
  left.appendChild($(`
    <div class="tugbar" id="tugbar" style="display:none">
      <span class="tug-end foe" id="tugfoe">🔥</span>
      <div class="tug-track"><span class="tug-center"></span><span class="tug-marker" id="tugmarker"></span></div>
      <span class="tug-end you" id="tugyou">—</span>
    </div>`))
  left.appendChild($(`<div class="strip" id="strip"></div>`))
  const boardWrap = $(`<div class="boardwrap" id="boardwrap"></div>`)
  const board = $(`<div class="board" id="board"></div>`)
  board.style.gridTemplateColumns = `repeat(${V.state.cols}, 1fr)`
  boardWrap.appendChild(board)
  boardWrap.appendChild($(`<div id="floatlayer"></div>`))
  left.appendChild(boardWrap)
  // the DEV instruments — always-on while the project is in dev; a dim side-stat, not a feature
  left.appendChild($(`<div class="devstats" id="devstats"></div>`))
  play.appendChild(left)

  const rail = $(`<div class="rail"></div>`)
  rail.appendChild(buildCastPanel())
  const logP = $(`<div class="panel"></div>`)
  logP.appendChild($(`<label>Combat log</label>`))
  logP.appendChild($(`<div class="log" id="log"></div>`))
  rail.appendChild(logP)
  play.appendChild(rail)
  wrap.appendChild(play)
  V.root.appendChild(wrap)
  if (!document.getElementById('ptint')) document.body.appendChild($(`<div id="ptint"></div>`)) // low-HP vignette (body-level)

  V.refs = {}
  for (const id of ['foename', 'foedesc', 'fleebtn', 'enemylab', 'phpv', 'ehpv', 'php', 'ehp', 'clock', 'atkfill', 'tacv', 'tac', 'biasrow', 'standnote', 'm0', 'm1', 'm2', 'block', 'buffind', 'strip', 'boardwrap', 'board', 'tugbar', 'tugmarker', 'tugfoe', 'tugyou', 'devstats', 'spyou', 'spfoe', 'log', 'abilities', 'tactics', 'passives', 'consumables', 'floatlayer']) {
    const el = wrap.querySelector('#' + id)
    if (el) V.refs[id] = el as HTMLElement
  }
  board.addEventListener('click', onBoardClick)
  V.refs.fleebtn?.addEventListener('click', onFlee)
  V.refs.abilities?.addEventListener('click', onAbilityClick)
  V.refs.abilities?.addEventListener('mouseover', onAbilityHover)
  V.refs.abilities?.addEventListener('mouseout', clearPreview)
  V.refs.tactics?.addEventListener('click', onTacticClick)
  V.refs.biasrow?.addEventListener('click', onTacticClick) // the bias chips are a SIBLING row, not inside #tactics
  V.refs.consumables?.addEventListener('click', onConsumableClick)
  renderStrip()
  renderConsumables()
  updateCastables()
  V.refs.foename.textContent = V.state.foe.name + (V.run.sequence ? `  ·  ${V.run.seqIdx + 1}/${V.run.sequence.length}` : '')
  V.refs.foedesc.innerHTML = V.state.foe.desc ?? ''
}

/** The live castable panel: the class loadout (mana-gated click-to-cast), the Tactics v2 controls
 *  (tactic toggle + Maneuver's bias picker + the charge gauge), and the always-on passive chips. */
const MANA_ICON = ['🔥', '🌿', '❄']
const TAC_BTNS: { k: 'maneuver' | 'stand'; label: string; tip: string }[] = [
  { k: 'maneuver', label: '⚔ Maneuver', tip: 'Charges spend themselves morphing the DEADEST card toward your chosen bias — one card at a time. Pick the bias below.' },
  { k: 'stand', label: '🛡 Stand Ground', tip: 'Charges bank as a shield: each enemy board-meddle (drift, warp, lock, wound) eats one charge and fizzles. Damage still hurts — only the board holds.' },
]
const BIAS_CHIPS: { axis: 'color' | 'shape' | 'mag'; value: number; label: string; tip: string }[] = [
  { axis: 'color', value: 0, label: '🔥', tip: 'Churn toward red (Fire)' },
  { axis: 'color', value: 1, label: '🌿', tip: 'Churn toward green (Nature)' },
  { axis: 'color', value: 2, label: '❄', tip: 'Churn toward blue (Frost)' },
  { axis: 'shape', value: 0, label: '⚔', tip: 'Churn toward Attacks' },
  { axis: 'shape', value: 1, label: '🛡', tip: 'Churn toward Defends' },
  { axis: 'shape', value: 2, label: '➤', tip: 'Churn toward Moves' },
  { axis: 'mag', value: 0, label: '①', tip: 'Churn toward 1s (light)' },
  { axis: 'mag', value: 1, label: '②', tip: 'Churn toward 2s' },
  { axis: 'mag', value: 2, label: '③', tip: 'Churn toward 3s (heavy)' },
]
function buildCastPanel(): HTMLElement {
  const cls = classById(V!.classId)
  const panel = $(`<div class="panel"></div>`)
  // TACTICS section (meter built in, above abilities) — coach-gateable as one region
  const tacSec = $(`<div class="coach-sec" data-sec="tactics"></div>`)
  tacSec.appendChild($(`<div class="panelhd"><label>Tactics</label><span class="stub-note" id="tacv">0/${CHARGE_CAP}</span></div>`))
  tacSec.appendChild($(`<div class="track tacmeter" data-tip-title="Tactics charges" data-tip="Banked by matching Move cards (+1 each), and by tempo/Block wasted past their caps. Your selected tactic below spends them."><span class="fill tac" id="tac"></span></div>`))
  const row = $(`<div class="tactics-row" id="tactics"></div>`)
  for (const t of TAC_BTNS) row.appendChild($(`<div class="tac-btn" data-tac="${t.k}" data-tip-title="${t.label}" data-tip="${t.tip} Swapping tactics resets your charges (a few seconds to re-engage).">${t.label}</div>`))
  tacSec.appendChild(row)
  const biasRow = $(`<div class="bias-row" id="biasrow"></div>`)
  for (const b of BIAS_CHIPS) biasRow.appendChild($(`<div class="bias-chip" data-axis="${b.axis}" data-value="${b.value}" data-tip-title="Maneuver bias" data-tip="${b.tip}. Click again to clear.">${b.label}</div>`))
  tacSec.appendChild(biasRow)
  tacSec.appendChild($(`<div class="standnote" id="standnote">charges ward off enemy board-meddling</div>`))
  panel.appendChild(tacSec)
  // ABILITIES section (mana display built into the header) + grid + passive chips
  const abSec = $(`<div class="coach-sec" data-sec="abilities" style="margin-top:14px"></div>`)
  abSec.appendChild($(`<div class="panelhd"><label>Abilities · ${cls.name}</label><span class="manabar"><span style="color:var(--c0)" data-tip-title="Fire mana" data-tip="Spent on Fire abilities. Bank it by matching red cards (all-red set → 3, one-of-each → 1).">🔥<b id="m0">0</b></span><span style="color:var(--c1)" data-tip-title="Nature mana" data-tip="Spent on Nature abilities. Bank it by matching green cards.">🌿<b id="m1">0</b></span><span style="color:var(--c2)" data-tip-title="Frost mana" data-tip="Spent on Frost abilities. Bank it by matching blue cards.">❄<b id="m2">0</b></span></span></div>`))
  const grid = $(`<div class="ability-grid" id="abilities"></div>`)
  for (const id of V!.loadout) {
    const a = ABILITIES[id]
    if (!a) continue
    const cost = a.cost.map((c, i) => (c > 0 ? `${MANA_ICON[i]}${c}` : '')).filter(Boolean).join(' ')
    grid.appendChild($(`<div class="ab-slot" data-ab="${id}" data-tip-title="${a.name}${cost ? ` · ${cost}` : ''}" data-tip="${a.desc}"><div class="abi">${a.icon}</div><div class="abn">${a.name}</div><div class="abc">${cost}</div></div>`))
  }
  abSec.appendChild(grid)
  const pas = $(`<div class="passives" id="passives"></div>`)
  for (const id of V!.state.passives) {
    const p = PASSIVES[id]
    if (p) pas.appendChild($(`<div class="pchip" data-passive="${id}" data-tip-title="${p.name}" data-tip="${p.desc}"><span class="pi">${p.icon}</span>${p.name}</div>`))
  }
  if (V!.state.passives.length) abSec.appendChild(pas)
  panel.appendChild(abSec)
  // CONSUMABLES section — the carried potions/scrolls, used one-shot
  const consSec = $(`<div style="margin-top:14px"><div class="panelhd"><label>Consumables</label></div><div class="cons-row" id="consumables"></div></div>`)
  panel.appendChild(consSec)
  return panel
}

/** Render the carried consumables as art buttons (colour tint + icon). Re-run after each use. */
function renderConsumables(): void {
  if (!V) return
  const el = V.refs.consumables
  if (!el) return
  el.innerHTML = ''
  if (!V.state.consumables.length) { el.appendChild($(`<div class="cons-empty">— none —</div>`)); return }
  V.state.consumables.forEach((id, slot) => {
    const c = CONSUMABLES[id]
    if (!c) return
    const tint = c.color != null ? `var(--c${c.color})` : 'var(--line2)'
    const btn = $(`<button class="cons-slot${c.kind === 'scroll' ? ' scroll' : ''}" data-slot="${slot}" style="--cc:${tint}" data-tip-title="${c.name}" data-tip="${c.desc}"><span class="cons-ic">${c.icon}</span></button>`)
    el.appendChild(btn)
  })
}

function onConsumableClick(e: Event): void {
  if (!V || !V.state.running || V.paused) return
  const el = (e.target as HTMLElement).closest('.cons-slot') as HTMLElement | null
  if (!el || el.dataset.slot == null) return
  dispatch({ type: 'useConsumable', slot: +el.dataset.slot })
}

function renderStrip(): void {
  if (!V) return
  const strip = V.refs.strip
  strip.innerHTML = ''
  const trigs = V.state.foe.triggers
  const drift = V.state.foe.drift
  if (!trigs.length && !drift) return
  const hasTrick = trigs.some((t) => t.kind === 'trick')
  strip.appendChild($(`<span class="lab">${hasTrick ? '⚠ Traps · ✦ Tricks' : '⚠ Enemy traps'}</span>`))
  trigs.forEach((t, i) => {
    const trick = t.kind === 'trick'
    const d = $(`<div class="trig${trick ? ' trick' : ''}" data-trig="${i}"><span>${t.icon ?? (trick ? '✦' : '⚠')}</span><span class="tn">${t.name}</span>${t.desc ? `<span class="td">${trick ? 'aim: ' : ''}${t.desc}</span>` : ''}</div>`)
    strip.appendChild(d)
  })
  // the ambient drift gets its own chip + a LIVE countdown to its next pull (the rhythm of the tug)
  if (drift) strip.appendChild($(`<div class="trig driftchip" data-trig="drift" data-tip-title="${drift.name}" data-tip="${drift.desc ?? 'the dungeon reshapes the board on a clock'} — every ${drift.every ?? 5}s."><span>${drift.icon ?? '🌫'}</span><span class="tn">${drift.name}</span><span class="td driftcd" id="driftcd"></span></div>`))
}

// ---- board rendering ----
function boardSignature(s: CombatState): string {
  return s.board.map((c) => (c ? keyOf(c) : -1)).join(',') + '|' + [...s.locked.keys()].sort((a, b) => a - b).join(',')
}
// the ghost class for a card LEAVING its slot, by the verb that emptied it (default = plain fade)
const LEAVE_CLASS: Record<CardVerb, string> = { resolve: 'card pop', transmute: 'card morph', boom: 'card boom', reform: 'card leave' }
function renderBoard(verbs?: Map<number, CardVerb>): void {
  if (!V) return
  const s = V.state
  const board = V.refs.board
  // crossfade: snapshot current cards; ghost-out any whose content is about to change (verb picks the motion)
  const oldKeys: Record<number, string> = {}
  const layer = V.refs.floatlayer
  const bw = V.refs.boardwrap?.getBoundingClientRect()
  board.querySelectorAll<HTMLElement>('.card').forEach((old) => {
    if (old.dataset.i == null) return
    const i = +old.dataset.i
    oldKeys[i] = old.dataset.key ?? ''
    const c = s.board[i]
    const newKey = c ? String(keyOf(c)) : ''
    if (layer && bw && old.dataset.key && old.dataset.key !== newKey) {
      const r = old.getBoundingClientRect()
      const ghost = old.cloneNode(true) as HTMLElement
      ghost.className = LEAVE_CLASS[verbs?.get(i) as CardVerb] ?? 'card leave'
      ghost.removeAttribute('data-i')
      ghost.style.cssText = `position:absolute;margin:0;left:${r.left - bw.left}px;top:${r.top - bw.top}px;width:${r.width}px;height:${r.height}px`
      ghost.addEventListener('animationend', () => ghost.remove()) // not a timer → it freezes with the pause
      layer.appendChild(ghost)
    }
  })
  const firstRender = V.boardSig === '' // the opening board just appears; no fade-in to freeze mid-animation
  board.innerHTML = ''
  const sets = findSets(s.board)
  const mates = glowSet(s, V.selected, sets)
  // value heat: how many sets each card anchors right now (reads CARDS, not sets → keeps §2.5 intact)
  const setCount = new Array(s.board.length).fill(0)
  for (const t of sets) for (const j of t) setCount[j]++
  const maxCount = Math.max(1, ...setCount)
  const bait = driftColor(s) // the dungeon-drift colour: those cards shimmer temptingly (the lure to resist)
  s.board.forEach((c, i) => {
    if (!c) {
      // a damage-shattered (or transmuting) hole reads as a Wound — dashed gap, not a neutral empty slot
      board.appendChild($(`<div class="card ${s.pending.has(i) ? 'gap' : 'empty'}"></div>`))
      return
    }
    const locked = s.locked.has(i)
    const key = String(keyOf(c))
    const cls = ['card']
    let gimme = -1
    if (V!.selected.includes(i)) cls.push(mates.deadPair ? 'badpair' : 'sel') // dead pair → red picks, no other glow
    else if (mates.complete === i) cls.push('complete')
    else if (mates.set.has(i)) { cls.push('mate'); gimme = mates.set.get(i)! } // flutter amplitude scales with this set's gimme value
    if (locked) cls.push('locked')
    else if (bait != null && c[0] === bait && !V!.selected.includes(i) && mates.complete !== i && !mates.set.has(i)) cls.push('bait')
    if (!firstRender && oldKeys[i] !== key) {
      cls.push('enter')
      if (verbs?.get(i) === 'reform') cls.push('reform')
      const src = V!.morphSrc.get(i) // tug attribution: tint the arrival by who pulled it
      if (src) { cls.push(`src-${src}`); V!.morphSrc.delete(i) }
    } // new/changed → fade in (reform = materialize)
    const heat = (setCount[i] / maxCount).toFixed(2)
    const gimmeVar = gimme >= 0 ? `;--gimme:${(gimme / 2).toFixed(2)}` : ''
    const el = $(`<div class="${cls.join(' ')}" data-i="${i}" data-key="${key}" style="--cc:var(--c${c[0]});--heat:${heat}${gimmeVar}">${cardSVG(c)}${locked ? '<span class="lock">🔒</span><span class="lockcd"></span>' : ''}</div>`)
    board.appendChild(el)
  })
  V.boardSig = boardSignature(s)
  updateTrickLines() // coach-only: surface makeable trick lines (no-op outside coach dungeons)
  updateTrapArmed() // §2.5-safe: pulse a trap/trick chip when a line that springs it is on the board
}

const COLOR_TOK: Record<string, number> = { red: 0, green: 1, blue: 2 }
/** Does a trap condition punish the colour the player's loadout needs most? → the briefing "counters you" flag. */
function countersBuild(when: Condition | undefined): boolean {
  if (!V || !when) return false
  const hit = (c: Condition): boolean => ('all' in c ? c.all.some(hit) : c.axis === 'color' && c.value != null && COLOR_TOK[c.value] === V!.manaColor)
  return hit(when)
}
/** The dungeon-drift target colour — cards of it are being herded toward (the bait to resist). */
function driftColor(s: CombatState): number | null {
  const d = s.foe.drift
  if (!d) return null
  for (const e of d.do) if (e.effect === 'transmute' && e.bias?.axis === 'color') return COLOR_TOK[e.bias.value]
  return null
}

/** Pulse a trap/trick chip when the board currently CONTAINS a set that would spring it — "danger/opportunity
 *  is live now," while keeping WHICH line a reading challenge (the §2.5 sweet spot; safe for real play). */
function updateTrapArmed(): void {
  if (!V) return
  const s = V.state
  if (!s.foe.triggers.length) return
  const reachable = (x: number) => s.board[x] != null && !s.locked.has(x) && !s.pending.has(x)
  const descs = s.running
    ? findSets(s.board).filter((t) => t.every(reachable)).map((t) => matchDescriptor([s.board[t[0]]!, s.board[t[1]]!, s.board[t[2]]!]))
    : []
  s.foe.triggers.forEach((t, i) => {
    const armed = t.on === 'match' && descs.some((d) => condMet(t.when, d))
    V!.refs.strip?.querySelector(`[data-trig="${i}"]`)?.classList.toggle('armed', armed)
  })
}

/** Coach-only teaching cue — glow makeable sets that would spring a favorable TRICK (green line +
 *  chevron). Strictly gated behind V.coach so real play keeps TRAPS §2.5 (spotting the line is the skill).
 *  Off while the player has a selection (teal mate-glow owns the board then) and during guided cue stages. */
function updateTrickLines(): void {
  if (!V) return
  const board = V.refs.board
  board?.querySelectorAll('.trickline').forEach((e) => e.classList.remove('trickline'))
  board?.querySelectorAll('.trickchev').forEach((e) => e.remove())
  const s = V.state
  if (!V.coach || V.coachCue || !s.running || V.selected.length) return
  const tricks = s.foe.triggers.filter((t) => t.kind === 'trick')
  if (!tricks.length) return
  const reachable = (x: number) => s.board[x] != null && !s.locked.has(x) && !s.pending.has(x)
  for (const t of findSets(s.board)) {
    if (!t.every(reachable)) continue
    const desc = matchDescriptor([s.board[t[0]]!, s.board[t[1]]!, s.board[t[2]]!])
    if (!tricks.some((tr) => condMet(tr.when, desc))) continue
    for (const x of t) board?.querySelector(`[data-i="${x}"]`)?.classList.add('trickline')
    const mid = board?.querySelector(`[data-i="${t[1]}"]`)
    if (mid && !mid.querySelector('.trickchev')) mid.appendChild($(`<span class="trickchev">▼</span>`))
  }
}

/** How "gimme" a set reads: the count of all-same traits (0–2 on the active axes). All-same on an axis
 *  is a visual cluster (obvious); all-different on every axis is camo. Higher = easier to spot. */
function gimmeScore(s: CombatState, t: [number, number, number]): number {
  const d = matchDescriptor([s.board[t[0]] as Card, s.board[t[1]] as Card, s.board[t[2]] as Card])
  return (d.sameColor != null ? 1 : 0) + (d.sameShape != null ? 1 : 0) + (d.sameNumber != null ? 1 : 0)
}

/** Set-mate glow for the current selection: 1 pick → its mates, each keyed by its best gimme score (the
 *  brighter, the more obvious the set); 2 picks → the completer, or `deadPair` (red picks, nothing else). */
function glowSet(s: CombatState, sel: number[], sets: [number, number, number][]): { set: Map<number, number>; complete: number; deadPair: boolean } {
  const out = new Map<number, number>()
  let complete = -1
  let deadPair = false
  if (sel.length === 1) {
    for (const t of sets) if (t.includes(sel[0])) {
      const g = gimmeScore(s, t)
      for (const j of t) if (j !== sel[0]) out.set(j, Math.max(out.get(j) ?? 0, g)) // a mate's brightness = its easiest set
    }
  } else if (sel.length === 2) {
    const a = s.board[sel[0]]
    const b = s.board[sel[1]]
    if (a && b) {
      const want = keyOf(third(a, b))
      s.board.forEach((c, i) => {
        if (c && !sel.includes(i) && !s.locked.has(i) && keyOf(c) === want) complete = i
      })
      deadPair = complete < 0 // the finishing third isn't on the board → this pair can't make a set
    }
  }
  return { set: out, complete, deadPair }
}

// ---- input ----
function onBoardClick(e: Event): void {
  if (!V || !V.state.running || V.paused) return // board is inert during a coaching/briefing freeze
  const el = (e.target as HTMLElement).closest('.card') as HTMLElement | null
  if (!el || el.dataset.i == null) return
  const i = +el.dataset.i
  const s = V.state
  if (!s.board[i] || s.locked.has(i)) return
  const at = V.selected.indexOf(i)
  if (at >= 0) V.selected.splice(at, 1)
  else if (V.selected.length < 3) V.selected.push(i)
  if (V.selected.length === 3) {
    const [a, b, c] = V.selected
    if (isSet(s.board[a]!, s.board[b]!, s.board[c]!)) {
      if (kOfSet([s.board[a]!, s.board[b]!, s.board[c]!], s.gen.active) === 1) V.dev.k1++ // gimme-rate instrument
      const sel = V.selected.slice() as [number, number, number]
      V.selected = []
      dispatch({ type: 'completeSet', slots: sel }) // dispatch renders (with the crossfade) — don't double-render
      return
    }
    // misread — clear the selection NOW (an engine re-render mid-shake must not repaint the bad
    // trio as a normal pick, and a 4th click must not re-enter this branch); only the shake lingers
    const bad = V.selected
    V.selected = []
    bad.forEach((j) => V!.refs.board.querySelector(`[data-i="${j}"]`)?.classList.add('bad'))
    log('A misread — those three are not a set.', 'foe')
    sceneTimeout(() => {
      if (V) renderBoard()
    }, 320)
    return
  }
  renderBoard() // selection changed (1st/2nd pick) → repaint set-mate glow
}

function onAbilityClick(e: Event): void {
  if (!V || !V.state.running || V.paused) return // input frozen during a coaching/briefing pause
  const el = (e.target as HTMLElement).closest('.ab-slot') as HTMLElement | null
  const id = el?.dataset.ab
  if (!id) return
  const a = ABILITIES[id]
  if (!a || !canAfford(V.state, a.cost)) return
  el!.classList.remove('casting')
  void el!.offsetWidth
  el!.classList.add('casting')
  dispatch({ type: 'castAbility', abilityId: id })
}

/** A small in-engine confirm dialog (replaces the browser confirm()). Cancel / confirm / click-scrim /
 *  Esc(cancel). Enter activates whichever BUTTON has focus (native semantics) — never a global
 *  confirm, so the focused-Cancel safe default actually protects the danger actions. */
function confirmModal(opts: { title: string; body?: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onCancel?: () => void }): void {
  // a stacked open must run the previous modal's FULL cleanup (its document keydown listener leaks otherwise)
  ;(document.getElementById('confirmmodal') as (HTMLElement & { _cancel?: () => void }) | null)?._cancel?.()
  document.getElementById('confirmmodal')?.remove()
  const m = $(`<div id="confirmmodal"><div class="confcard">
    <h2 class="conftitle">${opts.title}</h2>
    ${opts.body ? `<div class="confbody">${opts.body}</div>` : ''}
    <div class="confbtns"><button class="confbtn" id="cm-no">Cancel</button><button class="confbtn ${opts.danger ? 'danger' : 'primary'}" id="cm-yes">${opts.confirmLabel ?? 'Confirm'}</button></div>
  </div></div>`) as HTMLElement & { _cancel?: () => void }
  document.body.appendChild(m)
  const cleanup = (): void => { m.remove(); document.removeEventListener('keydown', onKey) }
  const cancel = (): void => { cleanup(); opts.onCancel?.() }
  const accept = (): void => { cleanup(); opts.onConfirm() }
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') cancel() }
  m._cancel = cancel
  m.querySelector('#cm-no')!.addEventListener('click', cancel)
  m.querySelector('#cm-yes')!.addEventListener('click', accept)
  m.addEventListener('click', (e) => { if (e.target === m) cancel() }) // click the scrim = cancel
  document.addEventListener('keydown', onKey)
  ;(m.querySelector('#cm-no') as HTMLElement).focus() // safe default (Cancel); Tab → confirm, Enter activates
}

/** Flee — forfeit the encounter. Available any time the fight is live (not gated by the Tactics meter). */
function onFlee(): void {
  if (!V || !V.state.running || V.paused) return
  V.paused = true // freeze the clock while the dialog is open (a custom modal doesn't block like confirm())
  confirmModal({
    title: 'Flee combat?',
    body: 'You forfeit this encounter and retreat to town.',
    confirmLabel: '🏃 Flee', danger: true,
    onConfirm: () => { if (V) dispatch({ type: 'flee' }) },
    onCancel: () => { if (V) V.paused = false },
  })
}

function onTacticClick(e: Event): void {
  if (!V || !V.state.running || V.paused) return // input frozen during a pause
  const tEl = (e.target as HTMLElement).closest('.tac-btn') as HTMLElement | null
  if (tEl?.dataset.tac) {
    const tactic = tEl.dataset.tac as 'maneuver' | 'stand'
    if (tactic !== V.state.tactic) dispatch({ type: 'setTactic', tactic })
    return
  }
  const bEl = (e.target as HTMLElement).closest('.bias-chip') as HTMLElement | null
  if (bEl?.dataset.axis) {
    const axis = bEl.dataset.axis as 'color' | 'shape' | 'mag'
    const value = +bEl.dataset.value!
    const cur = V.state.maneuverBias
    // clicking the active chip clears the bias (toggle off)
    dispatch({ type: 'setBias', bias: cur && cur.axis === axis && cur.value === value ? null : { axis, value } })
  }
}

/** Refresh ability/tactic affordances — runs every frame so they track mana + the armed meter live.
 *  In coach dungeons a beckoning arrow marks anything that just became usable (the cause→effect cue). */
function updateCastables(): void {
  if (!V) return
  const s = V.state
  V.refs.abilities?.querySelectorAll<HTMLElement>('.ab-slot').forEach((el) => {
    const a = el.dataset.ab ? ABILITIES[el.dataset.ab] : undefined
    const ready = !!a && s.running && canAfford(s, a.cost)
    el.classList.toggle('ready', ready)
    if (V!.coach) setCoachArrow(el, ready)
  })
  V.refs.tactics?.querySelectorAll<HTMLElement>('.tac-btn').forEach((el) => {
    el.classList.toggle('on', s.running && el.dataset.tac === s.tactic)
  })
  const maneuver = s.tactic === 'maneuver'
  if (V.refs.biasrow) V.refs.biasrow.style.display = maneuver ? '' : 'none'
  if (V.refs.standnote) V.refs.standnote.style.display = maneuver ? 'none' : ''
  V.refs.biasrow?.querySelectorAll<HTMLElement>('.bias-chip').forEach((el) => {
    const b = s.maneuverBias
    el.classList.toggle('on', !!b && el.dataset.axis === b.axis && +el.dataset.value! === b.value)
  })
  if (V.coach) {
    // guided Tactics stage: beckon the Maneuver button while on Stand Ground (the default), then
    // the bias row once a charge is banked (pick what to do with it)
    setCoachArrow(V.refs.tactics, COACH.await === 'tactic' && !maneuver)
    setCoachArrow(V.refs.biasrow, COACH.await === 'tactic' && s.charges > 0 && maneuver)
    // staged tutorial cues — teach how to GET there, scoped to the current guided stage:
    const cue = V.coachCue
    // Tactics stage: STRONG glow on Move cards + LIGHT pulse on the gauge (until a charge banks).
    const moveGlow = cue === 'moves' && s.charges === 0
    updateMoveHints(moveGlow)
    document.querySelector('[data-sec="tactics"] .tacmeter')?.classList.toggle('meterhint', moveGlow)
    // Abilities stage: while nothing's affordable, glow the colour the loadout needs most; once an
    // ability lights up, drop the card glow (its own ready-arrow takes over the focus).
    const anyAfford = V.loadout.some((id) => { const a = ABILITIES[id]; return !!a && canAfford(s, a.cost) })
    updateColorHints(cue === 'mana' && !anyAfford ? V.manaColor : null)
  }
}

/** The colour the loadout needs most: sum each ability's [r,g,b] cost across the loadout, take the max. */
function dominantManaColor(loadout: string[]): number {
  const tot = [0, 0, 0]
  for (const id of loadout) { const a = ABILITIES[id]; if (a) for (let i = 0; i < 3; i++) tot[i] += a.cost[i] }
  return tot[0] >= tot[1] && tot[0] >= tot[2] ? 0 : tot[1] >= tot[2] ? 1 : 2
}

/** Coach cue: STRONG-glow only cards that can actually COMPLETE a set right now (never a dead end).
 *  `requireWholeSet` = glow a card only when its whole reachable set matches the trait (colour cue:
 *  an all-of-that-colour set builds that mana); otherwise glow any matching card that sits in any
 *  reachable set (Move cue: a Move in any set adds tactics). Once a card is picked, the cue narrows
 *  to just the selection's set-mates. */
function paintCardCue(cls: 'movehint' | 'colorhint', match: (c: Card) => boolean, on: boolean, requireWholeSet: boolean): void {
  if (!V) return
  const s = V.state
  const want = new Set<number>()
  if (on) {
    const sets = findSets(s.board)
    const reachable = (x: number) => s.board[x] != null && !s.locked.has(x) && !s.pending.has(x)
    for (const t of sets) {
      if (!t.every(reachable)) continue
      if (requireWholeSet) {
        if (t.every((x) => match(s.board[x] as Card))) for (const x of t) want.add(x)
      } else {
        for (const x of t) if (match(s.board[x] as Card)) want.add(x) // any matching card in a completable set
      }
    }
    for (const x of V.selected) want.delete(x) // the picked card wears the selection ring, not the cue
    if (V.selected.length > 0) {
      const g = glowSet(s, V.selected, sets)
      const mates = new Set(g.set.keys())
      if (g.complete >= 0) mates.add(g.complete)
      for (const i of [...want]) if (!mates.has(i)) want.delete(i)
    }
  }
  V.refs.board?.querySelectorAll<HTMLElement>('.card').forEach((el) => {
    el.classList.toggle(cls, el.dataset.i != null && want.has(+el.dataset.i))
  })
}
const updateMoveHints = (on: boolean) => paintCardCue('movehint', (c) => c[1] === SHAPE_MOVE, on, false) // any set with a Move
const updateColorHints = (color: number | null) => paintCardCue('colorhint', (c) => c[0] === color, color != null, true) // all-of-colour sets

/** A single beckoning arrow above an element (added on the transition into "usable", removed when not). */
function setCoachArrow(el: HTMLElement | undefined, on: boolean): void {
  if (!el) return
  const has = el.querySelector(':scope > .coach-arrow')
  if (on && !has) el.appendChild($(`<span class="coach-arrow">▼</span>`))
  else if (!on && has) has.remove()
}

// ---- dispatch + event interpretation ----
function dispatch(action: CombatAction): void {
  if (!V) return
  const { run, events } = runReduce(V.run, action, V.deps)
  const state = run.combat
  V.run = run
  V.state = state
  V.actions.push(action) // record the session log (the seam): a server could replay these
  // drop any selected slot a board verb just removed (transmute/shatter), so the glow can't dangle
  V.selected = V.selected.filter((i) => state.board[i] != null && !state.locked.has(i))
  interpret(events)
  if (boardSignature(state) !== V.boardSig) renderBoard(verbsFromEvents(events))
  if (events.some((e) => e.type === 'consumableUsed')) renderConsumables() // a slot was spent
  updateBar()
}

/** Per-dispatch slot→verb map: lets the crossfade pick a verb-specific motion (resolve pop / transmute
 *  morph / destruction boom / reform materialize) instead of one generic fade. Motion = which verb. */
type CardVerb = 'resolve' | 'transmute' | 'boom' | 'reform'
function verbsFromEvents(events: CombatEvent[]): Map<number, CardVerb> {
  const m = new Map<number, CardVerb>()
  for (const e of events) {
    if (e.type === 'setResolved') for (const i of e.slots) m.set(i, 'resolve')
    else if (e.type === 'cardsTransmuted') for (const i of e.slots) m.set(i, e.hostile ? 'boom' : 'transmute') // enemy razed it → boom; your/trick/drift transmute → calm morph
    else if (e.type === 'cardsShattered') for (const i of e.slots) m.set(i, 'boom')
    else if (e.type === 'cardsReformed') for (const i of e.slots) m.set(i, 'reform')
  }
  return m
}

/** Full-screen feedback priority — a wound out-shouts a trap spring (TRAPS layering scheme). */
const FLASH_PRI: Record<string, number> = { wound: 3, trap: 2, trick: 2 }
function interpret(events: CombatEvent[]): void {
  if (!V) return
  const MANA = ['Fire', 'Nature', 'Frost']
  logGroup = $(`<div class="loggroup"></div>`) // collect this batch's log lines into one cascade unit
  bumpTurn() // advance the flavour-variety counter once per batch (verbs rotate, stable across re-renders)
  const foe = V.state.foe.name
  const voice = voiceOf(GAMEDATA.creatures[V.state.foe.id]?.voice)
  // collect full-screen feedback and flush once: one flash (highest priority), one hitstop, staggered bursts
  let flashKind: 'trap' | 'trick' | 'wound' | null = null
  let flashPow = 1
  let hs = 0
  let matchSlots: number[] | null = null // the set just played (for the reactive-transmute ripple)
  const bursts: [string, string, string, string, ('trick' | 'wound')?][] = []
  const queueFlash = (k: 'trap' | 'trick' | 'wound', pow = 1) => { if (!flashKind || FLASH_PRI[k] > FLASH_PRI[flashKind]) { flashKind = k; flashPow = pow } }
  // a player-initiated action (ability/potion) owns its line; its damage/heal/block/mana fold INTO it
  // rather than spawning a separate, generic "you land a blow" line afterward
  let actor: { el: HTMLElement; base: string; dmg: number; magic: boolean; heal: number; block: number; mana: [number, number, number] } | null = null
  for (const e of events) {
    switch (e.type) {
      case 'enemyDamaged': {
        if (e.immune) { log('Swords pass through — only magic bites this foe.', 'foe'); floatBoard('blocked', 'var(--ink-faint)', 'enemy'); break } // fixed rule line — never varied
        floatBoard(`-${e.amount}`, e.magic ? 'var(--gold)' : 'var(--red)', 'enemy')
        flashStat('ehpv')
        spriteReact('foe', 'sphit'); spriteReact('you', 'splunge')
        V.stats.dealt += e.amount
        if (actor) { actor.dmg += e.amount; if (e.magic) actor.magic = true; break } // fold into the action's own line
        const tier = tierOf(e.amount, 12)
        if (e.magic) log(`${magicLead()} — drains <b>${e.amount}</b>.`, 'you')
        else log(`You land ${strikeWord(tier)} — <b>−${e.amount}</b>.`, tier === 'heavy' ? 'you big' : 'you')
        break
      }
      case 'enemyHealed':
        log(`The ${foe} ${pick(voice.heal)} — <b>+${e.amount}</b>.`, 'foe')
        floatBoard(`+${e.amount}`, 'var(--red)', 'enemy')
        break
      case 'playerHealed':
        floatBoard(`+${e.amount}`, 'var(--green)', 'you')
        V.stats.healed += e.amount
        if (actor) { actor.heal += e.amount; break }
        log(`You ${healWord()} — <b>+${e.amount}</b> HP.`, 'you')
        break
      case 'blockGained':
        floatBoard(`+${e.amount}🛡`, 'var(--blue)', 'you')
        if (actor) { actor.block += e.amount; break }
        log(`You brace — <b>+${e.amount}</b> Defend.`, 'you')
        break
      case 'manaGained':
        if (actor) for (let i = 0; i < 3; i++) actor.mana[i] += e.mana[i] // fold potion/ability mana into its line
        break
      case 'chargesGained':
        if (e.source === 'overflow') { // Block past the cap converts to charges — call it out
          log(`Defend overflows — <b>+${e.amount}</b> Tactics charge${e.amount > 1 ? 's' : ''}.`, 'you')
          floatBoard(`+${e.amount} ⚡`, 'var(--gold)', 'you')
        }
        break
      case 'cardsTransmuted': {
        // tug attribution: remember who pulled each slot (tints the reform) + a loud glyph now
        const src = e.source
        if (src === 'churn' || src === 'drift' || src === 'trick') {
          for (const i of e.slots) V.morphSrc.set(i, src)
          const glyph = src === 'churn' ? '⚙' : src === 'trick' ? '✦' : (V.state.foe.drift?.icon ?? '🌫')
          const color = src === 'churn' ? 'var(--phos)' : src === 'trick' ? 'var(--trick)' : 'var(--warn)'
          for (const i of e.slots) floatAtSlot(i, glyph, color)
        } else if (src === 'trap') {
          for (const i of e.slots) V.morphSrc.set(i, 'trap')
        }
        // dev reshape-share: churn + player casts = you; drift/trap/trick = the enemy's pull
        if (src === 'drift' || src === 'trap' || src === 'trick') V.dev.reshapeFoe += e.slots.length
        else V.dev.reshapeYou += e.slots.length
        if (src === 'churn') V.dev.churns += e.slots.length
        break
      }
      case 'chargesDrained':
        log(`The ${foe} rattles your focus — <b>−${e.amount}</b> Tactics charge${e.amount > 1 ? 's' : ''}.`, 'foe')
        break
      case 'warded': {
        log(`<b>Stand Ground</b> — the ${e.what === 'lock' ? 'lock' : e.what === 'shatter' ? 'blow\u2019s shatter' : 'warp'} breaks against your line (−1 charge).`, 'you')
        floatBoard('🛡 warded', 'var(--gold)', 'you')
        V.dev.wards++
        // the ward BEAT: burn the pip on the gauge + a one-beat shield shimmer on the board edge
        const meter = document.querySelector('[data-sec="tactics"] .tacmeter')
        meter?.classList.remove('wardpulse'); void (meter as HTMLElement | null)?.offsetWidth; meter?.classList.add('wardpulse')
        const bw = V.refs.boardwrap
        if (bw) { bw.classList.remove('wardshield'); void bw.offsetWidth; bw.classList.add('wardshield') }
        break
      }
      case 'buffFaded':
        log(`<span style="opacity:.85">✧ ${e.label}.</span>`, 'you')
        break
      case 'playerBlocked':
        log(`The ${foe} ${pick(voice.hit)} you — your guard holds, <b>no damage</b>.`, 'foe')
        break
      case 'abilityCast': {
        const base = ABILITY_FLAVOR[e.id] ?? `You cast <b>${ABILITIES[e.id]?.name ?? e.id}</b>`
        actor = { el: log(base, 'you')!, base, dmg: 0, magic: false, heal: 0, block: 0, mana: [0, 0, 0] }
        coachNotify('ability') // guided intro: "cast an ability" step
        break
      }
      case 'abilityFizzled':
        log(`<b>${ABILITIES[e.id]?.name ?? e.id}</b> fizzles — no target.`, 'foe') // fixed rule line
        break
      case 'passiveProc':
        pulsePassive(e.id)
        break
      case 'tacticChanged':
        log(e.tactic === 'stand'
          ? 'You <b>Stand Ground</b> — charges now ward the board against enemy meddling.'
          : 'You shift to <b>Maneuver</b> — charges now churn the deadest cards toward your bias.', 'you')
        break
      case 'biasChanged': {
        const lbl = e.bias ? BIAS_CHIPS.find((b) => b.axis === e.bias!.axis && b.value === e.bias!.value)?.tip : null
        log(e.bias && lbl ? `Maneuver set — <i>${lbl.toLowerCase()}</i>.` : 'Maneuver bias cleared — charges hold.', 'you')
        if (e.bias) coachNotify('tactic') // guided intro: "set your bias" step
        break
      }
      case 'consumableUsed': {
        const base = `You use <b>${e.name}</b>`
        actor = { el: log(base, 'you')!, base, dmg: 0, magic: false, heal: 0, block: 0, mana: [0, 0, 0] }
        break
      }
      case 'fled':
        endScreen('flee')
        break
      case 'manaDrained':
        log(`The ${foe} ${drainWord()} your ${MANA[e.color]} — <b>−${e.amount}</b>.`, 'foe')
        break
      case 'clockChanged':
        if (e.deltaSeconds > 0) kickClock() // a Move shoved the strike back → the timer bar recoils
        break
      case 'setResolved': {
        V.dev.matches++
        V.stats.sets++
        matchSlots = e.slots
        manaSparks(e.mana, e.slots) // fly colour sparks to the mana pips — makes match→mana visible
        coachNotify('match') // guided intro: "make your first set" step
        // give every match a line; a damaging match already logged its strike (enemyDamaged)
        if (e.damage > 0) break
        const parts: string[] = []
        if (e.block > 0) parts.push(`<b>+${e.block}</b> block`)
        if (e.boot > 0) parts.push(`<b>+${e.boot}s</b> clock`)
        const m = e.mana.findIndex((x) => x === 3)
        if (m >= 0) parts.push(`<b>+3 ${MANA[m]}</b>`)
        else if (e.mana.some((x) => x > 0)) parts.push('<b>+1</b> each essence')
        log(`Set — ${joinClauses(parts) || 'resolved'}.`, 'you') // natural clauses, data bolded
        break
      }
      case 'playerDamaged': {
        const tier = tierOf(e.amount, V.state.foe.damage)
        const data = `<b>−${e.amount}</b>${e.absorbed ? ` (${e.absorbed} blocked)` : ''}`
        log(`The ${foe} ${pick(voice.hit)} you — ${strikeWord(tier, 1)}, ${data}.`, tier === 'heavy' ? 'foe big' : 'foe')
        V.stats.taken += e.amount; V.stats.blocked += e.absorbed
        queueFlash('wound', 0.8 + Math.min(1.2, e.amount / Math.max(1, V.state.foe.damage))) // severity-scaled flash
        spriteReact('you', 'sphit'); spriteReact('foe', 'splunge')
        floatBoard(`-${e.amount} HP`, 'var(--red)', 'you')
        flashStat('phpv')
        bursts.push(['💥', '✷ struck', foe, e.absorbed ? `−${e.amount} HP · ${e.absorbed} blocked` : `−${e.amount} HP`, 'wound'])
        hs = Math.max(hs, 150)
        break
      }
      case 'triggerSprung': {
        if (e.trigger.on === 'match' && e.trigger.kind !== 'trick') V.dev.springs++
        const trick = e.trigger.kind === 'trick'
        pulseTrig(e.trigger) // light up the named chip in the strip — builds the rule→flash association
        if (e.trigger.quiet) { log(`<span style="opacity:.7">${e.trigger.icon ?? '◦'} ${e.trigger.name}.</span>`, 'foe'); break } // ambient drift: calm, no flourish
        log(`<b>${e.trigger.name}</b> — ${e.label}.`, trick ? 'trick' : 'foe')
        if (!trick) V.stats.traps++
        queueFlash(trick ? 'trick' : 'trap')
        bursts.push([e.trigger.icon ?? (trick ? '✦' : '⚠'), trick ? '✦ trick' : '⚠ trap', e.trigger.name, e.label, trick ? 'trick' : undefined])
        hs = Math.max(hs, 120)
        break
      }
      case 'foeChanged':
        log(`The foe falls — <b>${e.name}</b> rises next.`, 'win')
        renderStrip()
        if (V.refs.foename) V.refs.foename.textContent = e.name + (V.run.sequence ? `  ·  ${V.run.seqIdx + 1}/${V.run.sequence.length}` : '')
        if (V.refs.foedesc) V.refs.foedesc.innerHTML = V.state.foe.desc ?? ''
        renderBoard()
        // brief the next foe (freeze until Engage)
        V.paused = true
        showBriefing(() => { if (V) { V.paused = false; V.lastT = 0; hitstop(START_GRACE_MS) } }) // grace on each gauntlet foe too
        break
      case 'won':
        log(`The ${foe} collapses. <b>Victory!</b>`, 'win')
        endScreen('win')
        break
      case 'lost':
        log(`You fall in battle. <b>Defeat.</b>`, 'foe')
        endScreen('lose')
        break
    }
  }
  // render the folded action line: "You use Fire Breathing Potion — −16." / "You Cleave — ... — −4 damage."
  if (actor) {
    const fx: string[] = []
    if (actor.dmg) fx.push(actor.magic ? `drains <b>−${actor.dmg}</b>` : `<b>−${actor.dmg}</b> damage`)
    if (actor.heal) fx.push(`<b>+${actor.heal}</b> HP`)
    if (actor.block) fx.push(`<b>+${actor.block}</b> Block`)
    const mt = actor.mana
    if (mt[0] || mt[1] || mt[2]) {
      if (mt[0] === mt[1] && mt[1] === mt[2]) fx.push(`<b>+${mt[0]}</b> each essence`)
      else mt.forEach((v, i) => { if (v) fx.push(`<b>+${v}</b> ${MANA[i]}`) })
    }
    actor.el.innerHTML = actor.base + (fx.length ? ` — ${fx.join(', ')}` : '') + '.'
  }
  // flush the log cascade: the batch is prepended as one unit (newest action on top); within it the action
  // reads first, its consequences indented below
  const grp = logGroup
  logGroup = null
  if (grp && grp.childElementCount) V.refs.log.prepend(grp)
  // flush coalesced full-screen feedback: one flash (loudest wins), one hitstop, bursts staggered so a
  // multi-effect instant (wound + trap in the same match) sequences legibly instead of compositing.
  if (flashKind) flash(flashKind, flashPow)
  if (hs) hitstop(hs)
  bursts.forEach((b, k) => { if (k === 0) burst(...b); else sceneTimeout(() => burst(...b), k * 80) })
  // reactive herding: a foe transmute that fired in response to your match ripples out FROM your match
  if (matchSlots && events.some((e) => e.type === 'cardsTransmuted')) ripple(matchSlots)
}

function flash(kind: 'trap' | 'trick' | 'wound', pow = 1): void {
  if (!V) return
  const w = V.refs.boardwrap
  w.classList.remove('flash-trap', 'flash-trick', 'flash-wound')
  w.style.setProperty('--fp', String(pow)) // severity → flash radius/intensity (nibble vs bite)
  void w.offsetWidth
  w.classList.add('flash-' + kind)
}

/** When a single dispatch (a Set, a tactic/ability/potion press) fans out into several log lines, they
 *  are collected into one `.loggroup` so the cascade reads as a unit, visually split from other actions. */
let logGroup: HTMLElement | null = null
function log(html: string, cls: string): HTMLElement | null {
  if (!V) return null
  const line = $(`<div class="${cls}">${html}</div>`)
  if (logGroup) logGroup.appendChild(line) // event order within the action; the group is flushed as one unit
  else V.refs.log.prepend(line)
  return line
}

/** A combat number that rises and fades over the board. `side` biases it left (you) / right (enemy). */
/** A small attribution glyph rising off one card — WHO pulled this slot (loud to start; tune down). */
function floatAtSlot(slot: number, text: string, color: string): void {
  const layer = V?.refs.floatlayer
  const card = V?.refs.board.querySelector(`[data-i="${slot}"]`)
  const bw = V?.refs.boardwrap?.getBoundingClientRect()
  if (!layer || !card || !bw) return
  const r = card.getBoundingClientRect()
  const el = $(`<div class="floater slotglyph">${text}</div>`)
  el.style.color = color
  el.style.left = `${r.left - bw.left + r.width / 2 - 8}px`
  el.style.top = `${r.top - bw.top + 4}px`
  layer.appendChild(el)
  void el.offsetWidth
  el.classList.add('go')
  sceneTimeout(() => el.remove(), 1000)
}

function floatBoard(text: string, color: string, side?: 'you' | 'enemy'): void {
  const layer = V?.refs.floatlayer
  if (!layer) return
  const el = $(`<div class="floater">${text}</div>`)
  el.style.color = color
  el.style.left = side === 'you' ? `${14 + Math.random() * 16}%` : side === 'enemy' ? `${64 + Math.random() * 18}%` : `${34 + Math.random() * 32}%`
  el.style.top = `${30 + Math.random() * 26}%`
  layer.appendChild(el)
  void el.offsetWidth
  el.classList.add('go')
  setTimeout(() => el.remove(), 1000)
}

/** A centered infographic burst — icon + label + name + effect line. For sprung traps/tricks + hits. */
function burst(icon: string, label: string, name: string, eff: string, kind?: 'trick' | 'wound'): void {
  let layer = document.getElementById('burstlayer')
  if (!layer) { layer = $(`<div id="burstlayer"></div>`); document.body.appendChild(layer) }
  const stack = layer.querySelectorAll('.burst').length
  const b = $(`<div class="burst${kind ? ' ' + kind : ''}"><span class="bui">${icon}</span><span><span class="bul">${label}</span><br><span class="bun">${name}</span>${eff ? `<div class="bue">${eff}</div>` : ''}</span></div>`)
  b.style.top = `${42 - stack * 8}%`
  layer.appendChild(b)
  void b.offsetWidth
  b.classList.add('go')
  setTimeout(() => { b.classList.remove('go'); setTimeout(() => b.remove(), 240) }, 2200)
}

/** Centroid of board slots in viewport coords (for spark/ripple origins); falls back to board center. */
function slotsCentroid(slots: number[]): { x: number; y: number } | null {
  if (!V) return null
  const bw = V.refs.boardwrap?.getBoundingClientRect()
  if (!bw) return null
  const rects = slots.map((i) => V!.refs.board.querySelector(`[data-i="${i}"]`)?.getBoundingClientRect()).filter(Boolean) as DOMRect[]
  if (!rects.length) return { x: bw.left + bw.width / 2, y: bw.top + bw.height / 2 }
  return { x: rects.reduce((a, r) => a + r.left + r.width / 2, 0) / rects.length, y: rects.reduce((a, r) => a + r.top + r.height / 2, 0) / rects.length }
}

/** Fly colour sparks from a resolved set to the matching mana pip — the match→mana economy, made visible.
 *  Staggered + slow on purpose so the eye can follow each one (CSS does the ~1s flight). */
function manaSparks(mana: [number, number, number], slots: number[]): void {
  if (!V) return
  const o = slotsCentroid(slots)
  if (!o) return
  const PIP = ['m0', 'm1', 'm2']
  const COL = ['var(--c0)', 'var(--c1)', 'var(--c2)']
  let idx = 0 // global order across colours → an even, catchable stagger
  for (let c = 0; c < 3; c++) {
    if (mana[c] <= 0) continue
    const pip = V.refs[PIP[c]]?.getBoundingClientRect()
    if (!pip) continue
    const tx = pip.left + pip.width / 2, ty = pip.top + pip.height / 2
    const count = Math.min(3, mana[c])
    for (let k = 0; k < count; k++) {
      const sp = $(`<div class="mspark"></div>`)
      const sx = o.x + (k - (count - 1) / 2) * 14
      sp.style.cssText = `left:${sx}px;top:${o.y}px;color:${COL[c]};background:${COL[c]}`
      document.body.appendChild(sp)
      const delay = 40 + idx * 110 // launch each spark a beat after the last
      idx++
      sceneTimeout(() => {
        if (!sp.isConnected) return
        sp.style.transform = `translate(${tx - sx}px,${ty - o.y}px) scale(.4)`
        sp.style.opacity = '0'
      }, delay)
      sceneTimeout(() => sp.remove(), delay + 1300) // after the ~1.1s flight
    }
  }
}

/** A one-shot ring expanding from the played set — shows the foe's reactive warp was CAUSED by your match. */
function ripple(slots: number[]): void {
  if (!V) return
  const o = slotsCentroid(slots)
  const bw = V.refs.boardwrap?.getBoundingClientRect()
  const layer = V.refs.floatlayer
  if (!o || !bw || !layer) return
  const r = $(`<div class="ripple"></div>`)
  r.style.left = `${o.x - bw.left}px`
  r.style.top = `${o.y - bw.top}px`
  layer.appendChild(r)
  r.addEventListener('animationend', () => r.remove())
}

/** Recoil the attack-timer bar when a Move shoves the strike back — tempo, made tactile. */
function kickClock(): void {
  const el = document.querySelector('.timerbar')
  if (!el) return
  el.classList.remove('shove')
  void (el as HTMLElement).offsetWidth
  el.classList.add('shove')
}

/** A brief impact freeze — pause the engine clock for `ms` so a hit/spring lands with weight. */
function hitstop(ms: number): void {
  if (V) V.hitstopUntil = Math.max(V.hitstopUntil, performance.now() + ms)
}

/** Punch a HUD number (HP) when it changes — directs the eye to where the cost/hit landed. */
function flashStat(ref: string): void {
  const el = V?.refs[ref]
  if (!el) return
  el.classList.remove('hit')
  void el.offsetWidth
  el.classList.add('hit')
}

/** Re-trigger the proc pulse on the strip chip that just fired (incl. the dungeon-drift chip). */
function pulseTrig(trigger: Trigger): void {
  const idx = V?.state.foe.triggers.indexOf(trigger) ?? -1
  const el = trigger === V?.state.foe.drift
    ? (V?.refs.strip?.querySelector('[data-trig="drift"]') as HTMLElement | null)
    : idx >= 0 ? (V?.refs.strip?.querySelector(`[data-trig="${idx}"]`) as HTMLElement | null) : null
  if (!el) return
  el.classList.remove('proc')
  void el.offsetWidth
  el.classList.add('proc')
}

/** Re-trigger a one-shot animation class on a duelist sprite (hit recoil / attack lunge). */
function spriteReact(who: 'you' | 'foe', cls: 'sphit' | 'splunge'): void {
  const el = who === 'you' ? V?.refs.spyou : V?.refs.spfoe
  if (!el) return
  el.classList.remove('sphit', 'splunge')
  void el.offsetWidth
  el.classList.add(cls)
}

/** Re-trigger the gold pulse on a passive chip when it fires. */
function pulsePassive(id: string): void {
  const el = V?.refs.passives?.querySelector(`[data-passive="${id}"]`) as HTMLElement | null
  if (!el) return
  el.classList.remove('proc')
  void el.offsetWidth
  el.classList.add('proc')
}

// ---- per-frame HUD ----
function updateBar(): void {
  if (!V) return
  const s = V.state
  const pct = (a: number, b: number) => `${b > 0 ? Math.max(0, Math.min(100, (a / b) * 100)) : 0}%`
  V.refs.php.style.width = pct(s.playerHP, s.playerMax)
  V.refs.ehp.style.width = pct(s.enemyHP, s.enemyMax)
  V.refs.phpv.textContent = `${s.playerHP}/${s.playerMax}`
  V.refs.ehpv.textContent = `${s.enemyHP}/${s.enemyMax}`
  V.refs.enemylab.textContent = s.foe.name
  V.refs.tac.style.width = `${(s.charges / CHARGE_CAP) * 100}%`
  const spinup = s.now < s.tacticReadyAt
  V.refs.tac.classList.toggle('spinup', spinup)
  V.refs.tacv.textContent = spinup ? 're-forming…' : `${s.charges}/${CHARGE_CAP}`
  V.refs.m0.textContent = String(s.mana[0])
  V.refs.m1.textContent = String(s.mana[1])
  V.refs.m2.textContent = String(s.mana[2])
  V.refs.block.textContent = s.block > 0 ? `🛡 ${s.block}` : ''
  V.refs.block.classList.toggle('on', s.block > 0)
  // active transient buffs — persist on the bar while live, vanish as each fades (logged separately)
  const buffs: string[] = []
  if (s.attackFrozen) buffs.push('👻 Invisible')
  if (s.nextSetDamageMult > 1) buffs.push(`💪 ×${s.nextSetDamageMult}`)
  if (s.tickSuppressedUntil > s.now) buffs.push(`⏳ ${Math.ceil((s.tickSuppressedUntil - s.now) / 1000)}s`)
  V.refs.buffind.textContent = buffs.join('  ')
  V.refs.buffind.classList.toggle('on', buffs.length > 0)
  const remain = Math.max(0, (s.nextAttackAt - s.now) / 1000)
  const clk = V.refs.clock
  clk.textContent = s.running ? `${Math.ceil(remain)}s` : '—'
  clk.classList.toggle('low', remain <= 5 && remain > 2.5)
  clk.classList.toggle('crit', remain <= 2.5)
  // the attack timer empties as the strike nears (fraction of the foe's cadence)
  const frac = s.foe.cadence > 0 ? Math.max(0, Math.min(1, remain / s.foe.cadence)) : 0
  V.refs.atkfill.style.width = `${s.running ? frac * 100 : 100}%`
  V.refs.atkfill.classList.toggle('low', remain <= 5 && remain > 2.5)
  V.refs.atkfill.classList.toggle('crit', remain <= 2.5)
  // ambient dread: a low-HP vignette + HP-bar glow band (transitions, not animations → survive the pause)
  const hpf = s.playerMax > 0 ? s.playerHP / s.playerMax : 1
  const band = !s.running ? '' : hpf <= 0.35 ? 'crit' : hpf <= 0.7 ? 'low' : ''
  const tint = document.getElementById('ptint')
  if (tint) { tint.classList.toggle('low', band === 'low'); tint.classList.toggle('crit', band === 'crit') }
  V.refs.php.classList.toggle('low', band === 'low')
  V.refs.php.classList.toggle('crit', band === 'crit')
  // live lock countdowns — patch text only (the board is NOT re-rendered per frame); s.now holds in a pause
  if (s.locked.size) for (const [slot, until] of s.locked) {
    const cd = V.refs.board?.querySelector(`[data-i="${slot}"] .lockcd`)
    if (cd) cd.textContent = `${Math.max(0, Math.ceil((until - s.now) / 1000))}s`
  }
  // dim the board during a briefing freeze (but NOT during coaching, where the board is the lesson)
  V.refs.board?.classList.toggle('idle', !!V.paused && !COACH.active)
  V.refs.board?.classList.toggle('teachmates', COACH.active) // tutorial: brighter gold set-mate halos

  // the drift chip's live countdown to its next pull (the rhythm half of tug readability)
  const drift = s.foe.drift
  const dcd = document.getElementById('driftcd')
  if (drift && dcd) {
    const period = drift.every || 5
    const left = Math.max(0, period - (s.tickAccum['drift'] ?? 0))
    dcd.textContent = s.tickSuppressedUntil > s.now ? '⏸' : `next pull ${Math.ceil(left)}s`
  }
  updateTugAndSprites()
  renderDevStats()
  updateCastables()
  // a tutorial popup that needs acknowledgement steps OUTSIDE the game: freeze ALL in-game motion
  // (the engine clock is already frozen via the tick gate) and shade the field, leaving only the popover.
  const paused = !!V.paused
  document.querySelector('.wrap')?.classList.toggle('frozen', paused)
  document.getElementById('coachscrim')?.classList.toggle('show', paused)
  positionCoachPop() // keep the dialog pinned to the foe header through scroll/resize
}

// the tug + dev instruments (board composition, reshape share) — cheap; run per frame off updateBar
const TOKEN_VAL: Record<string, number> = { red: 0, green: 1, blue: 2, attack: 0, defend: 1, move: 2, one: 0, two: 1, three: 2 }
const AXIS_ICONS: Record<string, string[]> = { color: ['🔥', '🌿', '❄'], shape: ['⚔', '🛡', '➤'], number: ['①', '②', '③'], mag: ['①', '②', '③'] }
const axisIdx = (axis: string): number => (axis === 'color' ? 0 : axis === 'shape' ? 1 : 3)

/** The TUG, as board composition: enemy-theme share vs your-bias share over live cards. The bar
 *  shows only when both ends exist (no tug, no rope); the duelist sprites track the same number. */
function updateTugAndSprites(): void {
  if (!V) return
  const s = V.state
  const dungeon = V.run.dungeonId ? GAMEDATA.dungeons[V.run.dungeonId] : null
  const theme = dungeon?.theme ?? null
  const bias = s.tactic === 'maneuver' ? s.maneuverBias : null
  const live = s.board.filter((c, i) => c && !s.pending.has(i)) as Card[]
  const share = (axis: string, value: number): number => (live.length ? live.filter((c) => c[axisIdx(axis)] === value).length / live.length : 0)
  let d = 0 // + = the board leans yours · − = it leans the enemy's (above the uniform 1/3 baseline)
  const themeShare = theme ? share(theme.axis, TOKEN_VAL[theme.value] ?? 0) : 0
  if (theme) d -= themeShare - 1 / 3
  const biasShare = bias ? share(bias.axis, bias.value) : 0
  if (bias) d += biasShare - 1 / 3
  // the bar
  const show = !!theme && !!bias && s.running
  V.refs.tugbar.style.display = show ? '' : 'none'
  if (show) {
    V.refs.tugfoe.textContent = AXIS_ICONS[theme!.axis]?.[TOKEN_VAL[theme!.value] ?? 0] ?? '⚠'
    V.refs.tugyou.textContent = AXIS_ICONS[bias!.axis]?.[bias!.value] ?? '🎯'
    V.refs.tugmarker.style.left = `${Math.max(3, Math.min(97, 50 + d * 75))}%`
  }
  // the duelists (PLACEHOLDER art): the winner ADVANCES across the header, the loser gives ground.
  // Typical differentials are small (±0.1–0.3), so the gain is steep — the walk must be readable.
  const step = Math.max(-1, Math.min(1, d * 3)) * 150
  if (V.refs.spyou) V.refs.spyou.style.transform = `translateX(${Math.max(-18, step)}px)`
  if (V.refs.spfoe) V.refs.spfoe.style.transform = `translateX(${Math.min(18, step)}px) scaleX(-1)`
}

/** The always-on DEV instruments vs design targets (TRAPS §5.5 reshape share, ~30% spring rate). */
function renderDevStats(): void {
  if (!V) return
  const d = V.dev
  const s = V.state
  const total = d.reshapeYou + d.reshapeFoe
  const share = total ? Math.round((d.reshapeYou / total) * 100) : null
  const spring = d.matches ? Math.round((d.springs / d.matches) * 100) : null
  const gimme = d.matches ? Math.round((d.k1 / d.matches) * 100) : null
  const spm = s.now > 10_000 ? (d.matches / (s.now / 60_000)).toFixed(1) : '—'
  const cell = (k: string, v: string, off: boolean) => `<span class="${off ? 'off' : ''}">${k} <b>${v}</b></span>`
  const html = [
    cell('reshape', share == null ? '—' : `${share}% <i>→65–70</i>`, share != null && (share < 60 || share > 78)),
    cell('spring', spring == null ? '—' : `${spring}% <i>→~30</i>`, spring != null && (spring < 15 || spring > 45)),
    cell('sets/min', spm, false),
    cell('gimme', gimme == null ? '—' : `${gimme}%`, false),
    cell('wards', String(d.wards), false),
    cell('churns', String(d.churns), false),
  ].join('')
  const el = V.refs.devstats
  if (el && el.dataset.last !== html) { el.innerHTML = `<span class="dvl">dev</span>${html}`; el.dataset.last = html }
}

// ---- the clock loop ----
function loop(t: number): void {
  if (!V) return
  if (!V.state.running) return
  const dt = V.lastT ? t - V.lastT : 0
  V.lastT = t
  // freeze the engine clock during a coaching/briefing pause or a brief impact hitstop
  const frozen = V.paused || t < V.hitstopUntil
  if (!frozen && dt > 0 && dt < 500) dispatch({ type: 'tick', dtMs: dt })
  updateBar()
  V.raf = requestAnimationFrame(loop)
}

// ---- end ----
function endScreen(result: 'win' | 'lose' | 'flee'): void {
  if (!V) return
  coachFinish() // close any open guided step before the end banner
  V.paused = false // a flee-confirm pause must not survive onto the end card (frozen animations)
  cancelAnimationFrame(V.raf)
  if (V.refs.fleebtn) V.refs.fleebtn.style.display = 'none' // no fleeing a finished fight
  document.getElementById('ptint')?.classList.remove('low', 'crit') // drop the low-HP vignette on the end card
  // persist the hero's HP across the hub↔combat boundary (the seed of the run-attrition layer)
  V.char.hp = Math.max(0, Math.min(V.char.maxHp, V.state.playerHP))
  upsertChar(V.char)
  const text = result === 'win' ? '★ Victory' : result === 'flee' ? '🏃 Fled' : '✖ Defeat'
  const banner = $(`<div class="banner ${result === 'win' ? 'win' : 'lose'}">${text}</div>`)
  const st = V.stats
  const rows: [string, number, string][] = [
    ['Damage dealt', st.dealt, 'var(--red)'],
    ['Damage taken', st.taken, 'var(--warn)'],
    ['Damage blocked', st.blocked, 'var(--blue)'],
    ['HP healed', st.healed, 'var(--green)'],
    ['Sets made', st.sets, 'var(--phos)'],
    ['Traps sprung', st.traps, 'var(--gold)'],
  ]
  const max = Math.max(1, ...rows.map((r) => r[1]))
  const summary = $(`<div class="summary">${rows
    .map(([l, v, c]) => `<div class="feat"><span class="fl">${l}</span><span class="fbar"><span style="width:${(v / max) * 100}%;background:${c}"></span></span><span class="fv">${v}</span></div>`)
    .join('')}</div>`)
  const again = $<HTMLButtonElement>(`<button class="cta" style="display:block;margin:0 auto">▶ Back to town</button>`)
  const root = V.root
  V.refs.boardwrap.replaceChildren(banner, summary, again)
  again.addEventListener('click', () => goScene(characterSelectScene))
}

/* ---- pre-combat briefing ---- */
function cadenceBand(sec: number): string {
  // recalibrated: ~12s = average (Steady), ~10s = quick (Swift), ~8s = very fast (Frenzied)
  return sec >= 40 ? 'Glacial' : sec >= 24 ? 'Torpid' : sec >= 18 ? 'Lumbering' : sec >= 14 ? 'Slow' : sec >= 11 ? 'Steady' : sec >= 9 ? 'Swift' : 'Frenzied'
}
function showBriefing(onEngage: () => void): void {
  if (!V) return
  document.getElementById('briefing')?.remove()
  const f = V.state.foe
  const seq = V.run.sequence
  const stats: [string, string][] = [
    ['HP', String(V.state.enemyMax)],
    ['Damage', `${f.damage}<small> max</small>`],
    ['Speed', `${cadenceBand(f.cadence)}<small> · ${f.cadence}s</small>`],
  ]
  if (f.drift) stats.push(['Drift', `${f.drift.icon ?? ''} ${f.drift.name.replace(/ Drift$/, '')}`])
  const statsHTML = stats.map(([l, v]) => `<div class="bs"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('')
  const tier = f.tier
  // threats reveal in sequence (composition stagger); a trap that punishes the colour you most need is flagged
  const trapsHTML = f.triggers.length
    ? `<div class="btrapshd">Threats</div><div class="btraps">${f.triggers.map((t, i) => `<div class="btrap${t.kind === 'trick' ? ' trick' : ''}" style="animation-delay:${0.12 + i * 0.09}s"><span class="bi">${t.icon ?? (t.kind === 'trick' ? '✦' : '⚠')}</span><div><div class="bn">${t.name}</div><div class="bd">${t.desc ?? ''}</div></div></div>`).join('')}</div>`
    : `<div class="btraps" style="margin-top:14px"><div class="briefnote">No traps — a plain foe. Hit it until it falls.</div></div>`
  const counters = f.triggers.some((t) => t.kind !== 'trick' && countersBuild(t.when))
  const modal = $(`<div id="briefing" class="show"><div class="briefcard">
    ${seq ? `<div class="bseq">Gauntlet · ${V.run.seqIdx + 1} of ${seq.length}</div>` : ''}
    <div class="bhead">${tier ? `<span class="btier ${tier}">${tier}</span>` : ''}<h2 class="bname">${f.name}</h2>${counters ? '<span class="bcounter">⚔ counters your build</span>' : ''}</div>
    ${f.desc ? `<div class="bdesc">${f.desc}</div>` : ''}
    <div class="bstats">${statsHTML}</div>
    ${trapsHTML}
    <button class="cta bob" id="b-engage">▶ Engage</button>
  </div></div>`)
  document.body.appendChild(modal)
  modal.querySelector('#b-engage')!.addEventListener('click', () => { modal.remove(); onEngage() })
}

/* ---- spell target previews (hover an ability slot → ring the cards it would hit) ---- */
function onAbilityHover(e: Event): void {
  if (!V || !V.state.running) return
  const id = ((e.target as HTMLElement).closest('.ab-slot') as HTMLElement | null)?.dataset.ab
  if (id) previewAbility(id)
}
function previewAbility(id: string): void {
  clearPreview()
  const fn = ABILITY_PREVIEW[id]
  if (!fn || !V) return
  const pv = fn(V.state)
  const sure = pv.sure.filter((j) => V!.state.board[j])
  const sureSet = new Set(sure)
  const maybe = pv.maybe.filter((j) => V!.state.board[j] && !sureSet.has(j))
  if (!sure.length && !maybe.length) return
  V.preview = [...sure, ...maybe]
  sure.forEach((j) => V!.refs.board.querySelector(`[data-i="${j}"]`)?.classList.add('tgtsure'))
  maybe.forEach((j) => V!.refs.board.querySelector(`[data-i="${j}"]`)?.classList.add('tgtmaybe'))
}
function clearPreview(): void {
  if (!V?.preview) return
  V.preview.forEach((j) => V!.refs.board.querySelector(`[data-i="${j}"]`)?.classList.remove('tgtsure', 'tgtmaybe'))
  V.preview = null
}

/* ============================================================
   COACHING LAYER (TODO §3) — a reusable teaching harness over four primitives:
   PAUSE (V.paused, honored by the clock loop) · SECTION GATES (dim a region until its
   stage) · SPOTLIGHT (scrim + ringed target) · POPOVER (the freeze-and-explain card).
   Affordance arrows (3a) live in updateCastables. The guided intro (3b) is DATA below.
   ============================================================ */
interface GuidedStep {
  icon: string
  title: string
  body: string
  spot?: string | null // selector to ring (and, with `hold`, dim the rest)
  hold?: boolean // freeze + explain (Next to continue)
  cue?: 'moves' | 'mana' // which board card-glow cue this stage teaches
  await?: 'match' | 'ability' | 'tactic' // un-freeze and wait for the player to DO it
  done?: string // the "why" payoff — replaces the body once the criteria is met (what/how → why)
  reveal?: string[] // section names to un-dim at this stage
  hint?: string
  finishLabel?: string
}
const COACH: { active: boolean; steps: GuidedStep[]; idx: number; await: string | null } = { active: false, steps: [], idx: 0, await: null }

// named UI regions the guided match reveals one stage at a time
const COACH_SECTIONS: Record<string, string> = { abilities: '[data-sec="abilities"]', tactics: '[data-sec="tactics"]', traps: '#strip' }
function setSectionEnabled(name: string, on: boolean): void {
  const sel = COACH_SECTIONS[name]
  if (sel) document.querySelectorAll(sel).forEach((el) => el.classList.toggle('coach-locked', !on))
}
const lockAllSections = () => { for (const n in COACH_SECTIONS) setSectionEnabled(n, false) }
const unlockAllSections = () => { for (const n in COACH_SECTIONS) setSectionEnabled(n, true) }

// ring the target(s) — a highlight on interactive (await) steps. The field-wide shade is the pause
// scrim (driven in updateBar), so rings are only used while the player can act (never during a freeze).
function coachSpotlight(sel: string | null): void {
  document.querySelectorAll('.coach-spot').forEach((e) => e.classList.remove('coach-spot'))
  if (sel) document.querySelectorAll(sel).forEach((e) => e.classList.add('coach-spot'))
}

/** Anchor the coach popover OVER the foe header (name/desc) — information dialogs cover that panel,
 *  never the play area, so awaited steps (press Maneuver, pick a bias…) stay fully clickable.
 *  Capped to the header's footprint; the body scrolls if a step's text runs long. */
function positionCoachPop(): void {
  const pop = document.getElementById('coachpop')
  if (!pop || !pop.classList.contains('show')) return
  const head = document.querySelector('.headpanel')
  if (!head) { pop.style.cssText = ''; return } // no combat header (shouldn't happen) → CSS fallback
  const r = head.getBoundingClientRect()
  pop.style.left = `${r.left}px`
  pop.style.top = `${r.top}px`
  pop.style.width = `${r.width}px`
  pop.style.maxHeight = `${Math.max(195, r.height) + 6}px`
  pop.style.transform = 'none'
}

// build the scrim + popover once, lazily (kept out of the static markup)
function buildCoachUI(): void {
  if (document.getElementById('coachscrim')) return
  document.body.appendChild($(`<div id="coachscrim"></div>`))
  const pop = $(`<div id="coachpop">
    <div class="cphd"><span class="cpicon" id="cp-icon">🎓</span><span class="cptitle" id="cp-title"></span></div>
    <div class="cpbody" id="cp-body"></div><div class="cphint" id="cp-hint"></div>
    <div class="cpfoot"><span class="cpstep" id="cp-step"></span>
    <span class="cpbtns"><button id="cp-skip">Skip intro</button><button class="primary" id="cp-next">Next ▸</button></span></div></div>`)
  document.body.appendChild(pop)
  pop.querySelector('#cp-next')!.addEventListener('click', () => { if (!COACH.await) coachAdvance() })
  pop.querySelector('#cp-skip')!.addEventListener('click', coachFinish)
}

// the guided intro script (3b): a gradual reveal, ONE play-element per stage
const GUIDED_STEPS: GuidedStep[] = [
  { icon: '🃏', title: 'Read the board', hold: true,
    body: 'Every card shows three traits — a <b>colour</b>, a <b>shape</b>, and a <b>number</b> (1–3). The clock is frozen; take your time looking them over.' },
  { icon: '✨', title: 'Make your first set', spot: '#board', await: 'match',
    hint: '▸ Click cards on and off to watch the gold set-mates light up, then complete a set.',
    body: 'A <b>set</b> is three cards where each trait is <b>all the same</b> or <b>all different</b> across the three. Pick any card — its <b>set-mates light up gold</b>. Try clicking a few cards on and off to see how the possibilities shift; pick a second and the card that <b>finishes the set</b> glows brightest. (If a pair can’t finish, both turn <b>red</b>.) Complete a set now.',
    done: 'Nice. A set resolves all three cards at once — that one act does several things together: <b>Attacks</b> deal damage, <b>Defends</b> raise <b>Block</b> that soaks the enemy\'s next hit, and <b>Moves</b> shove the attack timer back. The <b>colours</b> feed mana too: three of one colour banks a big chunk of that element, one-of-each banks a little of all three. Every match is offence, defence, tempo, and resources in one move.' },
  { icon: '⚠️', title: 'Watch for traps', spot: '#strip', reveal: ['traps'], hold: true,
    body: "Tougher foes carry <b>traps</b> — rules that punish (or reward!) certain matches, shown in the <b>trap strip</b> above the board. This dummy has none, but the <b>Training · Gauntlet</b> has foes whose lines you must read, dodge, or deliberately spring." },
  { icon: '🎯', title: 'Use Tactics', reveal: ['tactics'], await: 'tactic', cue: 'moves',
    hint: '▸ Press ⚔ Maneuver, match a set with a Move (➤) to bank a charge, then pick a bias chip.',
    body: 'Matching <b>Move</b> cards banks <b>Tactics charges</b>. You start in <b>Stand Ground</b> — charges shield your board from enemy meddling. Press <b>⚔ Maneuver</b> to go on the offensive instead: pick a <b>bias</b> — what you want more of — and your charges spend themselves, steadily morphing the deadest card toward it. Swap, bank a charge, and set your bias now.',
    done: 'That is your tide. <b>Maneuver</b> pulls the board toward your build one card at a time, while the dungeon pulls it the other way — a tug-of-war you fund with Moves. <b>Stand Ground</b> banks the same charges as a shield that eats enemy board-meddling (warps, locks, wounds). Swapping tactics resets your charges — pick a stance and commit.' },
  { icon: '🔥', title: 'Cast an ability', reveal: ['abilities'], await: 'ability', cue: 'mana',
    hint: '▸ Match the highlighted cards (all one colour) to bank that mana; when an ability lights up, click it.',
    body: 'Matches also generate <b>mana</b> by colour. The cards of the colour your spells need most are <b>highlighted</b> — match them to bank that mana. When you can afford an ability it lights up with an arrow. Build mana and cast one.',
    done: 'Abilities are your burst — far bigger than a single match: heavy damage, healing, board-warping floods, hard enemy slows. Banking the right colour and spending it at the right moment is how you swing a fight, so read your spells and aim your matches at the mana they need.' },
  { icon: '🎓', title: "You're ready", spot: null, hold: true, finishLabel: 'Begin! ▸',
    body: "That's the whole loop: <b>find sets</b>, dodge traps, bank <b>Tactics</b>, spend <b>mana</b>. The clock resumes when you close this — good luck." },
]

function coachStartGuided(): void {
  // start from a guaranteed-clean slate so a replay can't inherit a prior run's step/await state
  document.getElementById('coachscrim')?.remove()
  document.getElementById('coachpop')?.remove()
  buildCoachUI()
  COACH.active = true
  COACH.steps = GUIDED_STEPS
  COACH.idx = 0
  COACH.await = null
  lockAllSections() // everything but the board starts dark
  coachShowStep(0)
}
function coachShowStep(i: number): void {
  const s = COACH.steps[i]
  if (!s) { coachFinish(); return }
  COACH.idx = i
  COACH.await = s.await ?? null
  ;(s.reveal ?? []).forEach((n) => setSectionEnabled(n, true))
  if (V) { V.paused = !!s.hold; V.coachCue = s.cue ?? null } // hold = freeze; await = let them play
  coachSpotlight(s.hold ? null : (s.spot ?? null)) // rings only while interactive; a frozen step shades all
  const set = (id: string, html: string) => { const el = document.getElementById(id); if (el) el.innerHTML = html }
  set('cp-icon', s.icon)
  set('cp-title', s.title)
  set('cp-body', s.body)
  set('cp-hint', s.hint ?? '')
  set('cp-step', `Step ${i + 1} / ${COACH.steps.length}`)
  const next = document.getElementById('cp-next') as HTMLButtonElement | null
  const pop = document.getElementById('coachpop')
  if (next) { next.textContent = s.finishLabel ?? (i === COACH.steps.length - 1 ? 'Finish' : 'Next ▸'); next.classList.toggle('await', !!COACH.await); next.classList.remove('lit') }
  pop?.classList.toggle('awaiting', !!COACH.await)
  pop?.classList.add('show')
  positionCoachPop()
}
function coachAdvance(): void {
  if (COACH.idx >= COACH.steps.length - 1) { coachFinish(); return }
  coachShowStep(COACH.idx + 1)
}
/** Engine event points call this; if the current step awaits this event, mark it satisfied: freeze
 *  time (clock + tactics drain) and block play input, then light Next so the player advances at will. */
function coachNotify(event: 'match' | 'ability' | 'tactic'): void {
  if (!COACH.active || COACH.await !== event) return
  COACH.await = null // cp-next now advances on click
  if (V) V.paused = true // criteria met → freeze the world until they hit Next
  coachSpotlight(null) // the field-wide shade takes over; drop the per-target ring
  // swap the body to the "why" payoff — the first panel said what/how, this one says why it mattered
  const step = COACH.steps[COACH.idx]
  if (step?.done) {
    const body = document.getElementById('cp-body')
    if (body) body.innerHTML = step.done
    const icon = document.getElementById('cp-icon')
    if (icon) icon.textContent = '✅'
  }
  document.getElementById('coachpop')?.classList.remove('awaiting')
  const next = document.getElementById('cp-next')
  next?.classList.remove('await')
  next?.classList.add('lit')
  positionCoachPop() // the body swap changes its height — re-fit to the header
}
function coachFinish(): void {
  if (!COACH.active && !document.getElementById('coachpop')) return
  COACH.active = false
  COACH.await = null
  if (V) { V.paused = false; V.coachCue = null }
  coachSpotlight(null)
  document.getElementById('coachscrim')?.classList.remove('show')
  document.querySelector('.wrap')?.classList.remove('frozen')
  unlockAllSections()
  document.getElementById('coachpop')?.classList.remove('show')
}
/** Hard teardown when leaving combat — remove the body-level scrim/popover + any stray markers. */
function coachTeardown(): void {
  COACH.active = false
  COACH.await = null
  document.getElementById('coachscrim')?.remove()
  document.getElementById('coachpop')?.remove()
  document.getElementById('briefing')?.remove()
  document.getElementById('burstlayer')?.remove()
  document.getElementById('ptint')?.remove()
  document.querySelectorAll('.coach-spot').forEach((e) => e.classList.remove('coach-spot'))
  document.querySelectorAll('.coach-arrow, .trickchev').forEach((e) => e.remove())
}
