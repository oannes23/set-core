/* ui/app — a functional, playable UI over the engine. Renders the board/HUD, turns clicks into
   `completeSet` actions, runs the frame loop via `tick`, and interprets CombatEvents into feedback.
   Intentionally a clean rebuild (not pixel-parity with the prototype). Layout (UX.md §4b MODERATE):
   three horizontal bands + side rails — the FOE BAND top (identity·vitals·telegraph·round·threats),
   the battlefield center (log rail · THE BOARD · command rail), the PLAYER BAND bottom (HP/buffs +
   the tri-counter). Plays the ROUNDS v3 game (CRAWL §5.6): matches accumulate by verb, the round
   bar drains to the rollover exchange (a choreographed diegetic beat — never a modal), the Tactics
   wheel queues next round's stance. The exchange plays on a real duel axis: swing bottom→top,
   counter top→bottom. */

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
import { assembleFoe, pickWeightedFoe, computeXP } from '../engine/foe'
import { colsForN, COMBAT_GEN, playerCritChance, type Deps, type CombatAction } from '../engine/combat'
import { createRun, runReduce, type RunState } from '../engine/run'
import { createDelve, nextEncounter, fleeReroll, dreadBand, RUN_BAG_CAP, type DelveState, type EncounterTier } from '../engine/delve'
import { rollRoomLoot, rollMarqueeGear } from '../engine/loot'
import { gearStatBonus, gearRiders, gearProcs, gearMods, rollGear } from '../engine/gear'
import { EQUIP_SLOTS, type EquipSlot, type Rarity, type Affix, type AffixComponent, type GearInstance } from '../engine/items'
import { GEAR, gearBase, fitsSlot } from '../data/gear'
import { CONSUMABLES } from '../engine/consumables'
import { loadBank, bankGold, bankTithe, saveBank, addManyToStorage, addToStorage, removeFromStorage, storageFull, storageCount } from './bank'
import type { CombatState, FoeRuntime, StatBlock } from '../engine/state'
import { CHARGE_CAP, MANA_CAP, START_GRACE_MS, ROUND_MS, WOUND_WARD_COST, WOUND_CAP_PER_EXCHANGE, woundQuantum, dreadLevel, DREAD_ONSET, DREAD_MAX, PRIMED_WINDOW_MS } from '../engine/state'
import type { CombatEvent } from '../engine/events'
import { bumpTurn, pick, strikeWord, healWord, drainWord, magicLead, tierOf, joinClauses, voiceOf, ABILITY_FLAVOR } from './flavor'
import { type SavedChar, type StatAlloc, loadRoster, upsertChar, deleteChar, makeChar, freshId, CONSUMABLE_SLOTS, effectiveStats, xpForLevel, pendingLevels, applyLevelUp, LEVEL_CAP, activeSlotsAt, passiveSlotsAt, activeUnlockLevel } from './save'
import { isDev, toggleDev, onDevChange, displayName } from './dev'

const GEN: GenConfig = COMBAT_GEN
/** one shared reduced-motion query — card feel (tilt/flights/staggers) falls back to fades */
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)')
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
  holdHud: boolean // rollover choreography: HP/exchange/round HUD holds its pre-exchange read until the deal beat
  preview: number[] | null // board slots currently ringed by an ability hover
  selected: number[]
  raf: number
  lastT: number
  boardSig: string
  refs: Record<string, HTMLElement>
  /** running combat tallies for the end-of-combat contribution chart (UI-only, replay-safe) */
  stats: { dealt: number; taken: number; blocked: number; healed: number; sets: number; traps: number; xp: number }
  /** slot → who pulled it (consumed when the slot's new card renders — the tug-attribution tint) */
  morphSrc: Map<number, 'churn' | 'drift' | 'trap' | 'trick'>
  /** the always-on dev balance instruments (TRAPS §5.5 targets etc.) — display-only, replay-safe */
  dev: { reshapeYou: number; reshapeFoe: number; matches: number; springs: number; k1: number; wards: number; churns: number }
}
let V: View | null = null

export function mountApp(root: HTMLElement): void {
  initTooltips()
  ROOT = root
  mountDevToggle()
  document.body.classList.toggle('dev', isDev())
  onDevChange((on) => {
    document.body.classList.toggle('dev', on)
    // Static scenes re-mount so their dev panels / names re-resolve; combat repaints live every frame
    // (its dev row is CSS-gated), so re-mounting it — which would reset the live fight — is skipped.
    if (!V && lastSceneMount) goScene(lastSceneMount)
  })
  goScene(characterSelectScene)
}

/** The always-present, subtle dev-mode switch (a tiny corner chip on <body>, survives scene swaps). */
function mountDevToggle(): void {
  if (document.getElementById('devtoggle')) return
  const t = $(`<button id="devtoggle" data-tip-title="Dev mode" data-tip="Reveal system-descriptive names + balance instruments (combat row, town readout, loot-roll trace). Subtle on purpose.">dev</button>`)
  t.addEventListener('click', () => toggleDev())
  document.body.appendChild(t)
}

/** The level-appropriate stat anchor (CRAWL §3 parity line `10 + 2(L−1)`) — a dev balance reference. */
const parityFor = (level: number): number => 10 + 2 * (level - 1)
/** A town-side dev readout (system + balance numbers), styled like the combat dev row and CSS-gated
 *  to dev mode (`body.dev`). Pass already-formatted cells. */
function townDevPanel(cells: string[]): HTMLElement {
  return $(`<div class="devpanel"><span class="dvl">dev</span>${cells.map((c) => `<span>${c}</span>`).join('')}</div>`)
}

// ---- gear / equip screen (CRAWL §7 chunk ①) ----
const SLOT_ICON: Record<EquipSlot, string> = { weapon: '⚔', armor: '🛡', relic: '🔮', trinket1: '💍', trinket2: '💍' }
const SLOT_LABEL: Record<EquipSlot, string> = { weapon: 'Weapon', armor: 'Armor', relic: 'Relic', trinket1: 'Trinket', trinket2: 'Trinket' }
/** A compact affix label: the thematic name (or system name in dev) + its magnitude (stat / rider). */
function affixShort(a: Affix): string {
  let amt = ''
  for (const c of a.components) {
    if (c.c === 'stat') { amt = ` +${c.amount}`; break }
    if (c.c === 'rider') { amt = ` +${c.riders.atkDamagePerCard ?? c.riders.blockPerDefendCard ?? c.riders.manaPerMatch ?? 0}`; break }
    if (c.c === 'mod') {
      amt = c.mod === 'critMult' ? ` +${c.amount.toFixed(2)}×` : c.mod === 'dodge' || c.mod === 'lifesteal' || c.mod === 'critChance' ? ` +${Math.round(c.amount * 100)}%` : ` +${c.amount}`
      break
    }
  }
  return `${displayName(a.label)}${amt}`
}
/** Equip a Storage gear instance into a slot: pull it from Storage, stash any displaced item back
 *  (Storage just freed a slot by removing the pick, so the swap always has room). Persists both stores. */
function equipFromStorage(c: SavedChar, slot: EquipSlot, uid: string): boolean {
  let bank = loadBank()
  const item = bank.storage.find((i) => i.uid === uid)
  if (!item || item.kind !== 'gear') return false
  bank = removeFromStorage(bank, uid)
  const displaced = c.equipped[slot]
  if (displaced) bank = addToStorage(bank, displaced).account // the old piece returns to the bag
  c.equipped[slot] = item as GearInstance
  saveBank(bank); upsertChar(c)
  return true
}
/** Unequip a slot back to Storage — blocked (kept equipped) if the bag is full (triage UI is later). */
function unequipToStorage(c: SavedChar, slot: EquipSlot): boolean {
  const g = c.equipped[slot]
  if (!g) return true
  let bank = loadBank()
  if (storageFull(bank)) return false
  bank = addToStorage(bank, g).account
  delete c.equipped[slot]
  saveBank(bank); upsertChar(c)
  return true
}
/** Dev test affordance: mint a slot-appropriate random gear into STORAGE (then equip via the picker —
 *  exercises the real drop→bank→equip flow). The source-themed loot roller proper is live in loot.ts. */
function grantTestGear(): boolean {
  const slot = EQUIP_SLOTS[Math.floor(systemRng() * EQUIP_SLOTS.length)]
  const bases = Object.values(GEAR).filter((b) => fitsSlot(b, slot))
  const base = bases[Math.floor(systemRng() * bases.length)] ?? Object.values(GEAR)[0]
  const rarities: Rarity[] = ['white', 'green', 'blue', 'purple', 'orange']
  const rarity = rarities[Math.floor(systemRng() * rarities.length)]
  const lootTier = 6 + Math.floor(systemRng() * 12) // a spread of loot-tiers for varied affix magnitudes
  const r = addToStorage(loadBank(), rollGear(base.id, rarity, lootTier, systemRng))
  if (r.ok) saveBank(r.account)
  return r.ok
}

/* ============================================================
   SCENE ROUTER — every scene transition goes through goScene(): unmount the previous scene
   (cancel its rAF, flush every scene-scoped timer, sweep body-level singletons), clear the
   root, then mount. THE CONTRACT: anything a scene appends to document.body (not root) must
   be in BODY_SINGLETONS, and any scene-scoped delay must use sceneTimeout — then no scene
   can paint, tick, or burst over the next one.
   ============================================================ */
let ROOT: HTMLElement | null = null
let lastSceneMount: ((root: HTMLElement) => void) | null = null // re-mount target on a dev-mode flip
// the briefing/coach/FX/vignette layers live on <body>; #tooltip is app-global (hidden, not swept)
const BODY_SINGLETONS = ['coachscrim', 'coachpop', 'briefing', 'burstlayer', 'bamlayer', 'ptint', 'levelup']
let sceneTimers: number[] = []
/** A setTimeout whose callback dies with the scene — use for ALL scene-scoped delays/FX. */
function sceneTimeout(fn: () => void, ms: number): number {
  const id = window.setTimeout(fn, ms)
  sceneTimers.push(id)
  return id
}
function goScene(mount: (root: HTMLElement) => void): void {
  if (!ROOT) return
  lastSceneMount = mount
  if (V) { cancelAnimationFrame(V.raf); V = null } // stop the combat loop before its DOM goes away
  for (const id of sceneTimers) clearTimeout(id)
  sceneTimers = []
  clearTimeout(tipTimer)
  hideTip()
  ;(document.getElementById('confirmmodal') as (HTMLElement & { _cancel?: () => void }) | null)?._cancel?.() // full cleanup (keydown listener)
  coachTeardown()
  for (const id of BODY_SINGLETONS) document.getElementById(id)?.remove()
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

/** The LIVE DELVE (null = a lone practice fight). Survives scene transitions room → fork → room:
 *  the encounter schema state (engine/delve) + the run's consumable SATCHEL (what you carried in,
 *  minus what you drank, plus what you looted — HP-only attrition's sibling) + the current tier. */
let DELVE: { d: DelveState; bag: string[]; tier: EncounterTier; gold: number; gearFound: GearInstance[]; gearPity: number } | null = null

function characterSelectScene(root: HTMLElement): void {
  DELVE = null // any road back to town ends the run
  const wrap = $(`<div class="wrap"></div>`)
  wrap.appendChild($(`<h1>set.core</h1>`))
  wrap.appendChild($(`<div class="sub">town · choose your hero &nbsp;·&nbsp; <span class="vault" data-tip-title="The vault" data-tip="Your shared account gold — banked on any safe exit from a delve, dented by the death tithe. Spends at the shop (coming soon).">🪙 ${loadBank().gold} vault</span></div>`))
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
  let pickerSlot: EquipSlot | null = null // the equip slot whose Storage picker is open
  let gearNote = '' // a transient gear message (e.g. "Storage full"); cleared on the next action

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
    const lvlText = c.level >= LEVEL_CAP ? '★ MAX' : `Lv ${c.level}`
    host.appendChild($(`<div class="sheet-stat">❤ HP <b>${c.hp}/${c.maxHp}</b> · <b>${lvlText}</b></div>`))
    if (c.level < LEVEL_CAP) {
      const need = xpForLevel(c.level)
      host.appendChild($(`<div class="sheet-xp"><span class="sx-lab">XP</span><span class="sx-bar"><span style="width:${Math.min(100, (c.xp / need) * 100)}%"></span></span><span class="sx-num">${c.xp}/${need}</span></div>`))
    }
    const st = effectiveStats(c)
    host.appendChild($(`<div class="sheet-stat" data-tip-title="Stats — sets steer, stats carry" data-tip="Each card in a matched set fires its shape's stat: Attack swings with Power, Defend guards with Endurance, Move steps with Speed. The card's number is the action's QUALITY (① glancing ×0.7 · ② solid ×1.0 · ③ heavy ×1.4). Each level grants +6 to distribute (≤3 per stat); gear grows them further.">⚔ Power <b>${st.power}</b> · 🛡 Endurance <b>${st.endurance}</b> · 👟 Speed <b>${st.speed}</b></div>`))
    host.appendChild($(`<label style="margin-top:14px">Abilities</label>`))
    const ab = $(`<div class="sheet-abils"></div>`)
    const unlockedActives = activeSlotsAt(c.level) // §3 cadence: your kit grows with level
    cls.abilities.forEach((id, i) => {
      const a = ABILITIES[id]; if (!a) return
      const cost = a.cost.map((n, j) => (n > 0 ? `${MANA_ICON[j]}${n}` : '')).filter(Boolean).join(' ')
      const locked = i >= unlockedActives
      const tail = locked ? `<span class="abc lock">🔒 Lv ${activeUnlockLevel(i)}</span>` : `<span class="abc">${cost}</span>`
      ab.appendChild($(`<div class="sheet-abil${locked ? ' locked' : ''}" data-tip-title="${a.name}${cost ? ` · ${cost}` : ''}" data-tip="${locked ? `Unlocks at level ${activeUnlockLevel(i)} — your ability kit grows as you level. ` : ''}${a.desc}"><span class="abi">${a.icon}</span><span class="abn">${a.name}</span>${tail}</div>`))
    })
    host.appendChild(ab)
    host.appendChild($(`<label style="margin-top:14px">Passive</label>`))
    host.appendChild($(`<div class="sheet-stat">${cls.passives.map((p) => PASSIVES[p]?.name).filter(Boolean).join(' · ') || '—'}</div>`))
    host.appendChild($(`<label style="margin-top:14px">Gear</label>`))
    const gearGrid = $(`<div class="geargrid"></div>`)
    for (const slot of EQUIP_SLOTS) {
      const g = c.equipped[slot]
      const base = g ? gearBase(g.refId) : undefined
      const open = pickerSlot === slot
      const slotEl = $(`<div class="gearslot${g ? ' filled' : ''}${open ? ' open' : ''}"></div>`)
      if (g && base) {
        const affixTxt = g.affixes.length ? g.affixes.map(affixShort).join(' · ') : '—'
        slotEl.innerHTML = `<span class="gs-ic r-${g.rarity}">${base.icon}</span><div class="gs-meta"><div class="gs-n r-${g.rarity}">${base.name}</div><div class="gs-a">${affixTxt}</div></div><button class="gs-x" title="Unequip → Storage">✕</button>`
        slotEl.querySelector('.gs-x')!.addEventListener('click', (e) => {
          e.stopPropagation()
          gearNote = unequipToStorage(c, slot) ? '' : 'Storage full — free a slot first.'
          roster = loadRoster(); render()
        })
      } else {
        slotEl.innerHTML = `<span class="gs-ic empty">${SLOT_ICON[slot]}</span><div class="gs-meta"><div class="gs-n dim">${SLOT_LABEL[slot]}</div><div class="gs-a dim">${open ? 'choose from Storage…' : 'empty — click to equip'}</div></div>`
      }
      slotEl.addEventListener('click', () => { pickerSlot = open ? null : slot; gearNote = ''; render() })
      gearGrid.appendChild(slotEl)
    }
    host.appendChild(gearGrid)
    if (gearNote) host.appendChild($(`<div class="gearnote">${gearNote}</div>`))
    // the Storage picker for the open slot — compatible gear in the shared bag
    if (pickerSlot) {
      const bank = loadBank()
      const opts = bank.storage.filter((i): i is GearInstance => i.kind === 'gear' && !!gearBase(i.refId) && fitsSlot(gearBase(i.refId)!, pickerSlot!))
      const pick = $(`<div class="gearpicker"></div>`)
      pick.appendChild($(`<div class="gp-hd">Equip ${SLOT_LABEL[pickerSlot]} <span class="gp-ct">· Storage ${storageCount(bank)}/${bank.storageCap}</span></div>`))
      if (!opts.length) pick.appendChild($(`<div class="gp-empty">No compatible gear in Storage — delve to find some.</div>`))
      for (const it of opts) {
        const b = gearBase(it.refId)!
        const aff = it.affixes.length ? it.affixes.map(affixShort).join(' · ') : '—'
        const row = $(`<div class="gp-row"><span class="gs-ic r-${it.rarity}">${b.icon}</span><div class="gs-meta"><div class="gs-n r-${it.rarity}">${b.name}</div><div class="gs-a">${aff}</div></div><button class="gp-eq">equip</button></div>`)
        row.querySelector('.gp-eq')!.addEventListener('click', () => { equipFromStorage(c, pickerSlot!, it.uid); pickerSlot = null; gearNote = ''; roster = loadRoster(); render() })
        pick.appendChild(row)
      }
      host.appendChild(pick)
    }
    if (isDev()) {
      const grant = $(`<button class="devgrant" data-tip="Mint a random gear instance into Storage — then equip it via a slot picker (exercises the real drop→bank→equip flow).">⚙ grant test gear → Storage</button>`)
      grant.addEventListener('click', () => { gearNote = grantTestGear() ? '' : 'Storage full.'; roster = loadRoster(); render() })
      host.appendChild(grant)
    }
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
    const gb = gearStatBonus(c.equipped)
    const rd = gearRiders(c.equipped)
    host.appendChild(townDevPanel([
      `combat P/E/S ${st.power + gb.power}/${st.endurance + gb.endurance}/${st.speed + gb.speed}`,
      `gear +P/E/S ${gb.power}/${gb.endurance}/${gb.speed}`,
      `riders atk+${rd.atkDamagePerCard}/blk+${rd.blockPerDefendCard}/mana+${rd.manaPerMatch}`,
      `parity(L${c.level}) ${parityFor(c.level)}`,
      `xp ${c.xp}/${c.level >= LEVEL_CAP ? '★' : xpForLevel(c.level)}`,
      `vault ${loadBank().gold}g`,
    ]))
    const actions = $(`<div class="sheet-actions"></div>`)
    const ready = pendingLevels(c)
    if (ready > 0) {
      const lvlBtn = $<HTMLButtonElement>(`<button class="cta bob" style="flex:1">⬆ Level Up${ready > 1 ? ` ×${ready}` : ''}</button>`)
      lvlBtn.addEventListener('click', () => openLevelUp(c, (up) => { selectedCharId = up.id; roster = loadRoster(); render() }))
      actions.appendChild(lvlBtn)
    }
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
      const lvl = c.level >= LEVEL_CAP ? '★' : `Lv ${c.level}`
      const up = pendingLevels(c) > 0 ? ' <span class="rdyup">⬆</span>' : ''
      const card = $(`<div class="charcard${!creating && c.id === selectedCharId ? ' sel' : ''}" data-id="${c.id}"><span class="ci">${cls.icon}</span><div class="cmeta"><div class="cn">${c.name}${up}</div><div class="cc">${cls.name} · ${lvl} · ${c.hp}/${c.maxHp} HP</div></div></div>`)
      card.addEventListener('click', () => { creating = false; selectedCharId = c.id; pickerSlot = null; gearNote = ''; render() })
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

  fSel.addEventListener('change', () => { foeVal = fSel.value })
  fillFoes(); renderSummary(); renderLoadout()

  // FOOTER: back to the roster · DELVE (the real run — boss dungeons only) · a lone practice fight
  const back = $<HTMLButtonElement>(`<button class="cta ghost">◀ Back</button>`)
  back.addEventListener('click', () => goScene(characterSelectScene))
  footer.appendChild(back)
  const delve = $<HTMLButtonElement>(`<button class="cta bob"${char.hp <= 0 ? ' disabled' : ''} data-tip-title="Delve" data-tip="Enter the dungeon proper: rooms roll from the encounter table — elites recur, the boss waits somewhere in the deep. Between rooms you choose: press on or carry your spoils home. Your HP carries room to room.">🕯 Delve</button>`)
  delve.addEventListener('click', () => { if (char.hp > 0) beginDelve(char, dungeonId) })
  footer.appendChild(delve)
  const enter = $<HTMLButtonElement>(`<button class="cta"${char.hp <= 0 ? ' disabled' : ''}>⚔ Single fight</button>`)
  enter.addEventListener('click', () => { if (char.hp > 0) goScene((r) => begin(r, char, dungeonId, foeVal)) })
  footer.appendChild(enter)
  if (char.hp <= 0) footer.appendChild($(`<span class="sub" style="align-self:center;text-transform:none;letter-spacing:0">0 HP — Rest first (◀ Back).</span>`))
  const syncFooter = (): void => { delve.style.display = GAMEDATA.dungeons[dungeonId].boss ? '' : 'none' } // no boss → nothing to delve toward (tutorial/training)
  dSel.addEventListener('change', () => { dungeonId = dSel.value; fillFoes(); renderSummary(); syncFooter() })
  syncFooter()
}

/** Loadout summary for the class blurb: tagline + ability names + passive name. */
function classBlurbHTML(id: string): string {
  const c = classById(id)
  const abil = c.abilities.map((a) => ABILITIES[a]?.name).filter(Boolean).join(' · ')
  const pas = c.passives.map((p) => PASSIVES[p]?.name).filter(Boolean).join(' · ')
  return `${c.icon} <b>${c.name}</b> — ${c.blurb}<br><b>Abilities:</b> ${abil} &nbsp; <b>Passive:</b> ${pas}`
}

/* ---- LEVEL-UP: allocate +3/+2/+1 across P/E/S (CRAWL §3). Opens from the sheet; loops over every
   pending level. XP is already banked; this just spends it into stats. Deferrable (close = allocate
   later) since pending levels persist. ---- */
const LU_STATS: { key: keyof StatAlloc; icon: string; name: string }[] = [
  { key: 'power', icon: '⚔', name: 'Power' },
  { key: 'endurance', icon: '🛡', name: 'Endurance' },
  { key: 'speed', icon: '👟', name: 'Speed' },
]
const LU_POINTS = 6 // points to distribute per level (CRAWL §3, revised 2026-06-14)
const LU_MAX_PER = 3 // ≤3 to any one stat → 3/3/0 · 2/2/2 · 3/2/1 (was a rigid 3/2/1 permutation)

function openLevelUp(c: SavedChar, onComplete: (c: SavedChar) => void): void {
  document.getElementById('levelup')?.remove()
  const base = effectiveStats(c)
  const alloc: StatAlloc = { power: 0, endurance: 0, speed: 0 }
  const spent = (): number => alloc.power + alloc.endurance + alloc.speed
  const overlay = $(`<div id="levelup"><div class="lucard">
    <div class="lu-hd">⬆ Level Up — <b>Lv ${c.level} → ${c.level + 1}</b></div>
    <div class="lu-sub">Distribute <b>+6</b> across your stats — up to <b>+3</b> each. <b id="lu-left"></b></div>
    <div class="lu-rows"></div>
    <div class="lu-btns"><button class="confbtn" id="lu-later">Later</button><button class="confbtn primary" id="lu-go" disabled>Confirm</button></div>
  </div></div>`) as HTMLElement & { _cancel?: () => void }
  document.body.appendChild(overlay)
  const rowsEl = overlay.querySelector('.lu-rows') as HTMLElement
  const leftEl = overlay.querySelector('#lu-left') as HTMLElement
  const goBtn = overlay.querySelector('#lu-go') as HTMLButtonElement
  const cleanup = (): void => { overlay.remove(); document.removeEventListener('keydown', onKey) }
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { cleanup() } }
  overlay._cancel = cleanup

  const bump = (key: keyof StatAlloc, d: number): void => {
    const next = alloc[key] + d
    if (next < 0 || next > LU_MAX_PER || (d > 0 && spent() >= LU_POINTS)) return
    alloc[key] = next
    paint()
  }
  function paint(): void {
    const left = LU_POINTS - spent()
    leftEl.textContent = `${left} left`
    rowsEl.innerHTML = ''
    for (const s of LU_STATS) {
      const b = alloc[s.key]
      const row = $(`<div class="lu-row${b ? ' picked' : ''}">
        <span class="lu-ic">${s.icon}</span><span class="lu-nm">${s.name}</span>
        <span class="lu-val">${base[s.key]}${b ? ` <span class="lu-plus">+${b}</span> → <b>${base[s.key] + b}</b>` : ''}</span>
        <span class="lu-step"><button class="lu-stepb" data-k="${s.key}" data-d="-1"${b <= 0 ? ' disabled' : ''}>−</button><button class="lu-stepb" data-k="${s.key}" data-d="1"${b >= LU_MAX_PER || left <= 0 ? ' disabled' : ''}>+</button></span>
      </div>`)
      rowsEl.appendChild(row)
    }
    rowsEl.querySelectorAll<HTMLButtonElement>('.lu-stepb').forEach((btn) =>
      btn.addEventListener('click', () => bump(btn.dataset.k as keyof StatAlloc, Number(btn.dataset.d))),
    )
    goBtn.disabled = spent() !== LU_POINTS
  }
  goBtn.addEventListener('click', () => {
    if (spent() !== LU_POINTS) return
    const up = applyLevelUp(c, alloc) // alloc is the level's delta (sum 6, ≤3 each — enforced here)
    upsertChar(up) // persist each level as it's taken
    cleanup()
    if (pendingLevels(up) > 0) openLevelUp(up, onComplete) // chain the next pending level
    else onComplete(up)
  })
  overlay.querySelector('#lu-later')!.addEventListener('click', cleanup)
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup() }) // scrim = defer
  document.addEventListener('keydown', onKey)
  paint()
}

// ---- begin combat ----
/** The practice path: one chosen fight (or the authored gauntlet), no room chain. */
function begin(root: HTMLElement, char: SavedChar, dungeonId: string, foeVal: string): void {
  DELVE = null
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
  startCombat(root, char, dungeonId, foe, sequence, char.consumables)
}

/** The DELVE path (TODO §B2 first cut): start a run — the encounter schema rolls every room. */
function beginDelve(char: SavedChar, dungeonId: string): void {
  DELVE = {
    d: createDelve(dungeonId, systemRng),
    bag: char.consumables.filter((id) => !!id && !!CONSUMABLES[id]), // the loadout becomes the run satchel
    tier: 'minion',
    gold: 0, // run-gold: carried, banks on any safe exit, lost on death (a weightless counter, not a slot)
    gearFound: [], // gear drops accrue here; banked to Storage on a SAFE exit, lost on death (like the satchel)
    gearPity: 0, // the gear-drop sawtooth, carried across rooms
  }
  goScene((r) => delveRoom(r, char))
}

/** Enter the next room of the live delve: roll the encounter (boss law → elite sawtooth → table),
 *  then fight it carrying the run's HP + satchel. */
function delveRoom(root: HTMLElement, char: SavedChar): void {
  if (!DELVE) return
  const rng: Rng = systemRng
  const dg = GAMEDATA.dungeons[DELVE.d.dungeonId]
  const enc = nextEncounter(DELVE.d, dg, rng)
  DELVE.d = enc.delve
  DELVE.tier = enc.tier
  const foe = assembleFoe(enc.foeId, dg, GAMEDATA, rng)
  if (!foe) return
  startCombat(root, char, DELVE.d.dungeonId, foe, null, DELVE.bag)
}

/** Mount the combat scene for one assembled foe (shared by the practice path and the delve). */
function startCombat(root: HTMLElement, char: SavedChar, dungeonId: string, foe: FoeRuntime, sequence: string[] | null, consumables: string[]): void {
  const rng: Rng = systemRng
  const dg: Dungeon = GAMEDATA.dungeons[dungeonId]
  const cls = classById(char.classId)
  // §3 loadout cadence: your kit GROWS with level — equip the first N class abilities/passives by level.
  const acts = cls.abilities.slice(0, activeSlotsAt(char.level))
  const pass = cls.passives.slice(0, passiveSlotsAt(char.level))
  // §5.8 dread: depth floor from the delve's dread band (1 if a lone fight); OFF for coach/teaching fights
  const dreadFloor = DELVE ? [1, 2.5, 4, 5, 5][dreadBand(DELVE.d).step] : 1
  // §7 gear: native stats + StatMod affixes fold into the statline; base riders thread to resolveSet.
  // (Affix TRIGGERS/abilities aggregate in gear.ts but their bus wiring + content ride chunk ②.)
  const base = effectiveStats(char)
  const gb = gearStatBonus(char.equipped)
  const stats: StatBlock = { power: base.power + gb.power, endurance: base.endurance + gb.endurance, speed: base.speed + gb.speed }
  const run = createRun({ foe, gen: GEN, playerMax: char.maxHp, stats, riders: gearRiders(char.equipped), mods: gearMods(char.equipped), procs: gearProcs(char.equipped), passives: pass, consumables, sequence, dungeonId, dreadFloor, coach: !!dg.coach }, rng)
  run.combat.playerHP = Math.max(0, Math.min(char.maxHp, char.hp)) // the hero enters at their persisted HP, not full
  V = { root, deps: { data: GAMEDATA, rng }, run, state: run.combat, char, actions: [], classId: cls.id, loadout: acts, coach: !!dg.coach, coachCue: null, manaColor: dominantManaColor(acts), paused: true, hitstopUntil: 0, holdHud: false, preview: null, selected: [], raf: 0, lastT: 0, boardSig: '', refs: {}, stats: { dealt: 0, taken: 0, blocked: 0, healed: 0, sets: 0, traps: 0, xp: 0 }, morphSrc: new Map(), dev: { reshapeYou: 0, reshapeFoe: 0, matches: 0, springs: 0, k1: 0, wards: 0, churns: 0 } }
  buildPlay()
  renderBoard()
  updateBar()
  // brief the foe first; Engage starts the clock (and the guided intro, in the Tutorial)
  showBriefing(() => {
    if (!V) return
    V.paused = false
    V.lastT = 0
    hitstop(graceMs()) // freeze the clock for a beat after Engage — read the fresh board (Speed-stretched, §5.7)
    loop(performance.now())
    // let the player SEE the board for a beat before the guided intro freezes it ("read the board").
    // capture V so a pending timer from a prior combat can't fire into a different one.
    if (dg.guided) sceneTimeout(() => coachStartGuided(), 650)
  })
}

// ---- play screen skeleton ----
// THE MODERATE RE-ZONE (UX.md §4b): three horizontal bands + side rails. Top: the FOE BAND —
// identity, vitals, telegraph, round clock, and the threat strip fused into one opposing read
// (the Gestalt proximity break repaired in one stroke; keeps .headpanel — the coach layer's
// anchor class). Center: the archive rail (log + dev row) · THE BOARD (finally big) · the
// command rail (wheel/abilities/consumables). Bottom: the PLAYER BAND — you, HP/buffs, and
// the tri-counter (the one ledger). Every element id survives the move — only zoning changed.
// The tug bar retires into a hidden dock (the sprites walk the same number; tooltip carries it).
function buildPlay(): void {
  if (!V) return
  V.root.innerHTML = ''
  prevSel = []
  const wrap = $(`<div class="wrap combat"></div>`)

  // ═ FOE BAND ═ — everything "theirs" in one fixation group, the trap strip beneath
  const head = $(`<div class="panel headpanel foepanel"></div>`)
  head.appendChild($(`
    <div class="foerow">
      <span class="spritebox" data-tip-title="The tug" data-tip="The duelists pace with the board's lean — the foe advances as the dungeon's theme floods the cards; you advance as your Maneuver bias takes hold."><span class="sprite foe" id="spfoe">👹</span></span>
      <div class="foeid"><div class="foename" id="foename"></div><div class="foedesc" id="foedesc"></div></div>
      <div class="gauge foegauge"><div class="lab"><span id="enemylab">Enemy</span><span id="ehpv"></span></div><div class="track"><span class="fill ehp" id="ehp"></span></div></div>
      <div class="exchange foeread" id="exfoe" data-tip-title="Their strike" data-tip="The foe's telegraphed exchange total, revealed at the deal — this is exactly what lands when the round bar empties. Raise your guard 🛡 against it; once the guard meets the telegraph (✓), further Defend is wasted.">
        <span class="ex-lab">their strike</span><span class="ex-val" id="exinc">—</span>
      </div>
      <div class="timerbar roundbar">
        <div class="lab"><span id="roundlab">Round 1</span><span id="clock">—</span></div>
        <div class="track"><span class="fill rnd" id="roundfill"></span></div>
      </div>
      <button class="fleebtn" id="fleebtn" data-tip-title="Flee" data-tip="Forfeit this encounter and retreat to town. Available any time.">🏃 Flee</button>
    </div>`))
  head.appendChild($(`<div class="strip" id="strip"></div>`))
  // §5.8 the DREAD METER — two motions: the depth-floor base + the within-fight rise; a ⚔ tick marks
  // where it turns lethal (the damage onset). Hidden in coach fights (dread off).
  head.appendChild($(`<div class="dreadbar" id="dreadbar" style="display:none" data-tip-title="Dread" data-tip="The dungeon's dread rises each round — and starts higher the closer you are to the throne. Past the ⚔ marker it turns LETHAL: both sides hit harder and an unguardable bleed sets in. It only bites if a fight drags; close it before then.">
    <div class="dlab">dread <b id="dreadlab">—</b></div>
    <div class="dtrack"><span class="dfloor" id="dreadfloor"></span><span class="dfill" id="dreadfill"></span><span class="donset" style="left:${(DREAD_ONSET / DREAD_MAX) * 100}%">⚔</span></div>
  </div>`))
  wrap.appendChild(head)

  // ═ BATTLEFIELD ═ — log rail (the archive earns its own rail) · board · command rail
  const play = $(`<div class="play3"></div>`)
  const lrail = $(`<div class="rail leftrail"></div>`)
  const logP = $(`<div class="panel"></div>`)
  logP.appendChild($(`<label>Combat log</label>`))
  logP.appendChild($(`<div class="log" id="log"></div>`))
  lrail.appendChild(logP)
  // the DEV instruments — revealed by the dev-mode toggle (body.dev); a dim side-stat, not a feature
  lrail.appendChild($(`<div class="devstats" id="devstats"></div>`))
  play.appendChild(lrail)
  const center = $(`<div class="panel centercol"></div>`)
  const boardWrap = $(`<div class="boardwrap" id="boardwrap"></div>`)
  const board = $(`<div class="board" id="board"></div>`)
  board.style.gridTemplateColumns = `repeat(${V.state.cols}, 1fr)`
  boardWrap.appendChild($(`<div id="comboglow"></div>`)) // §13 ambient combo-glow (behind the board, pointer-events:none)
  boardWrap.appendChild(board)
  boardWrap.appendChild($(`<div id="floatlayer"></div>`))
  center.appendChild(boardWrap)
  play.appendChild(center)
  const rail = $(`<div class="rail rightrail"></div>`)
  rail.appendChild(buildCastPanel())
  play.appendChild(rail)
  wrap.appendChild(play)

  // ═ PLAYER BAND ═ — you + the TRI-COUNTER: the round's three verb accumulators, THE primary
  // HUD (everything else is meta guiding it). Each cell rings as its value lands; the exchange
  // choreography drains these same numbers — now on a real duel axis against the foe band above.
  wrap.appendChild($(`
    <div class="panel playerband">
      <span class="spritebox" data-tip-title="You" data-tip="The badge on your shoulder is the locked stance (Maneuver shows its bias). You pace with the board's lean — you advance as your bias takes hold, give ground as the dungeon's theme floods it."><span class="sprite you" id="spyou">🧙<span class="stb" id="stancebadge">🛡</span></span></span>
      <div class="gauge you"><div class="lab"><span class="youname">You <span class="buffbadge" id="buffind"></span></span><span id="phpv"></span></div><div class="track"><span class="fill php" id="php"></span></div></div>
      <div class="critdisp" id="critdisp" data-tip-title="✦ Crit chance" data-tip="Your chance for the exchange swing to land a CRIT (×1.5+ damage). EARNED by combos this round — keep matching within 3s, especially the same colour or shape, to ramp it. Soft-capped, so it's a delight, never a reliable strategy."><span class="cd-val" id="critval">5</span><span class="cd-unit">%</span><span class="cd-lab">✦ crit</span></div>
      <div class="tricounter" id="tricounter">
        <div class="tc-cell atk" id="tcatk" data-tip-title="⚔ Banked Attack" data-tip="Attack matches BANK damage here all round and land as ONE swing at the exchange. Reach the foe's remaining HP and it reads LETHAL — a lethal swing lands first and cancels their strike entirely.">
          <span class="tc-lab">attack</span><span class="tc-ico">⚔</span><span class="tc-val" id="exatk">0</span><span class="tc-tag lethal" id="exlethal">LETHAL</span>
        </div>
        <div class="tc-cell grd" id="tcgrd" data-tip-title="🛡 Guard" data-tip="Defend matches raise your guard against the telegraphed strike — it absorbs that much at the exchange. Once the guard meets the telegraph (✓ sated) further Defend is pure waste: spend the round elsewhere.">
          <span class="tc-lab">guard</span><span class="tc-ico">🛡</span><span class="tc-val" id="exguard">0</span><span class="tc-tag ok">✓</span><span class="tc-tag bite" id="tcbite" data-tip-title="The bite" data-tip="What lands if the exchange came now: their telegraph minus your guard — and the wounds it would scar (one per tenth of your max HP)."></span>
          <span class="grdmeter"><span class="grdfill" id="exguardfill"></span></span>
        </div>
        <div class="tc-cell tac" id="tctac" data-tip-title="⚙ Tactics" data-tip="Move matches bank Tactics charges — a Speed contest, yours vs theirs. Your stance spends them: <b>Stand Ground</b> wards enemy meddling live (board verbs 1 · wounds ${WOUND_WARD_COST}); <b>Maneuver</b> burns the WHOLE bank at the rollover, redrawing the deadest cards toward your bias.">
          <span class="tc-lab">tactics</span><span class="tc-ico">⚙</span><span class="tc-val" id="tcch">0</span><span class="tc-cap">/${CHARGE_CAP}</span>
        </div>
      </div>
      <div class="tugdock">
        <div class="tugbar" id="tugbar" style="display:none">
          <span class="tug-end foe" id="tugfoe">🔥</span>
          <div class="tug-track"><span class="tug-center"></span><span class="tug-marker" id="tugmarker"></span></div>
          <span class="tug-end you" id="tugyou">—</span>
        </div>
      </div>
    </div>`))
  V.root.appendChild(wrap)
  if (!document.getElementById('ptint')) document.body.appendChild($(`<div id="ptint"></div>`)) // low-HP vignette (body-level)

  V.refs = {}
  for (const id of ['foename', 'foedesc', 'fleebtn', 'enemylab', 'phpv', 'ehpv', 'php', 'ehp', 'clock', 'roundlab', 'roundfill', 'exatk', 'exinc', 'exguard', 'exguardfill', 'critdisp', 'critval', 'exfoe', 'tricounter', 'tcatk', 'tcgrd', 'tctac', 'tcch', 'tcbite', 'tacpips', 'm0', 'm1', 'm2', 'mp0', 'mp1', 'mp2', 'buffind', 'strip', 'dreadbar', 'dreadfill', 'dreadfloor', 'dreadlab', 'boardwrap', 'board', 'tugbar', 'tugmarker', 'tugfoe', 'tugyou', 'devstats', 'spyou', 'spfoe', 'stancebadge', 'log', 'abilities', 'tactics', 'passives', 'consumables', 'floatlayer', 'comboglow']) {
    const el = wrap.querySelector('#' + id)
    if (el) V.refs[id] = el as HTMLElement
  }
  board.addEventListener('click', onBoardClick)
  board.addEventListener('mousemove', onBoardTilt) // pointer-following 3D tilt (card feel)
  board.addEventListener('mouseleave', clearTilt)
  V.refs.fleebtn?.addEventListener('click', onFlee)
  V.refs.abilities?.addEventListener('click', onAbilityClick)
  V.refs.abilities?.addEventListener('mouseover', onAbilityHover)
  V.refs.abilities?.addEventListener('mouseout', clearPreview)
  V.refs.tactics?.addEventListener('click', onWheelClick) // #tactics IS the wheel now (7 states, one tap)
  V.refs.consumables?.addEventListener('click', onConsumableClick)
  renderStrip()
  renderConsumables()
  updateCastables()
  V.refs.foename.textContent = V.state.foe.name + (V.run.sequence ? `  ·  ${V.run.seqIdx + 1}/${V.run.sequence.length}` : DELVE ? `  ·  room ${DELVE.d.room}` : '')
  V.refs.foedesc.innerHTML = V.state.foe.desc ?? ''
}

/** The live castable panel: the Tactics WHEEL (ROUNDS v3 — one control, seven states, one tap),
 *  the charge pips, the class loadout (mana-gated click-to-cast), and the always-on passive chips. */
const MANA_ICON = ['🔥', '🌿', '❄']
/** Friendly bias names by axis (logs + the stance badge). The mag axis stays for enemy/gear effects
 *  even though the wheel deliberately cut it (heavy boards = gear/Hone only — CRAWL §5.6). */
const BIAS_NAME: Record<string, string[]> = {
  color: ['🔥 Fire', '🌿 Nature', '❄ Frost'],
  shape: ['⚔ Attack', '🛡 Defend', '👟 Move'],
  mag: ['① light', '② middling', '③ heavy'],
}
/** The six Maneuver spokes: top arc = shape biases ("steer what you can DO", Defend top-middle),
 *  bottom arc = colour biases ("steer what you can CAST", Blue straight down). */
const WHEEL_SPOKES: { axis: 'color' | 'shape'; value: number; icon: string; pos: string; tip: string }[] = [
  { axis: 'shape', value: 0, icon: '⚔', pos: 'tl', tip: 'Steer what you can DO — the rollover tide redraws the deadest cards toward <b>Attacks</b>.' },
  { axis: 'shape', value: 1, icon: '🛡', pos: 'tm', tip: 'Steer what you can DO — the rollover tide redraws the deadest cards toward <b>Defends</b>.' },
  { axis: 'shape', value: 2, icon: '👟', pos: 'tr', tip: 'Steer what you can DO — the rollover tide redraws the deadest cards toward <b>Moves</b>.' },
  { axis: 'color', value: 0, icon: '🔥', pos: 'bl', tip: 'Steer what you can CAST — the rollover tide redraws the deadest cards toward <b>red (Fire)</b>.' },
  { axis: 'color', value: 2, icon: '❄️', pos: 'bm', tip: 'Steer what you can CAST — the rollover tide redraws the deadest cards toward <b>blue (Frost)</b>.' },
  { axis: 'color', value: 1, icon: '🌿', pos: 'br', tip: 'Steer what you can CAST — the rollover tide redraws the deadest cards toward <b>green (Nature)</b>.' },
]
// the hub's braced stick-figure (Stand Ground — planted wide, shield up), inline so it tints with state
const HUB_SVG = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="10.5" cy="4.6" r="2.2"/><path d="M10.5 7.2v6"/><path d="M10.5 13.2l-4 7"/><path d="M10.5 13.2l4.4 6.6"/><path d="M10.5 8.8l4.8 1.8"/><path d="M17.4 7.3a7 7 0 0 1 0 7.6"/></svg>`
function buildCastPanel(): HTMLElement {
  const cls = classById(V!.classId)
  const panel = $(`<div class="panel"></div>`)
  // TACTICS section (charge pips + the wheel) — coach-gateable as one region
  const tacSec = $(`<div class="coach-sec" data-sec="tactics"></div>`)
  tacSec.appendChild($(`<div class="panelhd"><label>Tactics</label></div>`)) // the charge COUNT lives in the tri-counter (one number, one place); the pips here are the gauge
  // the charge gauge: 15 thin pips, grouped in threes (one wound-ward each — CHARGE_CAP = 5 × 3)
  const pips = $(`<div class="tacpips" id="tacpips" data-tip-title="Tactics charges" data-tip="Banked by matching Move cards — each Move card's worth is a Speed contest (yours vs theirs). Your stance spends them: <b>Stand Ground</b> wards enemy meddling live (board verbs 1 · wounds ${WOUND_WARD_COST}) and carries the bank; <b>Maneuver</b> burns ALL charges at the rollover, redrawing the deadest cards toward your bias. Pips group in threes — one warded wound each."></div>`)
  for (let i = 0; i < CHARGE_CAP; i++) pips.appendChild($(`<span class="pip"></span>`))
  tacSec.appendChild(pips)
  // THE WHEEL — center: Stand Ground · top arc: shape biases · bottom arc: colour biases.
  // One tap queues next round's stance (it LOCKS at the deal — the commitment mechanic).
  const wheel = $(`<div class="wheel" id="tactics"></div>`)
  for (const sp of WHEEL_SPOKES) wheel.appendChild($(`<div class="spoke pos-${sp.pos}" data-axis="${sp.axis}" data-value="${sp.value}" data-tip-title="Maneuver · ${BIAS_NAME[sp.axis][sp.value]}" data-tip="${sp.tip} Locks at the next deal; the dump burns the whole bank.">${sp.icon}</div>`))
  wheel.appendChild($(`<div class="hub" data-tip-title="🛡 Stand Ground" data-tip="Hold the line — charges ward enemy meddling live (a warp or lock costs 1, a wound costs ${WOUND_WARD_COST}), and the bank carries across rounds. Locks at the next deal.">${HUB_SVG}</div>`))
  tacSec.appendChild(wheel)
  panel.appendChild(tacSec)
  // ABILITIES section — the mana BANK gets a real standing read (UX §4c#2: number + pip strip per
  // colour, the same pip grammar as the charge gauge, sitting directly above the costs it pays)
  const abSec = $(`<div class="coach-sec" data-sec="abilities" style="margin-top:14px"></div>`)
  abSec.appendChild($(`<div class="panelhd"><label>Abilities · ${cls.name}</label></div>`))
  const MANA_NAME = ['Fire', 'Nature', 'Frost']
  const MANA_TIP = [
    'Spent on Fire abilities. Bank it by matching red cards (all-red set → 3, one-of-each → 1).',
    'Spent on Nature abilities. Bank it by matching green cards.',
    'Spent on Frost abilities. Bank it by matching blue cards.',
  ]
  const mb = $(`<div class="manabar"></div>`)
  for (let c = 0; c < 3; c++) {
    const cell = $(`<span class="manacell" style="--mc:var(--c${c})" data-tip-title="${MANA_NAME[c]} mana" data-tip="${MANA_TIP[c]}"><span class="mhd">${MANA_ICON[c]}<b id="m${c}">0</b></span><span class="mpips" id="mp${c}"></span></span>`)
    const mp = cell.querySelector('.mpips')!
    for (let i = 0; i < MANA_CAP; i++) mp.appendChild($(`<span class="pip"></span>`))
    mb.appendChild(cell)
  }
  abSec.appendChild(mb)
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
// §7 Primed: a scatter of ✦ across a primed card (positions + staggered twinkle baked in)
const PRIMED_SPARKLES = ([[16, 20], [74, 14], [38, 52], [84, 66], [26, 80], [58, 38], [50, 8]] as const)
  .map(([x, y], k) => `<span class="prs" style="left:${x}%;top:${y}%;animation-delay:${(k * 0.19).toFixed(2)}s">✦</span>`).join('')
function renderBoard(verbs?: Map<number, CardVerb>): void {
  if (!V) return
  const s = V.state
  const board = V.refs.board
  clearTilt() // the hovered element is about to be replaced — drop the stale tilt ref
  // crossfade: snapshot current cards; ghost-out any whose content is about to change (verb picks the motion)
  const oldKeys: Record<number, string> = {}
  const oldWounds = new Set<number>() // slots that WERE wounds — their refill reads as the knit (healing)
  const oldRectByKey = new Map<string, DOMRect>() // FLIP: a surviving card that MOVES glides, never teleports
  const flights: { el: HTMLElement; rect: DOMRect; shape: number }[] = [] // resolved cards → the arc to their verb's cell
  const layer = V.refs.floatlayer
  const bw = V.refs.boardwrap?.getBoundingClientRect()
  board.querySelectorAll<HTMLElement>('.card').forEach((old) => {
    if (old.dataset.i == null) return
    const i = +old.dataset.i
    oldKeys[i] = old.dataset.key ?? ''
    if (old.classList.contains('wound')) oldWounds.add(i)
    const c = s.board[i]
    const newKey = c ? String(keyOf(c)) : ''
    if (old.dataset.key) oldRectByKey.set(old.dataset.key, old.getBoundingClientRect())
    if (layer && bw && old.dataset.key && old.dataset.key !== newKey) {
      const r = oldRectByKey.get(old.dataset.key)!
      if (verbs?.get(i) === 'resolve' && !REDUCED.matches) {
        // a CASHED set doesn't pop in place — it FLIES to its payoff cell (launched below, as a batch)
        flights.push({ el: old, rect: r, shape: +(old.dataset.shape ?? '0') })
        return
      }
      const ghost = old.cloneNode(true) as HTMLElement
      ghost.className = LEAVE_CLASS[verbs?.get(i) as CardVerb] ?? 'card leave'
      ghost.removeAttribute('data-i')
      ghost.style.cssText = `position:absolute;margin:0;left:${r.left - bw.left}px;top:${r.top - bw.top}px;width:${r.width}px;height:${r.height}px`
      ghost.addEventListener('animationend', () => ghost.remove()) // not a timer → it freezes with the pause
      layer.appendChild(ghost)
    }
  })
  // the RESOLVE FLIGHT (card feel #3): gather-lift toward the set's centroid, then a staggered
  // arc to each card's verb cell — Attack→⚔, Defend→🛡, Move→⚙ — landing with a squash + the punch
  if (flights.length) {
    const cx = flights.reduce((a, f) => a + f.rect.left + f.rect.width / 2, 0) / flights.length
    flights.forEach((f, k) => flyResolveCard(f.el, f.rect, f.shape, k, cx))
  }
  const firstRender = V.boardSig === '' // the opening board just appears; no fade-in to freeze mid-animation
  board.innerHTML = ''
  const sets = findSets(s.board)
  const mates = glowSet(s, V.selected, sets)
  // value heat: how many sets each card anchors right now (reads CARDS, not sets → keeps §2.5 intact)
  const setCount = new Array(s.board.length).fill(0)
  for (const t of sets) for (const j of t) setCount[j]++
  const maxCount = Math.max(1, ...setCount)
  const bait = driftColor(s) // the dungeon-drift colour: those cards shimmer temptingly (the lure to resist)
  const prevSelSet = new Set(prevSel) // select/deselect pops key off the selection DELTA, not the state
  let enterIdx = 0 // the deal sweeps left→right: entering cards stagger by board order (card feel #4)
  s.board.forEach((c, i) => {
    if (!c) {
      // WOUNDS (pending.wound) read as cracked scars — they never time-reform (one knits per deal,
      // heals repair), so NO countdown; an ordinary reforming hole is a neutral dashed gap.
      const p = s.pending.get(i)
      board.appendChild($(`<div class="card ${p?.wound ? 'wound' : p ? 'gap' : 'empty'}" data-i="${i}"></div>`))
      return
    }
    const locked = s.locked.has(i)
    const key = String(keyOf(c))
    const cls = ['card']
    let gimme = -1
    const wasSel = prevSelSet.has(i)
    if (V!.selected.includes(i)) {
      cls.push(mates.deadPair ? 'badpair' : 'sel') // dead pair → red picks, no other glow
      if (!wasSel) cls.push('picked') // a fresh pick: press-in → overshoot pop
    } else {
      if (wasSel) cls.push('unpicked') // deselect: a quick settle back down
      if (mates.complete === i) cls.push('complete')
      else if (mates.set.has(i)) { cls.push('mate'); gimme = mates.set.get(i)! } // flutter amplitude scales with this set's gimme value
    }
    if (locked) cls.push('locked')
    else if (bait != null && c[0] === bait && !V!.selected.includes(i) && mates.complete !== i && !mates.set.has(i)) cls.push('bait')
    if (s.primed[i] != null && s.now - s.primed[i] <= PRIMED_WINDOW_MS) cls.push('primed') // §7 churned-and-ready: a tier higher if matched in time
    let stagger = ''
    if (!firstRender && oldKeys[i] !== key) {
      cls.push('enter')
      if (verbs?.get(i) === 'reform') cls.push('reform')
      if (oldWounds.has(i)) cls.push('knit') // a wound closing reads as HEALING, not a mere refill
      const src = V!.morphSrc.get(i) // tug attribution: tint the arrival by who pulled it
      if (src) { cls.push(`src-${src}`); V!.morphSrc.delete(i) }
      const d = REDUCED.matches ? 0 : Math.min(enterIdx * 45, 400) // ≤400ms total — the sweep, not a wait
      enterIdx++
      if (d > 0) stagger = `;animation-delay:${d}ms`
    } // new/changed → slide-flip in (reform = materialize)
    const heat = (setCount[i] / maxCount).toFixed(2)
    const gimmeVar = gimme >= 0 ? `;--gimme:${(gimme / 2).toFixed(2)}` : ''
    // selected cards sit at a slight deterministic rotation (±1.5°) — the physical-pile feel
    const selRot = V!.selected.includes(i) ? `;--selrot:${((((i * 53) % 7) - 3) * 0.5).toFixed(1)}deg` : ''
    // §7 Primed: scatter a handful of twinkling ✦ across the card (the "churned & ready" tell)
    const sparkles = cls.includes('primed') ? PRIMED_SPARKLES : ''
    const el = $(`<div class="${cls.join(' ')}" data-i="${i}" data-key="${key}" data-shape="${c[1]}" style="--cc:var(--c${c[0]});--heat:${heat}${gimmeVar}${selRot}${stagger}">${cardSVG(c)}${sparkles}${locked ? '<span class="lock">🔒</span><span class="lockcd"></span>' : ''}</div>`)
    board.appendChild(el)
  })
  // FLIP pass (card feel #5): any surviving card whose key changed position glides from its old
  // rect — capture/invert/play. Slots are stable today, so this is usually a no-op; it guarantees
  // the no-teleport rule for the exchange's tide beat and any future churn that relocates cards.
  if (!firstRender && !REDUCED.matches) {
    board.querySelectorAll<HTMLElement>('.card').forEach((el) => {
      const k = el.dataset.key
      if (!k || el.classList.contains('enter')) return
      const prev = oldRectByKey.get(k)
      if (!prev) return
      const now = el.getBoundingClientRect()
      const fx = prev.left - now.left
      const fy = prev.top - now.top
      if (Math.abs(fx) < 3 && Math.abs(fy) < 3) return
      el.style.transition = 'none'
      el.style.transform = `translate(${fx}px,${fy}px)`
      requestAnimationFrame(() => { el.style.transition = ''; el.style.transform = '' })
    })
  }
  prevSel = V.selected.slice()
  V.boardSig = boardSignature(s)
  updateTrickLines() // coach-only: surface makeable trick lines (no-op outside coach dungeons)
  updateTrapArmed() // §2.5-safe: pulse a trap/trick chip when a line that springs it is on the board
}

/* ---- CARD FEEL (the Balatro/Hearthstone pass) — tilt, flights, landings. All transform/opacity. ---- */
/** pointer-following 3D tilt: ±6° around the cursor, reset with the card's own spring transition */
let tiltCard: HTMLElement | null = null
let prevSel: number[] = [] // last render's selection — drives the pick/unpick pops
function onBoardTilt(e: Event): void {
  if (REDUCED.matches) return
  const me = e as MouseEvent
  const el = (me.target as HTMLElement).closest?.('.card') as HTMLElement | null
  if (tiltCard && tiltCard !== el) clearTilt()
  if (!el || el.dataset.i == null) return
  if (el.classList.contains('empty') || el.classList.contains('gap') || el.classList.contains('wound') || el.classList.contains('locked')) return
  const r = el.getBoundingClientRect()
  if (!r.width || !r.height) return
  const px = (me.clientX - r.left) / r.width - 0.5
  const py = (me.clientY - r.top) / r.height - 0.5
  el.style.setProperty('--ry', `${(px * 12).toFixed(2)}deg`)
  el.style.setProperty('--rx', `${(-py * 12).toFixed(2)}deg`)
  tiltCard = el
}
function clearTilt(): void {
  if (!tiltCard) return
  tiltCard.style.removeProperty('--rx')
  tiltCard.style.removeProperty('--ry')
  tiltCard = null
}

/** Resolve flight: gather-lift (rise + tilt toward the set's centroid) → a two-stage arced
 *  transform to the verb's tri-counter cell (Attack→⚔ · Defend→🛡 · Move→⚙), staggered 70ms apart,
 *  shrinking as it goes. The body-level clone is pointer-events-none — input never blocks. WAAPI
 *  (transform/opacity only) so the curve needs no library. ~460ms + stagger ≈ 600ms total. */
const SHAPE_CELL = ['tcatk', 'tcgrd', 'tctac'] as const
const CELL_STAT: Record<string, string> = { tcatk: 'exatk', tcgrd: 'exguard', tctac: 'tcch' }
const RESOLVE_FLY_MS = 460
const RESOLVE_STAGGER_MS = 70
function flyResolveCard(old: HTMLElement, rect: DOMRect, shape: number, idx: number, centroidX: number): void {
  const cellRef = SHAPE_CELL[shape] ?? 'tcatk'
  const cell = V?.refs[cellRef]
  if (!cell) return
  const t = cell.getBoundingClientRect()
  const clone = old.cloneNode(true) as HTMLElement
  clone.className = 'card flycard'
  clone.removeAttribute('data-i')
  clone.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`
  document.body.appendChild(clone)
  const sx = rect.left + rect.width / 2
  const dx = t.left + t.width / 2 - sx
  const dy = t.top + t.height / 2 - (rect.top + rect.height / 2)
  const lean = centroidX > sx + 4 ? 6 : centroidX < sx - 4 ? -6 : 0 // tilt toward the set-mates
  const rot = dx > 1 ? 16 : dx < -1 ? -16 : 8
  const anim = clone.animate([
    { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1, easing: 'cubic-bezier(.2,.8,.4,1)' },
    { transform: `translate(${lean * 1.5}px,-14px) scale(1.07) rotate(${lean}deg)`, opacity: 1, offset: 0.22, easing: 'cubic-bezier(.5,0,.8,.5)' }, // the gather-lift crests…
    { transform: `translate(${dx * 0.5 + lean * 6}px,${dy * 0.5 - 70}px) scale(.62) rotate(${rot * 0.5}deg)`, opacity: 0.95, offset: 0.62, easing: 'cubic-bezier(.3,.6,.6,1)' }, // …the arc's apex…
    { transform: `translate(${dx}px,${dy}px) scale(.28) rotate(${rot}deg)`, opacity: 0.5 }, // …into the cell
  ], { duration: RESOLVE_FLY_MS, delay: idx * RESOLVE_STAGGER_MS, fill: 'both' })
  anim.onfinish = () => { clone.remove(); landPunch(cellRef) }
  sceneTimeout(() => clone.remove(), RESOLVE_FLY_MS + idx * RESOLVE_STAGGER_MS + 400) // sweep insurance
}
/** The payoff fires ON the landing, never before: the cell squashes (x1.15/y0.85 → settle) and
 *  the verb ring + number punch play now. Over-sated guard keeps its no-reward-ring rule. */
function landPunch(cellRef: 'tcatk' | 'tcgrd' | 'tctac'): void {
  if (!V) return
  const cell = V.refs[cellRef]
  if (!cell) return
  cell.classList.remove('squash')
  void cell.offsetWidth
  cell.classList.add('squash')
  const over = cellRef === 'tcgrd' && V.state.incoming != null && V.state.block > V.state.incoming
  if (!over) { cellLand(cellRef); flashStat(CELL_STAT[cellRef]) }
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
  if (V.holdHud) return // …and LOCKED through the whole rollover choreography (selection cleared at entry)
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
      if (V && !V.holdHud) renderBoard() // a rollover that started mid-shake owns the next paint
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
    body: DELVE
      ? 'You forfeit this room’s spoils and fall back to the junction. The next chamber is rerolled — press on or go home from there.'
      : 'You forfeit this encounter and retreat to town.',
    confirmLabel: '🏃 Flee', danger: true,
    onConfirm: () => { if (V) dispatch({ type: 'flee' }) },
    onCancel: () => { if (V) V.paused = false },
  })
}

/** The wheel: one tap QUEUES next round's stance (setTactic/setBias queue; the pick locks at the
 *  deal). A spoke = Maneuver with that bias (the v2 verb-then-parameter two-step, collapsed into
 *  one gesture); the hub = Stand Ground. Re-tapping the already-effective pick is a no-op. */
function onWheelClick(e: Event): void {
  if (!V || !V.state.running || V.paused) return // input frozen during a pause
  const s = V.state
  if ((e.target as HTMLElement).closest('.hub')) {
    if (s.tactic === 'stand') return // already holding the line (§5.7: stances are live — no queue)
    dispatch({ type: 'setTactic', tactic: 'stand' }) // INSTANT bail-out — keeps the bank, resumes warding
    return
  }
  const sp = (e.target as HTMLElement).closest('.spoke') as HTMLElement | null
  if (!sp?.dataset.axis) return
  const axis = sp.dataset.axis as 'color' | 'shape'
  const value = +sp.dataset.value!
  // §5.7: stances apply LIVE. Entering Maneuver starts the gather (engine); changing only the bias
  // mid-tide does not re-gather. No-op if this exact stance+bias is already active.
  const needTactic = s.tactic !== 'maneuver'
  const needBias = !(s.maneuverBias && s.maneuverBias.axis === axis && s.maneuverBias.value === value)
  if (needTactic) dispatch({ type: 'setTactic', tactic: 'maneuver' })
  if (needBias) dispatch({ type: 'setBias', bias: { axis, value } })
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
  updateWheel()
  if (V.coach) {
    // guided Tactics stage: beckon the wheel until a spoke is picked (coachNotify clears the await)
    setCoachArrow(V.refs.tactics, COACH.await === 'tactic')
    // staged tutorial cues — teach how to GET there, scoped to the current guided stage:
    const cue = V.coachCue
    // Tactics stage: STRONG glow on Move cards + LIGHT pulse on the gauge (until a charge banks).
    const moveGlow = cue === 'moves' && s.charges === 0
    updateMoveHints(moveGlow)
    document.querySelector('[data-sec="tactics"] .tacpips')?.classList.toggle('meterhint', moveGlow)
    // Abilities stage: while nothing's affordable, glow the colour the loadout needs most; once an
    // ability lights up, drop the card glow (its own ready-arrow takes over the focus).
    const anyAfford = V.loadout.some((id) => { const a = ABILITIES[id]; return !!a && canAfford(s, a.cost) })
    updateColorHints(cue === 'mana' && !anyAfford ? V.manaColor : null)
  }
}

/** Paint the wheel (§5.7 — stances are LIVE now, so no ghost/queue state): LIT = the active stance
 *  (hub gold = Stand Ground, spoke phosphor = Maneuver+bias). While Maneuver is still GATHERING
 *  (before the first burn) the lit spoke pulses `gathering`; once it's burning it reads steady.
 *  Runs per frame off updateCastables. */
function updateWheel(): void {
  if (!V) return
  const s = V.state
  const wheel = V.refs.tactics
  if (!wheel) return
  const gathering = s.tactic === 'maneuver' && s.now < s.maneuverGatherUntil
  wheel.querySelectorAll<HTMLElement>('.spoke, .hub').forEach((el) => {
    const isHub = el.classList.contains('hub')
    const lit = s.running && (isHub
      ? s.tactic === 'stand'
      : s.tactic === 'maneuver' && !!s.maneuverBias && el.dataset.axis === s.maneuverBias.axis && +el.dataset.value! === s.maneuverBias.value)
    el.classList.toggle('lit', lit)
    el.classList.toggle('queued', false) // retired with the round-lock
    el.classList.toggle('gathering', lit && !isHub && gathering)
  })
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
  V.state.selected = V.selected // hard rule #6: hand the live selection to the engine before it can transmute (tick/trap)
  const defeated = V.state.foe // captured BEFORE the reduce — the foe that may die this step (a swap loses it)
  const { run, events } = runReduce(V.run, action, V.deps)
  const state = run.combat
  V.run = run
  V.state = state
  V.actions.push(action) // record the session log (the seam): a server could replay these
  // XP banks the moment a foe falls — `won` (final/lone/delve-room) OR `foeChanged` (mid-gauntlet);
  // XP ALWAYS banks (even the run-ending death already credited its earlier kills). Persist now.
  if (events.some((e) => e.type === 'won' || e.type === 'foeChanged')) awardXP(defeated)
  // drop any selected slot a board verb just removed (transmute/shatter), so the glow can't dangle
  V.selected = V.selected.filter((i) => state.board[i] != null && !state.locked.has(i))
  const choreographed = interpret(events) // a rollover batch sequences its own beats + board render
  if (!choreographed && boardSignature(state) !== V.boardSig) renderBoard(verbsFromEvents(events))
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

/** Event → feedback. A batch containing a rollover is CHOREOGRAPHED (the ~6s diegetic exchange
 *  beat, CRAWL §5.6 — never a modal; timings in EXCHANGE_BEATS); everything else plays immediately.
 *  Returns true when the choreography owns the board render (dispatch must not double-render). */
function interpret(events: CombatEvent[]): boolean {
  if (!V) return false
  const cut = events.findIndex((e) => e.type === 'roundEnded')
  if (cut < 0) { interpretChunk(events); return false }
  interpretChunk(events.slice(0, cut)) // same-tick pre-rollover events (drift etc.) land normally
  choreographRollover(events.slice(cut))
  return true
}

/* THE ROLLOVER CHOREOGRAPHY — the engine resolves the exchange atomically; the UI plays it back as
   a ~6s cinematic beat (playtest 2026-06-11: "even a little slower and more telegraphed out" —
   each quantity must visibly TRANSFER, each landing stamped with a comic BAM/POW impact card):
   ① the field shifts mode (board dims under a vignette, the flag stamps big, the scoreboard
   lights) → ② YOUR SWING: the banked ⚔ counts down to 0 while the foe's HP drains with it
   ("BAM!"/"CRUNCH!"/"LETHAL!" over the foe) → ③ THEIR STRIKE: the telegraph ⚔ drains into your
   guard 🛡 ("CLANG!" when it holds outright); the bite past it drains your HP ("OOMF!"/"POW!",
   wound shatters popping with a "CRACK!") → ④ THE TIDE & THE DEAL: the board takes the stage
   (churn morphs first — "SWOOSH!" on a Maneuver dump — the wound-knit flare after) → ⑤ RELEASE:
   the field re-brightens, "Round N" stamps, the fresh telegraph reveals. CARD INPUT LOCKS for the
   whole beat (selection cleared at entry, board inert + dimmed until ⑤ — playtest 2026-06-11);
   abilities/consumables/flee stay live. Ticks freeze (the hitstop spans the WHOLE beat, so the new
   round still opens with a full clock). The HUD holds its pre-exchange read until ⑤ — every number
   lands on its beat, never all at once at dispatch. */
const EXCHANGE_BEATS = {
  swing: 1100, // ② your swing begins (the ① mode-shift owns 0–1100ms)
  swingDrain: 880, // …the banked-⚔ → foe-HP count-down tween
  counter: 2700, // ③ their strike begins
  guardDrain: 600, // …the telegraph → guard absorb tween
  hpDrain: 750, // …the remaining bite → your-HP tween (runs after the absorb)
  tide: 4300, // ④ the tide + the deal (the board's own unhurried window)
  tideDrain: 650, // …the Maneuver dump's ⚙ counter + pips burn down with the churn
  knitHold: 750, // …the wound-knit flare fires this long after the churn morphs start
  deal: 5600, // ⑤ release — the HUD snaps to the new round
  releasePad: 400, // hitstop runs to deal+pad (~6s): the freeze covers every beat with margin
}
/** prefers-reduced-motion: the old compact ~2.25s pacing; the numbers snap instead of tweening. */
const EXCHANGE_BEATS_REDUCED: typeof EXCHANGE_BEATS = { swing: 350, swingDrain: 0, counter: 900, guardDrain: 0, hpDrain: 0, tide: 1450, tideDrain: 0, knitHold: 0, deal: 2000, releasePad: 250 }
const exBeats = (): typeof EXCHANGE_BEATS => (matchMedia('(prefers-reduced-motion: reduce)').matches ? EXCHANGE_BEATS_REDUCED : EXCHANGE_BEATS)

function choreographRollover(events: CombatEvent[]): void {
  if (!V) return
  const B = exBeats()
  const seg: Record<'swing' | 'counter' | 'tide' | 'deal', CombatEvent[]> = { swing: [], counter: [], tide: [], deal: [] }
  const finale: CombatEvent[] = [] // won/lost — the end banner fires the instant an HP count crosses 0
  for (const e of events) {
    switch (e.type) {
      case 'roundEnded': break // the beat itself (the mode-shift below)
      case 'won': case 'lost': finale.push(e); break
      case 'enemyDamaged': seg.swing.push(e); break
      case 'playerDamaged': case 'playerBlocked': case 'cardsShattered': case 'warded': case 'strikeDodged': seg.counter.push(e); break
      case 'windup': case 'roundStarted': seg.deal.push(e); break
      default: seg.tide.push(e) // dump/deal/stance-lock + anything unforeseen rides the tide beat
    }
  }
  const won = finale.some((e) => e.type === 'won')
  const s = V.state // POST-exchange (the engine already resolved); the pre-reads are reconstructed below
  // ② the swing transfer: events carry the amount; the held HUD still shows the pre-exchange read
  const swingDmg = seg.swing.reduce((a, e) => a + (e.type === 'enemyDamaged' ? e.amount : 0), 0)
  const postFoeHP = s.enemyHP
  const preFoeHP = won ? domNum(V.refs.ehpv, swingDmg) : postFoeHP + swingDmg // on a kill the bank overkills — the held HUD has the true pre-read
  // ③ the strike transfer: telegraph → guard → your HP
  const pd = seg.counter.find((e): e is Extract<CombatEvent, { type: 'playerDamaged' }> => e.type === 'playerDamaged')
  const blockedAll = seg.counter.some((e) => e.type === 'playerBlocked')
  const raw = pd ? pd.amount + pd.absorbed : blockedAll ? domNum(V.refs.exinc, 0) : null // null = no strike this round
  const absorbed = pd ? pd.absorbed : raw ?? 0
  const bite = pd ? pd.amount : 0
  const preBlock = domNum(V.refs.exguard, absorbed) // the guard number the player watched all round
  const postYouHP = s.playerHP
  const shatters = seg.counter.flatMap((e) => (e.type === 'cardsShattered' ? e.slots : []))
  const knits = events.flatMap((e) => (e.type === 'cardsReformed' ? e.slots : [])) // at the rollover, reforms = the knit
  const verbs = verbsFromEvents(events) // booms (wounds) + morphs (tide) + reforms (knit/deal)
  const foeName = s.foe.name

  V.holdHud = true
  hitstop(B.deal + B.releasePad) // the freeze covers the WHOLE beat — the new round opens with a full clock
  // BOARD LOCKOUT — clear any half-made pick NOW (it can't survive the deal anyway) and strip its
  // glow from the still-dimming board; onBoardClick ignores the field until ⑤ (holdHud is the lock)
  V.selected = []
  V.refs.board?.querySelectorAll('.card.sel, .card.badpair, .card.bad').forEach((el) => el.classList.remove('sel', 'badpair', 'bad'))
  exchangeEnter() // ① the field shifts mode (+ .exlocked: the board reads out-of-reach)
  log(`<span style="opacity:.8">— the exchange —</span>`, 'you')

  // ② YOUR SWING — the banked ⚔ counts down to 0 as the foe's HP drains with it (one visible transfer)
  sceneTimeout(() => {
    if (!V || !V.holdHud) return
    if (swingDmg <= 0) { floatBoard('no swing banked', 'var(--ink-faint)', 'enemy'); return } // brief + grey
    drainCls(true, V.refs.exatk, V.refs.ehpv)
    sceneTimeout(() => { // the lunge/float/flash land mid-tween — the impact card stamps with them
      if (!V?.holdHud) return
      interpretChunk(seg.swing)
      bamWord(won ? 'LETHAL!' : tierOf(swingDmg, 12) === 'heavy' ? 'CRUNCH!' : 'BAM!', 'hit', V.refs.spfoe, won ? 1.3 : tierOf(swingDmg, 12) === 'heavy' ? 1.15 : 1)
    }, Math.round(B.swingDrain * 0.35))
    exTween(B.swingDrain, (k) => {
      if (!V) return
      V.refs.exatk.textContent = String(Math.round(swingDmg * (1 - k)))
      paintHP('e', Math.round(preFoeHP - (preFoeHP - postFoeHP) * k))
    }, () => {
      drainCls(false, V?.refs.exatk, V?.refs.ehpv)
      if (won) interpretChunk(finale) // the win banner fires the moment the count crosses 0 HP
    })
  }, B.swing)
  if (won) return // lethal cancels their strike — no counter/tide/deal beats on a kill

  // ③ THEIR STRIKE — the telegraph ⚔ drains into your guard 🛡; what bites past it drains your HP
  sceneTimeout(() => {
    if (!V || !V.holdHud) return
    if (raw == null) { // no HP/guard transfer this round
      if (seg.counter.some((e) => e.type === 'strikeDodged')) { // §5.7 the FULL WHIFF — the smash card
        spriteReact('you', 'splunge') // a quick sidestep
        bamWord('DODGED!', 'dodge', V.refs.spyou, 1.25)
        floatBoard('💨 dodged — free round', 'var(--phos)', 'you')
        interpretChunk(seg.counter) // narrates the dodge line
      } else if (seg.counter.length) interpretChunk(seg.counter) // stray wards etc. still narrate
      else { floatBoard('no strike', 'var(--ink-faint)', 'enemy'); log(`<span style="opacity:.7">The ${foeName} doesn't strike.</span>`, 'foe') }
      return
    }
    const land = (): void => { // the hit lands: flash/burst/log/sprites + wound shatters pop on their slots
      if (!V || !V.holdHud) return
      interpretChunk(seg.counter)
      for (const sl of shatters) boomSlot(sl, verbs)
      // the impact card: a held guard goes "CLANG!", a bite lands "OOMF!"/"POW!" (bigger when wounds
      // shatter, with a "CRACK!" stamped over the board as they pop)
      if (bite > 0) bamWord(tierOf(bite, V.state.foe.damage) === 'light' ? 'OOMF!' : 'POW!', 'pain', V.refs.spyou, shatters.length ? 1.3 : 1.05)
      else if (raw > 0) bamWord('CLANG!', 'guard', V.refs.tcgrd, 1)
      if (shatters.length) sceneTimeout(() => { if (V?.holdHud) bamWord('CRACK!', 'pain', V.refs.boardwrap, 1.1) }, 140)
      if (bite > 0) {
        drainCls(true, V.refs.phpv)
        const preYouHP = postYouHP + bite
        exTween(B.hpDrain, (k) => {
          if (!V) return
          V.refs.exinc.textContent = `⚔ ${Math.round(bite * (1 - k))}`
          paintHP('p', Math.round(preYouHP - bite * k))
        }, () => {
          drainCls(false, V?.refs.phpv, V?.refs.exinc)
          if (finale.length) interpretChunk(finale) // defeat fires the moment your count crosses 0
        })
      } else if (finale.length) interpretChunk(finale)
    }
    drainCls(true, V.refs.exinc, V.refs.exguard)
    if (absorbed > 0) {
      exTween(B.guardDrain, (k) => { // the guard ABSORBS: both numbers drain together
        if (!V) return
        V.refs.exinc.textContent = `⚔ ${Math.round(raw - absorbed * k)}`
        V.refs.exguard.textContent = String(Math.round(Math.max(0, preBlock - absorbed * k)))
      }, () => { drainCls(false, V?.refs.exguard); land() })
    } else land()
  }, B.counter)

  // ④ THE TIDE & THE DEAL — the board takes the stage: the dim half-lifts, churn morphs play,
  //    then the wound-knit flares on its own moment (never compressed into the same instant)
  sceneTimeout(() => {
    if (!V || !V.holdHud) return
    V.refs.boardwrap?.classList.add('extide') // the eye moves to the board
    interpretChunk(seg.tide)
    const changed = boardSignature(V.state) !== V.boardSig
    if (changed) renderBoard(verbs)
    // the tide's own impact card: the Maneuver dump goes "SWOOSH!"; a plain reshuffle gets a soft "SHFF"
    // §5.7: Maneuver burns LIVE during the round now (no rollover dump), so the tide beat just
    // settles whatever drift/knit landed — a soft cue when the board shifted.
    if (changed) bamWord('SHFF', 'soft', V.refs.boardwrap, 0.85)
    holdKnits(knits, B.knitHold)
  }, B.tide)

  // ⑤ RELEASE — the field re-brightens, the HUD snaps to the new round, "Round N" stamps, the telegraph reveals
  sceneTimeout(() => {
    if (!V || !V.holdHud) return
    V.holdHud = false // the HUD snaps to the new round: fresh bar, fresh accumulators…
    exchangeExit()
    interpretChunk(seg.deal)
    roundStamp(V.state.round)
    pulseTelegraph() // …and the new telegraph reveals with its flourish
  }, B.deal)
}

/** A scene-safe rAF tween for the exchange drains (eased 0→1). Dies silently if the combat view
 *  changes or the HUD hold releases early (flee/endScreen mid-beat). ms<=0 snaps (reduced motion). */
function exTween(ms: number, step: (k: number) => void, done?: () => void): void {
  const view = V
  if (!view) return
  if (ms <= 0) { step(1); done?.(); return }
  const t0 = performance.now()
  const frame = (t: number): void => {
    if (V !== view || !view.holdHud) return
    const raw = Math.min(1, (t - t0) / ms)
    step(1 - (1 - raw) ** 3) // ease-out: the number flies, then settles
    if (raw < 1) requestAnimationFrame(frame)
    else done?.()
  }
  requestAnimationFrame(frame)
}

/** Read the number the HELD HUD is showing (the pre-exchange paint) — e.g. "🛡 7 ✓" → 7. */
function domNum(el: HTMLElement | undefined, fallback: number): number {
  const m = el?.textContent?.match(/\d+/)
  return m ? +m[0] : fallback
}

/** Toggle the drain glow (scaled-up, glowing number) on the HUD values currently transferring. */
function drainCls(on: boolean, ...els: (HTMLElement | undefined)[]): void {
  for (const el of els) el?.classList.toggle('draining', on)
}

/** Paint one HP read (number + bar) mid-drain — the beat's own write past the held HUD. */
function paintHP(side: 'p' | 'e', hp: number): void {
  if (!V) return
  const s = V.state
  const max = side === 'p' ? s.playerMax : s.enemyMax
  const v = Math.max(0, Math.min(max, hp))
  V.refs[side === 'p' ? 'phpv' : 'ehpv'].textContent = `${v}/${max}`
  V.refs[side === 'p' ? 'php' : 'ehp'].style.width = `${max > 0 ? (v / max) * 100 : 0}%`
}

/** Pop a wound shatter on its slot the moment the strike lands (the tide render then deals the scar). */
function boomSlot(slot: number, verbs: Map<number, CardVerb>): void {
  const el = V?.refs.board.querySelector(`[data-i="${slot}"]`) as HTMLElement | null
  if (!el) return
  el.classList.add('boom') // the live card bursts NOW…
  el.dataset.key = '' // …so the tide render won't ghost it a second time
  verbs.delete(slot)
}

/** Stage the wound-knit: the slot holds as a dark gap while the churn morphs play, THEN flares closed. */
function holdKnits(slots: number[], holdMs: number): void {
  if (!V || !slots.length || holdMs <= 0) return
  const els = slots
    .map((i) => V!.refs.board.querySelector(`[data-i="${i}"]`) as HTMLElement | null)
    .filter((el): el is HTMLElement => !!el && el.classList.contains('knit'))
  if (!els.length) return
  for (const el of els) { el.classList.remove('enter', 'reform', 'knit'); el.classList.add('knitwait') } // synchronous: the flare never paints early
  sceneTimeout(() => {
    if (!V) return
    for (const el of els) { el.classList.remove('knitwait'); el.style.animationDelay = '0ms'; void el.offsetWidth; el.classList.add('enter', 'reform', 'knit') } // delay cleared: the knit flare is ON its beat, not the deal-sweep's stagger
  }, holdMs)
}

/** Beat ① — the whole field shifts mode: the board dims under a vignette with a low visual thunk,
 *  the "— the exchange —" flag stamps big and HOLDS, the scoreboard (the stage of ②/③) lights up. */
function exchangeEnter(): void {
  if (!V) return
  const bw = V.refs.boardwrap
  if (bw) { bw.classList.add('exmode', 'exlocked'); bw.classList.add('exenter'); sceneTimeout(() => bw.classList.remove('exenter'), 600) } // exlocked: cards out of reach until the release
  V.refs.tricounter?.classList.add('live') // the tri-counter + foe read are the stage of ②/③
  V.refs.exfoe?.classList.add('live')
  const layer = V.refs.floatlayer
  if (!layer) return
  const el = $(`<div class="exbeat big" id="exflag">— the exchange —</div>`)
  layer.appendChild(el)
  void el.offsetWidth
  el.classList.add('go')
}

/** Beat ⑤ / defensive cleanup — release: the board re-brightens, the flag lifts, the glows settle. */
function exchangeExit(): void {
  if (!V) return
  V.refs.boardwrap?.classList.remove('exmode', 'extide', 'exenter', 'exlocked') // the lockout ALWAYS lifts here (release beat + the defensive endScreen path)
  V.refs.tricounter?.classList.remove('live')
  V.refs.exfoe?.classList.remove('live')
  drainCls(false, V.refs.exatk, V.refs.ehpv, V.refs.phpv, V.refs.exinc, V.refs.exguard, V.refs.tcch)
  const flag = document.getElementById('exflag')
  if (flag) { flag.classList.remove('go'); sceneTimeout(() => flag.remove(), 450) }
}

/** "Round N" stamps over the board as the new round opens — the release moment's punctuation. */
function roundStamp(round: number): void {
  const layer = V?.refs.floatlayer
  if (!layer) return
  const el = $(`<div class="roundstamp">Round ${round}</div>`)
  layer.appendChild(el)
  void el.offsetWidth
  el.classList.add('go')
  sceneTimeout(() => el.remove(), 1300)
}

/** Beat ⑤: the scoreboard's foe side flares as the fresh telegraph lands. */
function pulseTelegraph(): void {
  const el = V?.refs.exfoe
  if (!el) return
  el.classList.remove('reveal')
  void el.offsetWidth
  el.classList.add('reveal')
}

/* BAM/POW IMPACT CARDS — old-Batman burst words stamped over each beat's target at its impact
   moment (playtest 2026-06-11: the hits/defends/mutations need BIG comic punctuation). One body-level
   layer (#bamlayer, a BODY_SINGLETON); rotation walks a fixed ±6° cycle for the hand-stamped feel. */
const BAM_ROT = [-6, 4, -3, 6, -5, 3]
let bamCycle = 0
/** Stamp `word` centered over `anchor` (viewport coords — survives the board's dim filter).
 *  cls picks the palette (hit=gold/red · guard=blue · pain=red · tide=phosphor · soft=faint);
 *  scale grows the stamp with the moment's magnitude. Reduced motion: brief static text, no pop. */
function bamWord(word: string, cls: 'hit' | 'guard' | 'pain' | 'tide' | 'soft' | 'dodge', anchor: HTMLElement | null | undefined, scale = 1): void {
  if (!anchor || !anchor.isConnected) return
  let layer = document.getElementById('bamlayer')
  if (!layer) { layer = $(`<div id="bamlayer"></div>`); document.body.appendChild(layer) }
  const r = anchor.getBoundingClientRect()
  const el = $(`<div class="bam bam-${cls}">${word}</div>`)
  el.style.left = `${r.left + r.width / 2}px`
  el.style.top = `${r.top + r.height / 2}px`
  el.style.setProperty('--rot', `${BAM_ROT[bamCycle++ % BAM_ROT.length]}deg`)
  el.style.setProperty('--sc', String(scale))
  layer.appendChild(el)
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.classList.add('static') // no animation — a brief static read, then gone
    sceneTimeout(() => el.remove(), 650)
    return
  }
  void el.offsetWidth
  el.classList.add('go')
  sceneTimeout(() => el.remove(), 1150) // past the 1.05s pop-fade
}

function interpretChunk(events: CombatEvent[]): void {
  if (!V || !events.length) return
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
  // a resolved set means its cards are IN FLIGHT to the counter — the landing owns the punch
  // (cellLand/flashStat fire from landPunch when each card arrives, never before)
  const resolveFlight = !REDUCED.matches && events.some((e) => e.type === 'setResolved')
  const bursts: [string, string, string, string, ('trick' | 'wound')?][] = []
  const queueFlash = (k: 'trap' | 'trick' | 'wound', pow = 1) => { if (!flashKind || FLASH_PRI[k] > FLASH_PRI[flashKind]) { flashKind = k; flashPow = pow } }
  // a player-initiated action (ability/potion) owns its line; its damage/heal/block/mana fold INTO it
  // rather than spawning a separate, generic "you land a blow" line afterward
  let actor: { el: HTMLElement; base: string; dmg: number; magic: boolean; heal: number; block: number; mana: [number, number, number] } | null = null
  for (const e of events) {
    switch (e.type) {
      case 'attackBanked':
        // v3: an Attack set BANKS toward the exchange — show the building swing, not a hit
        floatBoard(`⚔ +${e.amount}`, 'var(--red)', 'enemy')
        if (!resolveFlight) { flashStat('exatk'); cellLand('tcatk') } // otherwise the flight's landing punches
        V.stats.dealt += e.amount
        break
      case 'chargesGained':
        if (!resolveFlight) { cellLand('tctac'); flashStat('tcch') } // the ⚙ ring fires when the Move card lands
        break
      case 'roundStarted':
        log(e.incoming != null
          ? `<b>Round ${e.round}</b> — the ${foe} telegraphs <b>⚔${e.incoming}</b>.`
          : `<b>Round ${e.round}</b> — the ${foe} circles: <b>no strike</b> this round.`, 'foe')
        kickClock() // the round bar refills with the deal
        break
      case 'tacticsBurned':
        // §5.7 live-burn: each ~1/s burn rolls one card (the morph + the ⚙ counter carry it). Keep the
        // log quiet — only mark the moment the bank runs dry, so the tide reads as continuous, not spammy.
        if (e.remaining === 0) log('<b>Maneuver</b> — the bank runs dry; the tide settles.', 'you')
        break
      case 'combo':
        // §7/§13 combo streak — the visceral skill layer (full floaty escalation in onCombo).
        onCombo(e.level, e.styled, e.color)
        break
      case 'enemyDamaged': {
        if (e.immune) { log('Swords pass through — only magic bites this foe.', 'foe'); floatBoard('blocked', 'var(--ink-faint)', 'enemy'); break } // fixed rule line — never varied
        // §7/§13 the floaty system, sized by magnitude: a normal hit scales with damage; a CRIT shouts
        // big and folds the BAM in through floatText's top tier ("more than you expected")
        if (e.crit) floatText(`✦ CRIT −${e.amount}`, { mag: 1.05, color: 'var(--gold)', side: 'enemy', bam: 'hit' })
        else floatText(`−${e.amount}`, { mag: Math.min(0.85, 0.3 + e.amount / 90), color: e.magic ? 'var(--gold)' : 'var(--red)', side: 'enemy' })
        flashStat('ehpv')
        spriteReact('foe', 'sphit'); spriteReact('you', 'splunge')
        V.stats.dealt += e.amount
        if (actor && !e.crit) { actor.dmg += e.amount; if (e.magic) actor.magic = true; break } // fold into the action's own line (a crit gets its own shout)
        if (e.crit) log(`✦ <b>CRITICAL</b> — you strike for <b>−${e.amount}</b>!`, 'you big')
        else { const tier = tierOf(e.amount, 12); if (e.magic) log(`${magicLead()} — drains <b>${e.amount}</b>.`, 'you'); else log(`You land ${strikeWord(tier)} — <b>−${e.amount}</b>.`, tier === 'heavy' ? 'you big' : 'you') }
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
      case 'blockGained': {
        // sated guard cue: the gain past an already-met telegraph is waste — say so, greyly
        const wasSated = V.state.incoming != null && V.state.block - e.amount >= V.state.incoming
        floatBoard(wasSated ? `+${e.amount}🛡 wasted` : `+${e.amount}🛡`, wasSated ? 'var(--ink-faint)' : 'var(--blue)', 'you', wasSated ? 'wasted' : undefined)
        if (!wasSated && !resolveFlight) { cellLand('tcgrd'); flashStat('exguard') } // the guard cell rings as real Block lands (waste gets no reward ring; a flight rings on landing)
        if (actor) { actor.block += e.amount; break }
        log(wasSated ? `<span style="opacity:.7">You brace — but the guard already meets their strike.</span>` : `You brace — <b>+${e.amount}</b> Defend.`, 'you')
        break
      }
      case 'blockOverflow':
        // pure loss past the cap (the skill signal — never reward-colored)
        floatBoard(`${e.amount} block wasted`, 'var(--ink-faint)', 'you', 'wasted')
        log(`<span style="opacity:.7">Your guard can hold no more — <b>${e.amount}</b> Block wasted.</span>`, 'foe')
        break
      case 'manaGained': {
        if (actor) { for (let i = 0; i < 3; i++) actor.mana[i] += e.mana[i]; break } // fold potion/ability mana into its line
        // set income: float only a SIZEABLE mono-colour bank (≥3) so it reads "you charged up" without spamming every set
        const top = e.mana.indexOf(Math.max(...e.mana))
        if (e.mana[top] >= 3) floatText(`+${e.mana[top]}${MANA_ICON[top]}`, { mag: 0.34, color: `var(--c${top})`, side: 'you' })
        break
      }
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
        log(`<b>Stand Ground</b> — the ${e.what === 'lock' ? 'lock' : e.what === 'shatter' ? 'wound' : 'warp'} breaks against your line (−${e.cost} charge${e.cost > 1 ? 's' : ''}).`, 'you')
        floatBoard('🛡 warded', 'var(--gold)', 'you')
        V.dev.wards++
        V.dev.reshapeFoe++ // the enemy ATTEMPTED a reshape — count the attempt or the share reads false-high
        // the ward BEAT: burn the pip(s) on the gauge + a one-beat shield shimmer on the board edge
        const meter = document.querySelector('[data-sec="tactics"] .tacpips')
        meter?.classList.remove('wardpulse'); void (meter as HTMLElement | null)?.offsetWidth; meter?.classList.add('wardpulse')
        const bw = V.refs.boardwrap
        if (bw) { bw.classList.remove('wardshield'); void bw.offsetWidth; bw.classList.add('wardshield') }
        // the SAVED card(s) shake violently, then settle strongly and resolutely (it was NOT destroyed)
        for (const slot of e.slots ?? []) {
          const card = V.refs.board?.querySelector<HTMLElement>(`[data-i="${slot}"]`)
          if (card) { card.classList.remove('warded-save'); void card.offsetWidth; card.classList.add('warded-save') }
        }
        // the STAND GROUND stance (the wheel) flashes in time with the block (a kerchunk cue once audio lands)
        const wheel = V.refs.tactics
        if (wheel) { wheel.classList.remove('wardflash'); void wheel.offsetWidth; wheel.classList.add('wardflash') }
        break
      }
      case 'buffFaded':
        log(`<span style="opacity:.85">✧ ${e.label}.</span>`, 'you')
        break
      case 'playerBlocked':
        log(`The ${foe} ${pick(voice.hit)} you — your guard holds, <b>no damage</b>.`, 'foe')
        break
      case 'strikeDodged':
        log(`You read the blow and slip aside — the ${foe} strikes <b>nothing but air</b>.`, 'you')
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
      case 'tacticChanged': {
        // §5.7: stances are LIVE — Maneuver starts a brief gather then burns ~1/s; Stand Ground is an
        // instant bail (keeps the bank, resumes warding). No more "locks at the next deal".
        log(e.tactic === 'stand'
          ? `You <b>Stand Ground</b> — charges now ward enemy meddling (a wound costs ${WOUND_WARD_COST}).`
          : 'You shift to <b>Maneuver</b> — the tide gathers, then rolls the board ~1 card/sec.', 'you')
        const bw = V.refs.boardwrap
        if (bw) {
          bw.classList.remove('stance-stand', 'stance-maneuver')
          void bw.offsetWidth
          bw.classList.add(e.tactic === 'stand' ? 'stance-stand' : 'stance-maneuver')
        }
        floatBoard(e.tactic === 'stand' ? '🛡 STAND GROUND' : '⚙ MANEUVER', e.tactic === 'stand' ? 'var(--gold)' : 'var(--phos)')
        break
      }
      case 'biasChanged': {
        const name = e.bias ? BIAS_NAME[e.bias.axis]?.[e.bias.value] : null
        log(e.bias && name ? `The tide sets — Maneuver toward <b>${name}</b>.` : 'Maneuver bias cleared — charges hold.', 'you')
        if (e.bias) coachNotify('tactic') // guided intro: "pick a wheel spoke" step
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
        // v3 interim stall re-anchor: a stall verb STRETCHES the round (+) / an enemy yank shortens it (−)
        if (e.deltaSeconds > 0) {
          kickClock() // the round bar recoils + visibly refills as roundEndsAt moves out
          log(`<span style="opacity:.85">⏳ The round stretches — <b>+${e.deltaSeconds}s</b>.</span>`, 'you')
        } else if (e.deltaSeconds < 0) {
          log(`The ${foe} hurries the exchange — <b>${e.deltaSeconds}s</b>.`, 'foe')
        }
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
        showBriefing(() => { if (V) { V.paused = false; V.lastT = 0; hitstop(graceMs()) } }) // grace on each gauntlet foe too
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

/** THE FLOATY-TEXT SYSTEM — one non-clickable rising-fading popover for everything the player wants to
 *  know, SIZED BY MAGNITUDE (`mag` 0..1+): a whisper (+2 mana) → a shout (−60 CRIT). At the top end it
 *  also fires a bamWord stamp (the BAM tier folds in here). Never blocks the board (the floatlayer is
 *  pointer-events:none). All over-board feedback routes through this. */
function floatText(text: string, opts: { mag?: number; color?: string; side?: 'you' | 'enemy'; cls?: string; bam?: 'hit' | 'guard' | 'pain' | 'tide' | 'soft' | 'dodge' } = {}): void {
  const layer = V?.refs.floatlayer
  if (!layer) return
  const mag = Math.max(0, Math.min(1.4, opts.mag ?? 0.4))
  const el = $(`<div class="floater${opts.cls ? ` ${opts.cls}` : ''}">${text}</div>`)
  el.style.color = opts.color ?? 'var(--ink)'
  el.style.setProperty('--mag', mag.toFixed(2)) // CSS scales font-size + rise + weight off this
  const side = opts.side
  el.style.left = side === 'you' ? `${14 + Math.random() * 16}%` : side === 'enemy' ? `${64 + Math.random() * 18}%` : `${32 + Math.random() * 34}%`
  el.style.top = side === 'you' ? `${56 + Math.random() * 22}%` : side === 'enemy' ? `${10 + Math.random() * 22}%` : `${28 + Math.random() * 26}%`
  layer.appendChild(el)
  void el.offsetWidth
  el.classList.add('go')
  setTimeout(() => el.remove(), 1100)
  // the BAM tier — a high-magnitude float also stamps (the "fold BAM in" continuum: whisper→shout→BAM)
  if (opts.bam && mag >= 0.8) bamWord(text, opts.bam, V?.refs.board, 1 + (mag - 0.8) * 1.6)
}
/** Back-compat shim: the old small board float, now routed through the unified floaty system. */
function floatBoard(text: string, color: string, side?: 'you' | 'enemy', cls?: string): void {
  floatText(text, { color, side, cls, mag: 0.4 })
}

/** §7/§13 the COMBO escalation — the visceral skill layer made loud: each match in the streak fires a
 *  floaty SIZED BY the live combo level, ramps the ambient combo-glow (overlay-only, never the board),
 *  and stamps a milestone BAM at the breakpoints. The crit at the exchange is the crescendo. */
function onCombo(level: number, styled: boolean, color: number): void {
  if (!V) return
  const glow = V.refs.comboglow
  if (level < 2) { if (glow) { glow.style.setProperty('--combo', '0'); glow.classList.remove('on') } return } // streak reset → glow off
  const n = Math.floor(level)
  const tint = color >= 0 ? `var(--c${color})` : 'var(--phos)'
  const mag = Math.min(1.1, 0.35 + level * 0.08) // the floaty GROWS with the streak
  floatText(`${styled ? '✦ ' : ''}${n}× combo`, { mag, color: tint, side: 'you', cls: 'combo' })
  if (glow) { glow.style.setProperty('--combo', String(Math.min(1, level / 8))); glow.classList.add('on'); glow.classList.remove('pulse'); void glow.offsetWidth; glow.classList.add('pulse') }
  if (n === 3 || n === 5 || n === 8 || n >= 12) bamWord(`${n}× COMBO`, 'tide', V.refs.board, 1 + Math.min(0.5, level * 0.05))
}

/** An infographic burst — icon + label + name + effect line. For sprung traps/tricks + hits.
 *  Anchored to the BOARD'S TOP EDGE (UX §4c#5), never over the cards — the post-trap re-scan
 *  (the board just changed!) stays unobstructed. Stacks upward; %-fallback outside combat. */
function burst(icon: string, label: string, name: string, eff: string, kind?: 'trick' | 'wound'): void {
  let layer = document.getElementById('burstlayer')
  if (!layer) { layer = $(`<div id="burstlayer"></div>`); document.body.appendChild(layer) }
  const stack = layer.querySelectorAll('.burst').length
  const b = $(`<div class="burst${kind ? ' ' + kind : ''}"><span class="bui">${icon}</span><span><span class="bul">${label}</span><br><span class="bun">${name}</span>${eff ? `<div class="bue">${eff}</div>` : ''}</span></div>`)
  const bw = V?.refs.boardwrap?.getBoundingClientRect()
  if (bw) {
    b.style.left = `${bw.left + bw.width / 2}px`
    b.style.top = `${Math.max(56, bw.top - 26 - stack * 62)}px`
  } else b.style.top = `${42 - stack * 8}%`
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

/** Recoil the ROUND bar — fired at each deal (the refill) and when a stall verb stretches the
 *  round. (Name is a clock-era holdover; it now kicks the round bar.) */
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

/** The start-of-combat board-read freeze, STRETCHED by the player's Speed edge (§5.7 Speed rider:
 *  "you size them up"). ~+150ms per point of Speed advantage, clamped to a sane window. */
function graceMs(): number {
  if (!V) return START_GRACE_MS
  const edge = V.state.stats.speed - V.state.foe.stats.speed
  return Math.max(START_GRACE_MS, Math.min(START_GRACE_MS + 2500, START_GRACE_MS + edge * 150))
}

/** Punch a HUD number (HP) when it changes — directs the eye to where the cost/hit landed. */
function flashStat(ref: string): void {
  const el = V?.refs[ref]
  if (!el) return
  el.classList.remove('hit')
  void el.offsetWidth
  el.classList.add('hit')
}

/** Pulse a tri-counter cell as its value LANDS (a verb-colored ring) — the accumulator is the
 *  primary resource read, so every gain gets its moment on the counter itself. */
function cellLand(ref: 'tcatk' | 'tcgrd' | 'tctac'): void {
  const el = V?.refs[ref]
  if (!el) return
  el.classList.remove('land')
  void el.offsetWidth
  el.classList.add('land')
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
  const remain = Math.max(0, (s.roundEndsAt - s.now) / 1000)
  // during the rollover choreography the HP/exchange/round HUD HOLDS its pre-exchange read —
  // the numbers land on their beats (swing → counter → deal), not all at once at dispatch
  if (!V.holdHud) {
    V.refs.php.style.width = pct(s.playerHP, s.playerMax)
    V.refs.ehp.style.width = pct(s.enemyHP, s.enemyMax)
    V.refs.phpv.textContent = `${s.playerHP}/${s.playerMax}`
    V.refs.ehpv.textContent = `${s.enemyHP}/${s.enemyMax}`
    // ROUNDS v3: the bar IS the round — full at the deal, empty at the rollover. Pure time:
    // the telegraph lives in the exchange scoreboard, so low/crit colors only mean "ending".
    const roundLen = ROUND_MS / 1000 + s.roundExtendedS
    V.refs.roundlab.textContent = s.running ? `Round ${s.round}${s.roundExtendedS > 0 ? ` · +${s.roundExtendedS}s` : ''}` : 'Round —'
    const clk = V.refs.clock
    clk.textContent = !s.running ? '—' : `${Math.ceil(remain)}s`
    clk.classList.toggle('low', remain <= 5 && remain > 2.5)
    clk.classList.toggle('crit', remain <= 2.5)
    const frac = Math.max(0, Math.min(1, remain / roundLen))
    V.refs.roundfill.style.width = `${s.running ? frac * 100 : 100}%`
    V.refs.roundfill.classList.toggle('low', remain <= 5 && remain > 2.5)
    V.refs.roundfill.classList.toggle('crit', remain <= 2.5)
    // §5.8 the DREAD METER — floor base (static) + within-fight fill (rises per round); lethal past the onset
    if (V.refs.dreadbar) {
      if (!s.dreadOn) V.refs.dreadbar.style.display = 'none'
      else {
        V.refs.dreadbar.style.display = ''
        const d = dreadLevel(s)
        V.refs.dreadfill.style.width = `${(d / DREAD_MAX) * 100}%`
        V.refs.dreadfloor.style.width = `${(Math.min(s.dreadFloor, DREAD_MAX) / DREAD_MAX) * 100}%`
        V.refs.dreadlab.textContent = d.toFixed(1)
        V.refs.dreadbar.classList.toggle('lethal', d >= DREAD_ONSET)
        V.refs.dreadbar.classList.toggle('rising', d >= 5 && d < DREAD_ONSET)
      }
    }
    // THE TRI-COUNTER — your three round accumulators (the resource you build) vs their telegraph
    V.refs.exatk.textContent = String(Math.round(s.roundAttack))
    const lethal = s.running && s.roundAttack > 0 && s.roundAttack >= s.enemyHP
    V.refs.tcatk.classList.toggle('lethal', lethal) // the kill-race read: this swing ends it
    // §5.7 dodge folds into the telegraph: incoming 0 with dodged swings = a full WHIFF (free round);
    // a partial dodge tags the surviving total with 💨×N.
    const dodgedAll = s.running && s.incoming === 0 && s.incomingDodged > 0
    V.refs.exinc.textContent = dodgedAll
      ? '💨 DODGED'
      : s.incoming != null
        ? `⚔ ${s.incoming}${s.incomingDodged > 0 ? `  💨×${s.incomingDodged}` : ''}`
        : 'no strike'
    V.refs.exfoe.classList.toggle('idle', s.incoming == null || dodgedAll)
    const sated = !dodgedAll && s.incoming != null && s.incoming > 0 && s.block >= s.incoming // guard meets the telegraph: more Defend = waste
    V.refs.exguard.textContent = String(s.block)
    V.refs.tcgrd.classList.toggle('sated', sated)
    V.refs.tcgrd.classList.toggle('freeround', dodgedAll) // the "no need to Defend" cue
    // the GUARD METER — a bar that FILLS with Block vs the telegraph, so you SEE the guard build and
    // stop stacking once it's met (full + gold = sated; empty when there's no strike to guard)
    if (V.refs.exguardfill) {
      const need = s.incoming != null && s.incoming > 0 ? s.incoming : 0
      V.refs.exguardfill.style.width = need > 0 ? `${Math.min(100, (s.block / need) * 100)}%` : '0%'
    }
    // the CRIT% display — the live, combo-earned chance for this exchange's swing (ramps as you combo)
    if (V.refs.critval) {
      const cc = Math.round(playerCritChance(s) * 100)
      V.refs.critval.textContent = String(cc)
      V.refs.critdisp.classList.toggle('hot', cc >= 15) // emphasize when a hot streak has it ramping
    }
    // the BITE PREVIEW (UX §4c#4, the Into the Breach lesson): never raw inputs when the resolved
    // consequence fits in one glyph — what bites past the guard, and the wounds it would scar
    const bite = s.running && s.incoming != null && s.incoming > s.block ? s.incoming - s.block : 0
    const tcb = V.refs.tcbite
    if (tcb) {
      if (bite > 0) {
        const w = Math.min(WOUND_CAP_PER_EXCHANGE, Math.floor(bite / woundQuantum(s)))
        tcb.textContent = `take ${bite}${w > 0 ? ` · ${w} wound${w > 1 ? 's' : ''}` : ''}`
      }
      tcb.classList.toggle('show', bite > 0)
    }
    // the charge count + pips (floor of the fractional bank; the dump drains them on its beat)
    const lit = Math.floor(s.charges)
    V.refs.tcch.textContent = String(lit) // charge POINTS floor into the counter + pips
    V.refs.tacpips?.querySelectorAll<HTMLElement>('.pip').forEach((p, i) => p.classList.toggle('fl', i < lit))
  }
  V.refs.enemylab.textContent = 'HP' // identity lives beside the gauge now (the fused foe band) — no double name
  for (let c = 0; c < 3; c++) { // the mana bank: number + pip strip (same grammar as the charge gauge)
    V.refs['m' + c].textContent = String(s.mana[c])
    V.refs['mp' + c]?.querySelectorAll<HTMLElement>('.pip').forEach((p, i) => p.classList.toggle('fl', i < s.mana[c]))
  }
  // active transient buffs — persist on the bar while live, vanish as each fades (logged separately)
  const buffs: string[] = []
  if (s.attackFrozen) buffs.push('👻 Invisible')
  if (s.nextSetDamageMult > 1) buffs.push(`💪 ×${s.nextSetDamageMult}`)
  if (s.tickSuppressedUntil > s.now) buffs.push(`⏳ ${Math.ceil((s.tickSuppressedUntil - s.now) / 1000)}s`)
  V.refs.buffind.textContent = buffs.join('  ')
  V.refs.buffind.classList.toggle('on', buffs.length > 0)
  // the foe rears as its telegraphed exchange draws near (behavior cue, not a second timer)
  V.refs.spfoe?.classList.toggle('winding', s.running && s.incoming != null && remain <= 5 && !V.holdHud)
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
const AXIS_ICONS: Record<string, string[]> = { color: ['🔥', '🌿', '❄'], shape: ['⚔', '🛡', '👟'], number: ['①', '②', '③'], mag: ['①', '②', '③'] }
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
  // STANCE PRESENCE — the selected tactic owns the board's edge: Stand Ground = a gold guard ring
  // (intensity = banked charges); Maneuver = a teal current. The badge on your sprite shows the
  // stance (and the chosen bias) at a glance.
  const bw = V.refs.boardwrap
  if (bw) {
    const standing = s.running && s.tactic === 'stand'
    bw.classList.toggle('guarded', standing && s.charges > 0)
    if (standing) bw.style.setProperty('--guard', String(Math.min(1, s.charges / CHARGE_CAP)))
    bw.classList.toggle('flowing', s.running && s.tactic === 'maneuver' && !!s.maneuverBias && s.charges > 0)
  }
  if (V.refs.stancebadge) {
    V.refs.stancebadge.textContent = s.tactic === 'stand'
      ? '🛡'
      : (bias ? (AXIS_ICONS[bias.axis]?.[bias.value] ?? '⚙') : '⚙')
    V.refs.stancebadge.classList.toggle('armed', s.charges > 0)
  }
  // the duelists (PLACEHOLDER art): each paces its own band with the tug — the winner ADVANCES,
  // the loser gives ground. Typical differentials are small (±0.1–0.3), so the gain is steep.
  // (The tug bar itself retired into a hidden dock — the sprites + their tooltip carry the read.)
  const step = Math.max(-1, Math.min(1, d * 3)) * 150
  if (V.refs.spyou) V.refs.spyou.style.transform = `translateX(${Math.max(-18, step)}px)`
  if (V.refs.spfoe) V.refs.spfoe.style.transform = `translateX(${Math.min(18, step)}px)`
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
  // sets/round vs the A2 axiom: ~3 = baseline, 4–6 = competent (warn outside 2..7)
  const spr = s.now > 10_000 && s.round > 0 ? d.matches / s.round : null
  const cell = (k: string, v: string, off: boolean) => `<span class="${off ? 'off' : ''}">${k} <b>${v}</b></span>`
  const fs = s.foe?.stats // the live contest numbers — system insight, dev-only
  const html = [
    cell('reshape', share == null ? '—' : `${share}% <i>→65–70</i>`, share != null && (share < 60 || share > 78)),
    cell('spring', spring == null ? '—' : `${spring}% <i>→~30</i>`, spring != null && (spring < 15 || spring > 45)),
    cell('sets/rnd', spr == null ? '—' : `${spr.toFixed(1)} <i>→3–6</i>`, spr != null && (spr < 2 || spr > 7)),
    cell('sets/min', spm, false),
    cell('gimme', gimme == null ? '—' : `${gimme}%`, false),
    cell('wards', String(d.wards), false),
    cell('churns', String(d.churns), false),
    // system numbers (the contest under the hood) — only ever visible in dev mode
    cell('foe P/E/S', fs ? `${fs.power}/${fs.endurance}/${fs.speed}` : '—', false),
    cell('telegraph', s.foe ? String(Math.round(s.foe.damage)) : '—', false),
    cell('dread', dreadLevel(s).toFixed(1), false),
    cell('round', String(s.round), false),
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
  V.holdHud = false // a mid-choreography end must not leave the HUD frozen on stale numbers…
  exchangeExit() // …nor the field stuck in exchange mode (dim/vignette/flag/drain glows)
  updateBar() // …so paint the final read once before the loop dies
  cancelAnimationFrame(V.raf)
  if (V.refs.fleebtn) V.refs.fleebtn.style.display = 'none' // no fleeing a finished fight
  document.getElementById('ptint')?.classList.remove('low', 'crit') // drop the low-HP vignette on the end card
  // persist the hero's HP across the hub↔combat boundary (the seed of the run-attrition layer)
  V.char.hp = Math.max(0, Math.min(V.char.maxHp, V.state.playerHP))
  upsertChar(V.char)
  if (DELVE) { delveFork(result); return } // the delve owns its own end beat (the between-rooms fork)
  const text = result === 'win' ? '★ Victory' : result === 'flee' ? '🏃 Fled' : '✖ Defeat'
  const banner = $(`<div class="banner ${result === 'win' ? 'win' : 'lose'}">${text}</div>`)
  const again = $<HTMLButtonElement>(`<button class="cta" style="display:block;margin:0 auto">▶ Back to town</button>`)
  V.refs.boardwrap.replaceChildren(banner, combatChart(), again)
  again.addEventListener('click', () => goScene(characterSelectScene))
}

/** Bank the kill's XP onto the live character (always banks; persisted immediately) + tally it for
 *  the end-of-combat / fork summary. A floating "+N XP" gives the kill its dopamine in-fight. */
function awardXP(foe: CombatState['foe']): void {
  if (!V) return
  const x = computeXP(foe, V.char.level) // the outlevel penalty applies (sim §8 — farming trivial content doesn't pay)
  if (x <= 0) return
  V.stats.xp += x
  if (V.char.level < LEVEL_CAP) V.char.xp += x // at the cap, XP stops accruing (nothing left to buy)
  upsertChar(V.char)
  floatBoard(`+${x} XP`, 'var(--gold)', 'enemy')
}

/** The end-of-combat contribution chart (shared by the lone-fight end card and the delve's enders). */
function combatChart(): HTMLElement {
  const st = V!.stats
  const rows: [string, number, string][] = [
    ['Damage dealt', st.dealt, 'var(--red)'],
    ['Damage taken', st.taken, 'var(--warn)'],
    ['Damage blocked', st.blocked, 'var(--blue)'],
    ['HP healed', st.healed, 'var(--green)'],
    ['Sets made', st.sets, 'var(--phos)'],
    ['Traps sprung', st.traps, 'var(--gold)'],
  ]
  const max = Math.max(1, ...rows.map((r) => r[1]))
  const bars = rows
    .map(([l, v, c]) => `<div class="feat"><span class="fl">${l}</span><span class="fbar"><span style="width:${(v / max) * 100}%;background:${c}"></span></span><span class="fv">${v}</span></div>`)
    .join('')
  // the XP footer: what this fight/run earned + the level/curve read (a level-up waits in town)
  const ch = V!.char
  const ready = pendingLevels(ch)
  const lvl = ch.level >= LEVEL_CAP ? '★ MAX' : `Lv ${ch.level}`
  const xpLine = ch.level >= LEVEL_CAP
    ? `<span class="sx-lvl">${lvl}</span>`
    : `<span class="sx-lvl">${lvl}</span> <span class="sx-bar"><span style="width:${Math.min(100, (ch.xp / xpForLevel(ch.level)) * 100)}%"></span></span> <span class="sx-num">${ch.xp}/${xpForLevel(ch.level)}</span>`
  const readyLine = ready > 0 ? `<div class="sx-ready">⬆ ${ready} level-up${ready > 1 ? 's' : ''} ready — allocate in town</div>` : ''
  return $(`<div class="summary">${bars}<div class="summary-xp"><span class="sx-lab">✦ +${V!.stats.xp} XP</span>${xpLine}</div>${readyLine}</div>`)
}

/* ---- THE BETWEEN-ROOMS FORK — the delve's heartbeat (CRAWL §2 / §6 first cut) ----
   Win → loot (PLACEHOLDER: one random consumable into the satchel) + the fork: press on or carry
   the spoils home. Flee → the same fork at a price: no spoils, the next chamber rerolled, the
   elite sawtooth reset. Boss win → the dungeon is CLEARED (the run's best exit). Death → the run
   and the satchel are lost where you fell. Still TODO from the exit ladder: the parting blow on
   flee, gold/XP on the loot roll, the death tithe — they land with the economy (TODO §B2). */
/** Bank the run's found gear into account Storage (SAFE exit only — lost on death, like the satchel).
 *  Overflow (Storage cap 20 full) is dropped for now; the bag screen + return-triage (deferred B2) will
 *  let you choose what to keep. Equipping from Storage is the NEXT slice — until then drops are stowed. */
function bankGearFound(): { banked: number; overflow: number } {
  if (!DELVE || !DELVE.gearFound.length) return { banked: 0, overflow: 0 }
  const before = DELVE.gearFound.length
  const { account, overflow } = addManyToStorage(loadBank(), DELVE.gearFound)
  saveBank(account)
  return { banked: before - overflow.length, overflow: overflow.length }
}
function gearLine(g: { banked: number; overflow: number }): string {
  if (!g.banked && !g.overflow) return ''
  const stow = g.banked ? ` Stowed <b>${g.banked}</b> gear in your vault.` : ''
  return stow + (g.overflow ? ` (${g.overflow} lost — Storage full.)` : '')
}
/** The dungeon-clear MARQUEE reveal — the headline rare+ piece (§3). */
function marqueeCardEl(g: GearInstance): HTMLElement {
  const b = gearBase(g.refId)
  const aff = g.affixes.length ? g.affixes.map(affixShort).join(' · ') : '—'
  return $(`<div class="lootcard gearloot marquee"><span class="loot-lab r-${g.rarity}">★ marquee · ${g.rarity}</span><span class="gs-ic r-${g.rarity}">${b?.icon ?? '🎁'}</span><div class="loot-id"><div class="ln r-${g.rarity}">${b?.name ?? g.refId}</div><div class="ld">${aff}</div></div></div>`)
}

function delveFork(result: 'win' | 'lose' | 'flee'): void {
  if (!V || !DELVE) return
  const char = V.char
  const host = V.refs.boardwrap
  DELVE.bag = V.state.consumables.slice() // what survived the fight IS the satchel (drunk = gone)
  const room = DELVE.d.room
  const dgName = GAMEDATA.dungeons[DELVE.d.dungeonId]?.name ?? 'the dungeon'

  // DEATH — the run ends: the satchel + the run's carried gold are lost, and a tithe bites the bank
  if (result === 'lose') {
    const lost = DELVE.gold
    const tithe = bankTithe() // forfeit 12% of BANKED gold (the exit ladder, §6)
    DELVE = null
    const home = $<HTMLButtonElement>(`<button class="cta" style="display:block;margin:0 auto">🏠 Back to town</button>`)
    home.addEventListener('click', () => goScene(characterSelectScene))
    const tolls = [`Your satchel${lost > 0 ? ` and ${lost}🪙 carried` : ''} is lost where you fell.`, tithe > 0 ? `The recovery tithe takes ${tithe}🪙 from your vault.` : ''].filter(Boolean).join(' ')
    host.replaceChildren(
      $(`<div class="banner lose">✖ Slain — room ${room} claims you</div>`),
      $(`<div class="forksub">${tolls}</div>`),
      combatChart(), home,
    )
    return
  }

  // BOSS DOWN — the dungeon is cleared (the run's best exit). Loot rolls, then the run-gold banks.
  if (result === 'win' && DELVE.tier === 'boss') {
    const lootEl = delveLootReveal() // accrues any boss-room gear into DELVE.gearFound FIRST
    const marquee = rollMarqueeGear(V!.state.foe, DELVE.d.room, systemRng) // §3 dungeon-clear MARQUEE: a guaranteed rare+ piece
    DELVE.gearFound.push(marquee)
    const mqEl = marqueeCardEl(marquee)
    const carried = DELVE.gold
    const bag = DELVE.bag
    const total = bankGold(carried) // the whole run's gold banks into the vault
    const gear = bankGearFound() // …and the run's gear (incl. the marquee) into Storage (before DELVE clears)
    DELVE = null
    const home = $<HTMLButtonElement>(`<button class="cta bob" style="display:block;margin:0 auto">🏆 Carry the spoils home</button>`)
    home.addEventListener('click', () => goScene(characterSelectScene))
    host.replaceChildren(
      $(`<div class="banner win">🏆 ${dgName} — CLEARED in ${room} rooms</div>`),
      mqEl, lootEl, $(satchelHTML(bag)),
      $(`<div class="forksub">Banked <b>${carried}🪙</b> — vault now <b>${total}🪙</b>.${gearLine(gear)}</div>`),
      combatChart(), home,
    )
    return
  }

  // THE FORK — press on or go home (between rooms only, after a clear; flee pays its price here)
  const fork = $(`<div class="forkwrap"></div>`)
  if (result === 'win') {
    fork.appendChild($(`<div class="banner win">★ Room ${room} cleared</div>`))
    fork.appendChild(delveLootReveal())
  } else {
    DELVE.d = fleeReroll(DELVE.d) // the sawtooth resets; the next chamber rerolls (bossFound holds)
    fork.appendChild($(`<div class="banner lose">🏃 You slip away</div>`))
    fork.appendChild($(`<div class="forksub">No spoils from this room. The passages shift behind you — the next chamber is rerolled.</div>`))
  }
  fork.appendChild($(satchelHTML(DELVE.bag)))
  fork.appendChild($(`<div class="runpurse" data-tip-title="Carried gold" data-tip="Gold gathered this run. It banks to your vault the moment you reach town — but a death loses it all.">🪙 <b>${DELVE.gold}</b> carried</div>`))
  const band = dreadBand(DELVE.d)
  const pips = '●'.repeat(band.step + 1) + '○'.repeat(4 - band.step)
  fork.appendChild($(`<div class="dread" data-tip-title="Dread" data-tip="The deeper you press, the surer the throne room. Each room entered walks the curve — cleared or fled."><span class="pips">${pips}</span>${band.label}</div>`))
  const btns = $(`<div class="forkbtns"></div>`)
  const gearN = DELVE.gearFound.length
  const home = $<HTMLButtonElement>(`<button class="cta ghost">🏠 Cash out (bank ${DELVE.gold}🪙${gearN ? ` + ${gearN} gear` : ''})</button>`)
  home.addEventListener('click', () => { if (DELVE) { bankGold(DELVE.gold); bankGearFound() } goScene(characterSelectScene) })
  const deeper = $<HTMLButtonElement>(`<button class="cta bob">▶ Delve deeper</button>`)
  deeper.addEventListener('click', () => goScene((r) => delveRoom(r, char)))
  btns.append(home, deeper)
  fork.appendChild(btns)
  host.replaceChildren(fork)
}

/** Roll a cleared room's loot (CRAWL §3): gold → the run purse, consumables → the satchel (cap 10).
 *  Returns the reveal: a gold line + an item card per drop (or a "satchel full" note on overflow). */
function delveLootReveal(): HTMLElement {
  const wrap = $(`<div class="lootreveal"></div>`)
  if (!DELVE) return wrap
  const loot = rollRoomLoot(V!.state.foe, DELVE.d.room, systemRng, DELVE.gearPity)
  DELVE.gold += loot.gold
  DELVE.gearPity = loot.gearPity // carry the sawtooth into the next room
  if (loot.gold > 0) wrap.appendChild($(`<div class="lootgold">🪙 <b>+${loot.gold}</b> gold</div>`))
  for (const g of loot.gear) {
    DELVE.gearFound.push(g) // accrues; banks to Storage on a safe exit (lost on death, like the satchel)
    const base = gearBase(g.refId)
    const affixTxt = g.affixes.length ? g.affixes.map(affixShort).join(' · ') : '—'
    wrap.appendChild($(`<div class="lootcard gearloot"><span class="loot-lab r-${g.rarity}">${g.rarity}</span><span class="gs-ic r-${g.rarity}">${base?.icon ?? '🎁'}</span><div class="loot-id"><div class="ln r-${g.rarity}">${base?.name ?? g.refId}</div><div class="ld">${affixTxt}</div></div></div>`))
  }
  for (const id of loot.items) {
    const c = CONSUMABLES[id]
    if (!c) continue
    if (DELVE.bag.length >= RUN_BAG_CAP) { wrap.appendChild($(`<div class="forksub">Satchel full — the ${c.name} is left behind.</div>`)); continue }
    DELVE.bag.push(id)
    const tint = c.color != null ? `var(--c${c.color})` : 'var(--line2)'
    wrap.appendChild($(`<div class="lootcard"><span class="loot-lab">loot</span><span class="cons-slot${c.kind === 'scroll' ? ' scroll' : ''}" style="--cc:${tint}"><span class="cons-ic">${c.icon}</span></span><div class="loot-id"><div class="ln">${c.name}</div><div class="ld">${c.desc}</div></div></div>`))
  }
  if (!wrap.children.length) wrap.appendChild($(`<div class="forksub">The room holds nothing of value.</div>`))
  if (isDev() && loot.trace.length) wrap.appendChild($(`<div class="devpanel devtrace"><span class="dvl">loot roll</span>${loot.trace.map((l) => `<span>${l}</span>`).join('')}</div>`))
  return wrap
}

/** The run satchel as a chip row (the carried consumables — next room's combat loadout). */
function satchelHTML(bag: string[]): string {
  const chips = bag.map((id) => {
    const c = CONSUMABLES[id]
    if (!c) return ''
    const tint = c.color != null ? `var(--c${c.color})` : 'var(--line2)'
    return `<span class="cons-slot${c.kind === 'scroll' ? ' scroll' : ''}" style="--cc:${tint}" data-tip-title="${c.name}" data-tip="${c.desc}"><span class="cons-ic">${c.icon}</span></span>`
  }).join('')
  return `<div class="satchel"><span class="satchel-lab">satchel ${bag.length}/${RUN_BAG_CAP}</span>${chips || '<span class="forksub">empty</span>'}</div>`
}

/* ---- pre-combat briefing ---- */
/** v3: foe quickness is exchange BEHAVIOR (the tempo law), never scan pressure — every foe gives
 *  the same 20s round. Describe the packaging the statline derives. */
function tempoLabel(f: CombatState['foe']): string {
  if (f.damage <= 0) return 'never strikes'
  if (f.strikeEvery > 1) return `every ${f.strikeEvery === 2 ? '2nd' : `${f.strikeEvery}rd`} round`
  return f.swings > 1 ? `${f.swings} swings<small> / round</small>` : 'every round'
}
function showBriefing(onEngage: () => void): void {
  if (!V) return
  document.getElementById('briefing')?.remove()
  const f = V.state.foe
  const seq = V.run.sequence
  const stats: [string, string][] = [
    ['HP', String(V.state.enemyMax)],
    ['Damage', `${Math.round(f.damage)}<small> max / swing</small>`],
    ['Tempo', tempoLabel(f)],
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
    ${seq ? `<div class="bseq">Gauntlet · ${V.run.seqIdx + 1} of ${seq.length}</div>` : DELVE ? `<div class="bseq">Room ${DELVE.d.room}${DELVE.tier === 'boss' ? ' · the throne room' : ''}</div>` : ''}
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

/** Anchor the coach popover over the LEFT RAIL (the combat log) — beside the board like a quest
 *  journal, covering NO controls: awaited steps (make a set, tap a spoke…) keep the whole play
 *  surface clickable. Falls back to the foe band (.headpanel) if the rail is missing, then to the
 *  CSS centering. Capped to the anchor's footprint; the body scrolls if a step's text runs long. */
function positionCoachPop(): void {
  const pop = document.getElementById('coachpop')
  if (!pop || !pop.classList.contains('show')) return
  const anchor = document.querySelector('.leftrail') ?? document.querySelector('.headpanel')
  if (!anchor) { pop.style.cssText = ''; return } // no combat scene (shouldn't happen) → CSS fallback
  const r = anchor.getBoundingClientRect()
  pop.style.left = `${r.left}px`
  pop.style.top = `${r.top}px`
  pop.style.width = `${r.width}px`
  pop.style.maxHeight = `${Math.max(320, Math.min(r.height, 560)) + 6}px`
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
    body: 'Every card shows three traits — a <b>colour</b>, a <b>shape</b>, and a <b>number</b> (1–3). The round is frozen; take your time looking them over.' },
  { icon: '✨', title: 'Make your first set', spot: '#board', await: 'match',
    hint: '▸ Click cards on and off to watch the gold set-mates light up, then complete a set.',
    body: 'A <b>set</b> is three cards where each trait is <b>all the same</b> or <b>all different</b> across the three. Pick any card — its <b>set-mates light up gold</b>. Try clicking a few cards on and off to see how the possibilities shift; pick a second and the card that <b>finishes the set</b> glows brightest. (If a pair can’t finish, both turn <b>red</b>.) Complete a set now.',
    done: 'Nice. A set resolves all three cards at once — that one act does several things together: <b>Attacks</b> bank damage toward your end-of-round swing, <b>Defends</b> raise <b>Block</b> against the foe\'s telegraphed strike, and <b>Moves</b> bank <b>Tactics charges</b>. Everything cashes out at the round\'s end — the <b>exchange</b>. The <b>colours</b> feed mana too: three of one colour banks a big chunk of that element, one-of-each banks a little of all three. Every match is offence, defence, agency, and resources in one move.' },
  { icon: '⚠️', title: 'Watch for traps', spot: '#strip', reveal: ['traps'], hold: true,
    body: "Tougher foes carry <b>traps</b> — rules that punish (or reward!) certain matches, shown in the <b>trap strip</b> in the foe's band at the top. This dummy has none, but the <b>Training · Gauntlet</b> has foes whose lines you must read, dodge, or deliberately spring." },
  { icon: '🎯', title: 'Use the Tactics wheel', reveal: ['tactics'], await: 'tactic', cue: 'moves',
    hint: '▸ Tap a spoke on the wheel (top arc = shapes, bottom arc = colours) — it locks at the next deal.',
    body: 'Matching <b>Move</b> cards (👟) banks <b>Tactics charges</b>. The <b>wheel</b> decides what they do — and your pick <b>locks at each deal</b>: the centre is <b>Stand Ground</b> (charges ward enemy board-meddling, live), the six spokes are <b>Maneuver</b> biases — what you want more of. Tap a spoke now to steer the next deal.',
    done: 'That is your tide. With <b>Maneuver</b>, the rollover burns ALL your charges at once, redrawing the deadest cards toward your spoke — the board exhales fresh possibility. <b>Stand Ground</b> instead spends charges live as a shield that eats enemy warps, locks, even wounds (3 charges), and the bank carries over. The stance <b>locks at each deal</b> — pick the round\'s posture and commit to it.' },
  { icon: '🔥', title: 'Cast an ability', reveal: ['abilities'], await: 'ability', cue: 'mana',
    hint: '▸ Match the highlighted cards (all one colour) to bank that mana; when an ability lights up, click it.',
    body: 'Matches also generate <b>mana</b> by colour. The cards of the colour your spells need most are <b>highlighted</b> — match them to bank that mana. When you can afford an ability it lights up with an arrow. Build mana and cast one.',
    done: 'Abilities are your burst — far bigger than a single match: heavy damage, healing, board-warping floods, hard enemy slows. Banking the right colour and spending it at the right moment is how you swing a fight, so read your spells and aim your matches at the mana they need.' },
  { icon: '🎓', title: "You're ready", spot: null, hold: true, finishLabel: 'Begin! ▸',
    body: "That's the whole loop: <b>find sets</b>, dodge traps, steer the <b>wheel</b>, spend <b>mana</b> — and cash it all out at each <b>exchange</b>. The round resumes when you close this — good luck." },
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
