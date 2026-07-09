/* ui/app — a functional, playable UI over the engine. Renders the board/HUD, turns clicks into
   `completeSet` actions, runs the frame loop via `tick`, and interprets CombatEvents into feedback.
   Intentionally a clean rebuild (not pixel-parity with the prototype). Layout (UX.md §4b MODERATE):
   three horizontal bands + side rails — the FOE BAND top (identity·vitals·telegraph·round·threats),
   the battlefield center (log rail · THE BOARD · command rail), the PLAYER BAND bottom (HP/buffs +
   the tri-counter). Plays the ROUNDS v3 game (CRAWL §5.6): matches accumulate by verb, the round
   bar drains to the rollover exchange (a choreographed diegetic beat — never a modal), the Tactics
   wheel queues next round's stance. The exchange plays on a real duel axis: swing bottom→top,
   counter top→bottom. */

import { systemRng, mulberry32, type Rng } from '../core/rng'
import { type Card, isSet, third, keyOf } from '../core/affine'
import { findSets, kOfSet } from '../core/sets'
import type { GenConfig } from '../core/generate'
import { GAMEDATA } from '../data/game-data'
import type { Dungeon, Trigger, Condition } from '../data/schema'
import { CLASSES, classById } from '../data/classes'
import { ABILITIES, canAfford, ABILITY_PREVIEW } from '../engine/abilities'
import { SHAPE_MOVE, matchDescriptor } from '../engine/resolve'
import { condMet } from '../engine/triggers'
import { revalidateSelection } from '../engine/select'
import { PASSIVES } from '../engine/passives'
import { assembleFoe, pickWeightedFoe, computeXP } from '../engine/foe'
import { colsForN, COMBAT_GEN, playerCritChance, dodgeReadout, type Deps, type CombatAction } from '../engine/combat'
import { createRun, runReduce, type RunState } from '../engine/run'
import { createDelve, nextEncounter, fleeReroll, dreadBand, RUN_BAG_CAP } from '../engine/delve'
import { rollMarqueeGear, rollMarketStock, rollRareStock } from '../engine/loot'
import { gearStatBonus, gearRiders, gearProcs, gearMods, rollGear } from '../engine/gear'
import { EQUIP_SLOTS, makeItem, type EquipSlot, type Rarity, type Affix, type AffixComponent, type GearInstance } from '../engine/items'
import { GEAR, gearBase, fitsSlot } from '../data/gear'
import { CONSUMABLES } from '../engine/consumables'
import { loadBank, saveBank, addToStorage, removeFromStorage, storageFull, storageCount, storageRoom, spendGold, updateStorageItem, addGold, takeConsumablesByRef, expandStorage, slotUpgradeCost, STORAGE_SLOT_STEP, STORAGE_SLOT_MAX } from './bank'
import { sellValue, itemValue, consumableValue, sellValueOfConsumable, buyPrice, buyPriceOfConsumable, markupForTier, qualityLvlBoost, RARE_MARKUP, MERCHANT_MARKUPS, MERCHANT_TIER_COST, QUALITY_TIER_COST } from '../engine/value'
import { gearTipTitle, gearTipBody, consumableTipTitle, consumableTipBody } from './item-desc'
import { type SmithOp, smithCost, nextRarity, canUpgrade, openSlots, enchantOptions, canEnchant, canReroll, canReceiveAffix, upgradeRarity, enchant, rerollAffixes, transferAffix } from '../engine/smith'
import { type DelveRun, type DelveLoot, applyRoomLoot, resolveDelveExit, resolveLootKeep } from './delve-run'
import { loadDelve, saveDelve, clearDelve } from './delve-persist'
import type { CombatState, FoeRuntime, StatBlock } from '../engine/state'
import { CHARGE_CAP, MANA_CAP, START_GRACE_MS, ROUND_MS, WOUND_WARD_COST, BOARD_WARD_COST, WOUND_CAP_PER_EXCHANGE, woundQuantum, dreadLevel, dreadFoeMult, dreadPlayerMult, DREAD_ONSET, DREAD_MAX, PRIMED_WINDOW_MS, CRIT_GRACE_MS } from '../engine/state'
import type { CombatEvent } from '../engine/events'
import { offenseRecap, defenseRecap, woundTail, knitLine, guardDropLine, lockLine, churnLine, dreadLine } from './combat-log'
import { careerRounds, bumpCareerRounds, paceForRounds } from './career'
import { skipAction, rollClicks } from './splash'
import { bumpTurn, pick, strikeWord, healWord, drainWord, magicLead, tierOf, joinClauses, voiceOf, ABILITY_FLAVOR } from './flavor'
import { type SavedChar, type StatAlloc, loadRoster, upsertChar, deleteChar, makeChar, freshId, CONSUMABLE_SLOTS, effectiveStats, xpForLevel, pendingLevels, applyLevelUp, addXP, LEVEL_CAP, activeSlotsAt, passiveSlotsAt, activeUnlockLevel } from './save'
import { isDev, toggleDev, onDevChange, displayName } from './dev'
import { getPrefs, setPref, bootRoute, showQuestCue } from './prefs'
import { cardHex, cardPipSVG } from './card-style'
import { $, esc } from './dom'
import { setRoot, setSceneTeardown, goScene, sceneTimeout, remountScene, initTooltips, sceneToken, isCurrentScene } from './router'
import { recordRun } from '../net/run-capture'
import { loadAccount, updateAccount, markRegistered, markDeclined, acknowledgeRecovery, applyRecovery } from '../net/account'
import { getConfig, setEnabled, setServerUrl } from '../net/config'
import { register as embassyRegister, recover as embassyRecover, bests as embassyBests, daily as embassyDaily, flushOutbox, EmbassyHttpError } from '../net/embassy'
import { pendingCount } from '../net/outbox'
import { embassyView, canRegister, canViewRecords, type EmbassyView } from '../net/embassy-status'
import { CONSENT_VERSION, type BestEntry } from '../net/contract'
import { CLIENT_RULESET_VERSION, CLIENT_CONTENT_VERSION } from '../net/version'
import { resolveDaily, type DailyFixed, type DailyResolution } from '../net/daily'
import { deriveDailySetup, dailyCandidatesFrom, DAILY_MAX_DIFFICULTY, type DailySetup, type DailyCandidates } from '../net/daily-select'

const GEN: GenConfig = COMBAT_GEN
/** one shared reduced-motion query — card feel (tilt/flights/staggers) falls back to fades */
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)')

// ---- card glyphs: Lucide line icons (MIT) — Attack=swords, Defend=shield, Move=footprints ----
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
/** A card as inline SVG: number+1 stacked shape glyphs (count = the number trait), recoloured by colour.
 *  In colour-blind mode the palette switches to the CVD-safe triad and a hue-independent shape pip is added
 *  (redundant encoding — colour stops being the one imperceptible match axis). */
function cardSVG(card: Card): string {
  const cvd = getPrefs().colorblind
  const hex = cardHex(card[0], cvd)
  const inner = SHAPE_PARTS[card[1]].map((p) => partMarkup(p, hex)).join('')
  const n = card[3] + 1
  const gap = 52
  const startY = 80 - (n * gap) / 2 + gap / 2
  let glyphs = ''
  for (let s = 0; s < n; s++) glyphs += `<g transform="translate(10,${startY + s * gap - 22})"><g transform="${GLYPH_T}">${inner}</g></g>`
  return `<svg class="cardsvg" viewBox="0 0 120 160" preserveAspectRatio="xMidYMid meet">${glyphs}${cardPipSVG(card[0], cvd)}</svg>`
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
  /** the run's RNG seed — drives board-gen + tick RNG, so {seed, actions} replays the in-combat run.
   *  Captured into the metrics record at run-end (net/run-capture). */
  seed: number
  classId: string
  loadout: string[] // the chosen class's ability ids (the active grid)
  coach: boolean // affordance arrows on (Training / Tutorial dungeons)
  coachCue: 'moves' | 'mana' | null // the guided stage's card cue (Move glow / mana-colour glow)
  manaColor: number // the colour the loadout needs most (dominant total cost) — glowed in the mana stage
  paused: boolean // freeze gate (coaching/briefing/flee-dialog AND the player pause) — stops ticks + input
  userPaused: boolean // the pause is PLAYER-initiated (spacebar) → toggleable; distinguishes it from a coaching freeze
  // P5 — wall-clock + player-pause telemetry (captured into instruments; engine `state.now` excludes paused
  // time, so a paused-planning "fastest clear" leaves no trace in {seed,actions} without this).
  wallStart: number // performance.now() at combat mount
  pausedMs: number // accumulated PLAYER-pause duration
  pauseCount: number // how many times the player paused
  pauseStart: number // performance.now() of the current player pause (0 = not currently player-paused)
  hitstopUntil: number // performance.now() until which ticks are frozen (impact freeze)
  holdHud: boolean // rollover choreography: HP/exchange/round HUD holds its pre-exchange read until the deal beat
  preview: number[] | null // board slots currently ringed by an ability hover
  selected: number[]
  lastLoggedSel: string // E7: the last selection written to the action log (so we only log real changes)
  raf: number
  lastT: number
  boardSig: string
  refs: Record<string, HTMLElement>
  /** running combat tallies for the end-of-combat contribution chart (UI-only, replay-safe) */
  stats: { dealt: number; taken: number; blocked: number; healed: number; sets: number; traps: number; xp: number; gearDmg: number; gearBlock: number; gearMana: number }
  /** per-ROUND activity, accumulated live (gated off during the exchange hold) → the breakdown's Ability/Mana parts; reset each round */
  roundFx: { casts: string[]; dmg: number; healed: number; transformed: number; locked: number; extended: number; mana: [number, number, number]; riderMana: number }
  /** slot → who pulled it (consumed when the slot's new card renders — the tug-attribution tint) */
  morphSrc: Map<number, 'churn' | 'drift' | 'trap' | 'trick'>
  /** the always-on dev balance instruments (TRAPS §5.5 targets etc.) — display-only, replay-safe */
  dev: { reshapeYou: number; reshapeFoe: number; matches: number; springs: number; k1: number; wards: number; churns: number }
  /** the rollover's swing/block math, stashed so the exchange's "you land …"/"foe strikes" log lines can
   *  carry the receipt breakdown (set in choreographRollover, consumed once in interpretChunk). */
  exSwing?: Extract<CombatEvent, { type: 'swingMath' }>
  exBlock?: Extract<CombatEvent, { type: 'blockMath' }>
  /** the last dread level we announced in the log (so the 0.5/round rise only narrates on new steps) */
  lastDread: number
}
let V: View | null = null

export function mountApp(root: HTMLElement): void {
  initTooltips()
  initCombatKeys()
  setRoot(root)
  // the router can't see the combat View / coaching layer — register their teardown so a scene swap
  // stops the loop (drop V) and clears coaching, in the load-bearing order, before the DOM goes away.
  setSceneTeardown(() => {
    if (V) { cancelAnimationFrame(V.raf); V = null }
    coachTeardown()
  })
  mountDevToggle()
  document.body.classList.toggle('dev', isDev())
  document.body.classList.toggle('cvd', getPrefs().colorblind) // colour-blind palette override for card tints/glows
  onDevChange((on) => {
    document.body.classList.toggle('dev', on)
    // Static scenes re-mount so their dev panels / names re-resolve; combat repaints live every frame
    // (its dev row is CSS-gated), so re-mounting it — which would reset the live fight — is skipped.
    if (!V) remountScene()
  })
  recoverStrandedDelve() // U2: a delve killed by a process/refresh left committed consumables stranded — recover them
  // P1 (FABLE §11): a brand-new player (no heroes + tutorial never run) enters the fresh-save funnel —
  // create → guided tutorial → town-with-a-quest-cue — instead of landing cold on the 10-tile hub.
  if (bootRoute(loadRoster().length, getPrefs().tutorialSeen) === 'funnel') goScene((r) => characterSelectScene(r, { funnel: true }))
  else goScene(townScene)
}

/** U2 (FABLE §6): resolve a delve that was interrupted by a PWA process kill / accidental refresh. There
 *  is no mid-combat resume (CombatState isn't serialisable), and banking an interrupted run's found gold/
 *  gear would be exploitable (close-to-keep-loot) — so the run FORFEITS its spoils but RETURNS the
 *  committed satchel consumables to the vault (already paid for; not farmable). Overflow past a full vault
 *  auto-sells to gold, so nothing is silently lost (mirrors the loot triage). Runs once, on boot. */
function recoverStrandedDelve(): void {
  const run = loadDelve()
  clearDelve() // resolve it exactly once — whatever we do below, the stranded record is now spent
  if (!run || !run.bag.length) return
  let acc = loadBank()
  for (const id of run.bag) {
    if (!CONSUMABLES[id]) continue
    const r = addToStorage(acc, makeItem('consumable', id))
    acc = r.ok ? r.account : addGold(acc, sellValueOfConsumable(id)) // full vault → auto-sell rather than lose it
  }
  saveBank(acc)
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
/** Build the data-tip attribute pair for an item (escaping `"`/`&` so the HTML body — <br>/<span> —
 *  survives inside the attribute value). The shared tooltip renders the body via innerHTML. */
const tipEsc = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
const gearTip = (g: GearInstance): string => `data-tip-title="${tipEsc(gearTipTitle(g))}" data-tip="${tipEsc(gearTipBody(g))}"`
const consTip = (refId: string): string => `data-tip-title="${tipEsc(consumableTipTitle(refId))}" data-tip="${tipEsc(consumableTipBody(refId))}"`

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

/** Erase ALL persisted app data (roster / vault / dev flag / anything keyed `setcore.*`) → a pristine
 *  first-launch state. A testing affordance (fresh starts, beginner-balance retests). The caller reloads
 *  so no stale in-memory state survives (V, the live DELVE, dev cache). Prefix-scoped so it never touches
 *  unrelated origin storage. */
function wipeAllData(): void {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('setcore')) keys.push(k) }
  for (const k of keys) localStorage.removeItem(k)
}

/* The scene router + the shared tooltip live in ./router (goScene / sceneTimeout / initTooltips).
   app.ts registers the per-scene teardown (drop V + coachTeardown) in mountApp via setSceneTeardown. */

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
let DELVE: DelveRun | null = null

/** The active DAILY challenge context (set only while a daily run is live, like DELVE for delves). Its
 *  presence routes the run's capture to kind:'daily' with this UTC date, and keeps the ephemeral
 *  standardized daily hero out of the persisted roster. Null for every free practice/delve. */
let DAILY: { date: string } | null = null

/** The town MARKET + rare-vendor stocks (B4 buy-side). Module-held (NOT persisted) → regenerate on a
 *  fresh reload; cleared at delve start (restock after a run) + when a quality upgrade is bought. */
let MARKET: Array<{ label: string; items: GearInstance[] }> | null = null
let RARE: GearInstance[] | null = null
/** The live buy markup + vendor loot-quality boost, read off the account's Merchant House tiers. */
const acctMarkup = (): number => markupForTier(loadBank().upgrades.merchant)
const acctQualityBoost = (): number => qualityLvlBoost(loadBank().upgrades.quality)

/* ============================================================
   THE TOWN HUB — the home screen: a card grid of the town's locations (extendible + multi-layered;
   a sub-district like the Guild reuses `hubGrid` with its own entries). Each card = icon · name · blurb.
   Account-level stores need no hero; Gates of Town / Training Ground use the ACTIVE hero (set in the
   Barracks). Reaching the hub ends any run (DELVE = null).
   ============================================================ */
interface HubEntry { icon: string; name: string; desc: string; onClick?: () => void; badge?: string; dim?: boolean }
/** Render a grid of location cards into a host element (the main town + any sub-district share this).
 *  A `dim` entry (e.g. a not-yet-built location) is non-interactive (CSS pointer-events: none). */
function hubGrid(host: HTMLElement, entries: HubEntry[]): void {
  const grid = $(`<div class="hubgrid"></div>`)
  for (const e of entries) {
    const card = $(`<div class="hubcard${e.dim ? ' dim' : ''}"><div class="hc-ic">${e.icon}</div><div class="hc-n">${e.name}${e.badge ? ` <span class="hc-badge">${e.badge}</span>` : ''}</div><div class="hc-d">${e.desc}</div></div>`)
    if (e.onClick) card.addEventListener('click', e.onClick)
    grid.appendChild(card)
  }
  host.appendChild(grid)
}

function townScene(root: HTMLElement): void {
  DELVE = null; clearDelve() // any road back to town ends the run — drop any recovery checkpoint
  const roster = loadRoster()
  if (selectedCharId && !roster.some((c) => c.id === selectedCharId)) selectedCharId = null
  if (!selectedCharId) selectedCharId = roster[0]?.id ?? null
  const active = roster.find((c) => c.id === selectedCharId) ?? null
  const pending = roster.reduce((s, c) => s + pendingLevels(c), 0)

  const wrap = $(`<div class="wrap"></div>`)
  wrap.appendChild($(`<h1>set.core</h1>`))
  const heroLine = active
    ? `${classById(active.classId).icon} <b>${active.name}</b> · ${active.level >= LEVEL_CAP ? '★' : `Lv ${active.level}`} · ${active.hp}/${active.maxHp} HP`
    : '<span style="color:var(--ink-faint)">no active hero — visit the Barracks</span>'
  wrap.appendChild($(`<div class="sub" style="text-transform:none;letter-spacing:0">🏘 <b>Town</b> &nbsp;·&nbsp; <span class="vault">🪙 ${loadBank().gold} vault</span> &nbsp;·&nbsp; ${heroLine}</div>`))
  root.appendChild(wrap)

  // a card whose target needs an active hero → bounce to the Barracks if none is chosen
  const withHero = (go: (c: SavedChar) => void): (() => void) => () => { if (active) go(active); else goScene(characterSelectScene) }

  // P1 (FABLE §11): the one-time post-tutorial cue that routes a fresh player to their first real dungeon
  // — the missing hand-off from "tutorial done" to "now play the game". Dismisses on enter or ✕.
  const prefs = getPrefs()
  if (showQuestCue(prefs.tutorialSeen, prefs.questCueSeen, !!active)) {
    const cue = $(`<div class="questcue"><span class="qc-body">▶ <b>Next:</b> descend into the Goblin Warren — your first real dungeon.</span><button class="qc-go">Enter the Gates</button><button class="qc-x" title="Dismiss">✕</button></div>`)
    cue.querySelector('.qc-go')!.addEventListener('click', () => { setPref('questCueSeen', true); if (active) goScene((r) => dungeonSelectScene(r, active, 'real')) })
    cue.querySelector('.qc-x')!.addEventListener('click', () => { setPref('questCueSeen', true); goScene(townScene) })
    wrap.appendChild(cue)
  }

  hubGrid(wrap, [
    { icon: '🛡️', name: 'Barracks', desc: 'Your heroes — recruit, equip, rest, level up', onClick: () => goScene(characterSelectScene), badge: pending > 0 ? `⬆${pending}` : undefined },
    { icon: '🏰', name: 'Gates of Town', desc: 'Descend into the dungeons proper', onClick: withHero((c) => goScene((r) => dungeonSelectScene(r, c, 'real'))) },
    { icon: '🎯', name: 'Training Ground', desc: 'The practice dummy and guided lessons', onClick: withHero((c) => goScene((r) => dungeonSelectScene(r, c, 'teaching'))) },
    { icon: '🏦', name: 'Vault', desc: 'Your storage, gold, and slot upgrades', onClick: () => goScene(storageScene) },
    { icon: '🏪', name: 'Market', desc: 'Buy gear and potions', onClick: () => goScene(marketScene) },
    { icon: '🔨', name: 'Smithy', desc: 'Forge: upgrade rarity · transfer affixes', onClick: () => goScene(smithScene) },
    { icon: '🔮', name: 'Enchanter', desc: 'Imbue affixes · brew potions · scribe scrolls', onClick: () => goScene(enchanterScene) },
    { icon: '🏛️', name: 'Merchant House', desc: 'Upgrades: buy prices · loot quality · rare wares', onClick: () => goScene(merchantScene) },
    { icon: '⚜️', name: 'Guild District', desc: 'The class halls — spellbooks, trainers, bounties', onClick: () => goScene(guildDistrictScene) },
    { icon: '🌐', name: 'Embassy', desc: 'The foreign quarter — registry, records, the daily dispatch', onClick: () => goScene(embassyScene), badge: embassyBadge() },
    { icon: '⚙️', name: 'Settings', desc: 'Accessibility and options', onClick: () => goScene(settingsScene) },
  ])
}

/* A SUB-DISTRICT — proves the multi-layer hub pattern: a town-like screen reached from a town card,
   with its own entries. The Guild District holds the per-class HALLS; their shops (spellbooks/trainers/
   bounties) light up with the ability system (Phase 5), so the halls are placeholders for now. */
function guildDistrictScene(root: HTMLElement): void {
  const wrap = $(`<div class="wrap"></div>`)
  wrap.appendChild($(`<h1>set.core</h1>`))
  wrap.appendChild($(`<div class="sub" style="text-transform:none;letter-spacing:0">⚜️ <b>Guild District</b> &nbsp;·&nbsp; the class halls</div>`))
  root.appendChild(wrap)
  hubGrid(wrap, CLASSES.map((c) => ({
    icon: c.icon, name: `${c.name} Hall`, desc: 'Spellbooks · trainers · bounties — opens with the ability system', dim: true,
  })))
  const footer = $(`<div class="hubfoot"></div>`)
  const back = $<HTMLButtonElement>(`<button class="cta ghost">◂ Back to town</button>`)
  back.addEventListener('click', () => goScene(townScene))
  footer.appendChild(back)
  wrap.appendChild(footer)
}

/* Player-facing settings — accessibility today (the colour-blind unblock), the home for future options
   (round length / relaxed mode when the cautious stance lands). Prefs persist via ui/prefs. */
function settingsScene(root: HTMLElement): void {
  const wrap = $(`<div class="wrap"></div>`)
  wrap.appendChild($(`<h1>set.core</h1>`))
  wrap.appendChild($(`<div class="sub" style="text-transform:none;letter-spacing:0">⚙ <b>Settings</b></div>`))
  const panel = $(`<div class="panel"></div>`)
  panel.appendChild($(`<label>Accessibility</label>`))
  const cb = getPrefs().colorblind
  const row = $(`<label class="setrow"><input type="checkbox"${cb ? ' checked' : ''}><span><b>Colour-blind friendly cards</b><br><span class="setnote">Adds a shape pip to each card (● red · ▲ green · ■ blue) and switches to a colour-blind-safe palette, so colour isn't the only way to read a match.</span></span></label>`)
  row.querySelector('input')!.addEventListener('change', (e) => {
    setPref('colorblind', (e.target as HTMLInputElement).checked)
    document.body.classList.toggle('cvd', getPrefs().colorblind)
    goScene(settingsScene) // re-render the toggle state (live boards read the pref per paint)
  })
  panel.appendChild(row)
  wrap.appendChild(panel)
  root.appendChild(wrap)
  const footer = $(`<div class="hubfoot"></div>`)
  const back = $<HTMLButtonElement>(`<button class="cta ghost">◂ Back to town</button>`)
  back.addEventListener('click', () => goScene(townScene))
  footer.appendChild(back)
  wrap.appendChild(footer)
}

/* ===== The EMBASSY — the online quarter (the net/* layer is the seam; SERVICE.md). A nested hub like
   the Guild District: the Registry (identity · consent · connection), the Hall of Records (your bests +
   the upload queue), and STUBBED future quarters — the Daily Dispatch (opens with daily generation), the
   Consulate (friends · visiting other cities · shared shops), the Mercenary Post (hire heroes out for
   gold · the hero-of-the-day). All networking is gated + best-effort: offline, the quarter is a local-only
   archive (runs record to the outbox and sync on a connected, registered visit). ===== */

const CONSENT_BLURB =
  'Registering uploads your run records — anonymous: a random device fingerprint, your chosen handle, and gameplay stats — to the Embassy for balance analysis and leaderboards. Only your best per category is shown back. You can decline and play fully offline, or disable the Embassy any time.'

/** Town-tile badge: runs waiting to upload (only shows once the quarter has been used). */
function embassyBadge(): string | undefined {
  const n = pendingCount()
  return n > 0 ? `📤${n}` : undefined
}

function embassyStatusLine(v: EmbassyView): string {
  if (v.gate === 'modded') return 'closed — modded archive'
  const conn = v.gate === 'open' ? 'connected' : 'offline (local only)'
  const who = v.status === 'registered' && v.handle ? `📋 <b>${esc(v.handle)}</b>` : v.status === 'declined' ? 'not registered (declined)' : 'not registered'
  return `${who} &nbsp;·&nbsp; ${conn} &nbsp;·&nbsp; ${v.pendingUploads} queued`
}

function embassyFooter(wrap: HTMLElement, onBack: () => void, label: string): void {
  const footer = $(`<div class="hubfoot"></div>`)
  const back = $<HTMLButtonElement>(`<button class="cta ghost">${label}</button>`)
  back.addEventListener('click', onBack)
  footer.appendChild(back)
  wrap.appendChild(footer)
}

function embassyScene(root: HTMLElement): void {
  DELVE = null; clearDelve() // any road back through town ends the run — drop any recovery checkpoint
  void flushOutbox().catch(() => {}) // auto-sync on arrival (no-op offline / unregistered / modded)
  const v = embassyView(loadAccount(), getConfig(), pendingCount())
  const wrap = $(`<div class="wrap"></div>`)
  wrap.appendChild($(`<h1>set.core</h1>`))
  wrap.appendChild($(`<div class="sub" style="text-transform:none;letter-spacing:0">🌐 <b>Embassy</b> &nbsp;·&nbsp; ${embassyStatusLine(v)}</div>`))
  root.appendChild(wrap)

  if (v.gate === 'modded') {
    wrap.appendChild($(`<div class="panel"><div class="sheet-soon">🚫 The Embassy does not accept modded archives. Disable mods to use online features — your local play is unaffected.</div></div>`))
  } else {
    hubGrid(wrap, [
      { icon: '📋', name: 'Registry', desc: v.status === 'registered' ? `Registered as ${esc(v.handle)}` : 'Claim a handle · consent · connection', onClick: () => goScene(registryScene), badge: v.hasRecoveryToShow ? '🔑' : undefined },
      { icon: '📖', name: 'Hall of Records', desc: 'Your bests + the upload queue', onClick: () => goScene(hallOfRecordsScene), badge: v.pendingUploads > 0 ? `📤${v.pendingUploads}` : undefined },
      { icon: '📅', name: 'Daily Dispatch', desc: "The challenge of the day — one standardized fight, same for everyone", onClick: () => goScene(dailyDispatchScene) },
      { icon: '🤝', name: 'Consulate', desc: 'Friends · visiting other cities · shared shops (future)', dim: true },
      { icon: '🗡️', name: 'Mercenary Post', desc: 'Hire your heroes out for gold · the hero of the day (future)', dim: true },
    ])
  }
  embassyFooter(wrap, () => goScene(townScene), '◂ Back to town')
}

function registryScene(root: HTMLElement): void {
  const cfg = getConfig()
  const acc = loadAccount()
  const v = embassyView(acc, cfg, pendingCount())
  const wrap = $(`<div class="wrap"></div>`)
  wrap.appendChild($(`<h1>set.core</h1>`))
  wrap.appendChild($(`<div class="sub" style="text-transform:none;letter-spacing:0">📋 <b>Registry</b> &nbsp;·&nbsp; identity &amp; consent</div>`))
  root.appendChild(wrap)

  const note = $(`<div class="sm-note"></div>`)
  const setNote = (m: string): void => { note.textContent = m }

  // --- connection (the master enable + the server URL — official default or a self-host) ---
  const conn = $(`<div class="panel"></div>`)
  conn.appendChild($(`<div class="sm-hd">Connection</div>`))
  conn.appendChild($(`<div class="cc">This device: <b>#${v.fingerprintShort}</b> &nbsp;·&nbsp; ${v.gate === 'open' ? '🟢 connected' : '⚪ offline (local only)'}</div>`))
  const enableLabel = $(`<label style="display:flex;gap:8px;align-items:center;margin:8px 0"><input type="checkbox"${cfg.enabled ? ' checked' : ''}> Enable the Embassy (online features)</label>`)
  const enableBox = enableLabel.querySelector('input') as HTMLInputElement
  const urlIn = $<HTMLInputElement>(`<input class="nameinput" placeholder="Embassy server URL…" value="${esc(cfg.serverUrl)}">`)
  const saveBtn = $<HTMLButtonElement>(`<button class="cta">Save connection</button>`)
  saveBtn.addEventListener('click', () => { setEnabled(enableBox.checked); setServerUrl(urlIn.value.trim()); goScene(registryScene) })
  conn.append(enableLabel, urlIn, saveBtn)
  wrap.appendChild(conn)

  // --- identity ---
  const idp = $(`<div class="panel"></div>`)
  if (v.status === 'registered') {
    idp.appendChild($(`<div class="sm-hd">Registered</div>`))
    idp.appendChild($(`<div class="cc">Handle: <b>${esc(acc.handle)}</b></div>`))
    if (v.hasRecoveryToShow && acc.recoveryCode) {
      idp.appendChild($(`<div class="cc" style="margin-top:8px">🔑 Recovery code — <b>write this down</b>. It re-links your records on a new device:</div>`))
      idp.appendChild($(`<div style="font-family:ui-monospace,monospace;font-size:1.15em;padding:8px 10px;margin:6px 0;background:var(--panel-2,#0002);border-radius:6px"><b>${esc(acc.recoveryCode)}</b></div>`))
      const ack = $<HTMLButtonElement>(`<button class="cta">I've saved it</button>`)
      ack.addEventListener('click', () => { updateAccount(acknowledgeRecovery); goScene(registryScene) })
      idp.appendChild(ack)
    } else {
      idp.appendChild($(`<div class="cc" style="margin-top:8px">Moving devices? Enter a recovery code to re-link this device to your records:</div>`))
      const recIn = $<HTMLInputElement>(`<input class="nameinput" placeholder="Recovery code…">`)
      const recBtn = $<HTMLButtonElement>(`<button class="cta ghost">Re-link device</button>`)
      recBtn.addEventListener('click', () => void doRecover(recIn.value.trim(), setNote))
      idp.append(recIn, recBtn)
    }
  } else {
    idp.appendChild($(`<div class="sm-hd">Register</div>`))
    idp.appendChild($(`<div class="cc">${CONSENT_BLURB}</div>`))
    const nameIn = $<HTMLInputElement>(`<input class="nameinput" maxlength="18" placeholder="Choose a handle…">`)
    const regBtn = $<HTMLButtonElement>(`<button class="cta">Register &amp; consent</button>`)
    const declineBtn = $<HTMLButtonElement>(`<button class="cta ghost">Maybe later</button>`)
    if (!canRegister(v)) {
      regBtn.disabled = true
      regBtn.title = 'Enable the Embassy + set a server URL above first'
    }
    regBtn.addEventListener('click', () => void doRegister(nameIn.value.trim(), setNote))
    declineBtn.addEventListener('click', () => { updateAccount(markDeclined); goScene(registryScene) })
    idp.append(nameIn, regBtn, declineBtn)
  }
  wrap.appendChild(idp)
  wrap.appendChild(note)
  embassyFooter(wrap, () => goScene(embassyScene), '◂ Back to Embassy')
}

async function doRegister(handle: string, setNote: (m: string) => void): Promise<void> {
  if (handle.length < 2) { setNote('Pick a handle of at least 2 characters.'); return }
  setNote('Registering…')
  const tok = sceneToken() // U4: don't yank navigation if the user left the Registry while this settled
  try {
    const acc = loadAccount()
    const res = await embassyRegister({ fingerprint: acc.fingerprint, handle, consentVersion: CONSENT_VERSION, client: { rulesetVersion: CLIENT_RULESET_VERSION, contentVersion: CLIENT_CONTENT_VERSION } })
    updateAccount((a) => markRegistered(a, { handle: res.handle, token: res.token, recoveryCode: res.recoveryCode, at: Date.now() }))
    if (isCurrentScene(tok)) goScene(registryScene)
  } catch (e) {
    if (!isCurrentScene(tok)) return // the user navigated away — don't stomp on their new scene with a stale note
    setNote(e instanceof EmbassyHttpError ? (e.status === 409 ? 'That handle is taken — try another.' : `The Embassy refused the registration (${e.status}).`) : 'Could not reach the Embassy — check the connection above.')
  }
}

async function doRecover(code: string, setNote: (m: string) => void): Promise<void> {
  if (!code) { setNote('Enter your recovery code.'); return }
  setNote('Re-linking…')
  const tok = sceneToken() // U4: see doRegister
  try {
    const acc = loadAccount()
    const res = await embassyRecover({ recoveryCode: code, fingerprint: acc.fingerprint })
    updateAccount((a) => applyRecovery(a, res.token, res.handle))
    if (isCurrentScene(tok)) goScene(registryScene)
  } catch (e) {
    if (!isCurrentScene(tok)) return
    setNote(e instanceof EmbassyHttpError && e.status === 404 ? 'That recovery code was not recognized.' : 'Could not reach the Embassy.')
  }
}

let syncNote: string | null = null // N3: a one-shot Sync outcome message (re-link needed / retry / synced N)

function hallOfRecordsScene(root: HTMLElement): void {
  const v = embassyView(loadAccount(), getConfig(), pendingCount())
  const wrap = $(`<div class="wrap"></div>`)
  wrap.appendChild($(`<h1>set.core</h1>`))
  wrap.appendChild($(`<div class="sub" style="text-transform:none;letter-spacing:0">📖 <b>Hall of Records</b> &nbsp;·&nbsp; your bests &amp; the upload queue</div>`))
  root.appendChild(wrap)

  const q = $(`<div class="panel"></div>`)
  q.appendChild($(`<div class="sm-hd">Upload queue</div>`))
  q.appendChild($(`<div class="cc">${v.pendingUploads} run${v.pendingUploads === 1 ? '' : 's'} recorded locally${v.gate === 'open' && v.status === 'registered' ? '' : ' — they sync once you connect &amp; register'}.</div>`))
  if (v.gate === 'open' && v.status === 'registered') {
    const sync = $<HTMLButtonElement>(`<button class="cta">Sync now</button>`)
    sync.addEventListener('click', () => { const tok = sceneToken(); void flushOutbox().then((r) => {
      // N3: surface the outcome — a token rotated on another device (401/403) otherwise leaves records
      // stuck forever while the sync looks like it "worked".
      syncNote = r.error === 'auth'
        ? '⚠ This device could not authenticate — your records are safe locally. Re-link it at the Registry with your recovery code to resume syncing.'
        : r.error === 'network'
          ? '⚠ Could not reach the Embassy — your records are safe locally and will retry. If this keeps happening, check the server URL in Embassy → Registry.'
          : r.error === 'http'
            ? `⚠ The Embassy returned an error${r.status ? ` (${r.status})` : ''} — your records are safe locally and will retry on the next sync.`
            : r.accepted > 0 ? `✓ Synced ${r.accepted} run${r.accepted === 1 ? '' : 's'}.` : null
      // U4: only re-render if the user is still in the Hall — a settled sync must not yank a live daily fight.
      // syncNote is set regardless, so it surfaces next time they open the Hall.
      if (isCurrentScene(tok)) goScene(hallOfRecordsScene)
    }) })
    q.appendChild(sync)
  }
  if (syncNote) { q.appendChild($(`<div class="cc" style="margin-top:8px">${syncNote}</div>`)); syncNote = null }
  wrap.appendChild(q)

  const b = $(`<div class="panel"></div>`)
  b.appendChild($(`<div class="sm-hd">Your bests</div>`))
  if (!canViewRecords(v)) {
    b.appendChild($(`<div class="sheet-soon">Register at the Registry &amp; connect to view your records.</div>`))
  } else {
    const list = $(`<div class="baglist"><div class="cc">Loading…</div></div>`)
    b.appendChild(list)
    void loadBests(list)
  }
  wrap.appendChild(b)
  embassyFooter(wrap, () => goScene(embassyScene), '◂ Back to Embassy')
}

async function loadBests(list: HTMLElement): Promise<void> {
  try {
    const acc = loadAccount()
    if (!acc.token) return
    const res = await embassyBests(acc.token)
    if (res.bests.length === 0) { list.replaceChildren($(`<div class="sheet-soon">No records yet — play a few runs, then sync.</div>`)); return }
    list.replaceChildren(...res.bests.map((e) => $(`<div class="gp-row">${bestLine(e)}</div>`)))
  } catch {
    list.replaceChildren($(`<div class="sheet-soon">Could not reach the Embassy — check the server URL in Embassy → Registry.</div>`))
  }
}

function bestLine(e: BestEntry): string {
  // §U3 (FABLE §6): every field here is SERVER-controlled (the /me/bests response) → escape before innerHTML.
  const where = e.dailyDate ? `daily ${esc(e.dailyDate)}` : `${esc(e.classId)}${e.foeId ? ` vs ${esc(e.foeId)}` : ''}`
  return `<b>${esc(e.criterion)}</b> &nbsp;·&nbsp; ${where} &nbsp;·&nbsp; <b>${esc(e.value)}</b>`
}

/* ===== The DAILY DISPATCH — one standardized fight, the same for every player who shares the seed +
   versions. The server ships only a tiny seed (+ optional authored spec); net/daily.resolveDaily gates it
   on the version pin + local content, and net/daily-select derives the (class · dungeon) deterministically.
   The hero is EPHEMERAL + standardized (a fresh level-1 of the derived class, no gear) so the leaderboard
   measures play, not your roster's power. The board RNG is seeded from the daily seed, so everyone reads
   the identical board. A single fight: depth is always 1; the competition is fewest-terms / fastest-clear. ===== */

/** The local content registry as resolveDaily's predicate (an authored id the client lacks ⇒ unavailable). */
const DAILY_CONTENT = {
  hasClass: (id: string) => CLASSES.some((c) => c.id === id),
  hasFoe: (id: string) => !!GAMEDATA.creatures[id],
  hasDungeon: (id: string) => !!GAMEDATA.dungeons[id],
}

/** The daily-eligible candidate pools (stable order — part of the ruleset; reordering re-rolls history).
 *  Pure logic + the order-pin snapshot live in net/daily-select (D2). */
function dailyCandidates(): DailyCandidates {
  return dailyCandidatesFrom(GAMEDATA.dungeons, CLASSES.map((c) => c.id), DAILY_MAX_DIFFICULTY)
}

/** The foe for a derived setup: an authored pin, else the dungeon's weighted table drawn from the
 *  DOMAIN-SEPARATED foe sub-seed (N2). MUST mirror beginDaily's foe draw so the previewed foe IS fought. */
function dailyFoeId(setup: DailySetup, fixed: DailyFixed): string {
  if (fixed.foeId) return fixed.foeId
  return pickWeightedFoe(GAMEDATA.dungeons[setup.dungeonId].enemy_table, mulberry32(setup.foeSeed))
}

function dailyDispatchScene(root: HTMLElement): void {
  DELVE = null; clearDelve()
  DAILY = null
  const v = embassyView(loadAccount(), getConfig(), pendingCount())
  const wrap = $(`<div class="wrap"></div>`)
  wrap.appendChild($(`<h1>set.core</h1>`))
  wrap.appendChild($(`<div class="sub" style="text-transform:none;letter-spacing:0">📅 <b>Daily Dispatch</b> &nbsp;·&nbsp; the challenge of the day</div>`))
  root.appendChild(wrap)

  const panel = $(`<div class="panel"></div>`)
  if (v.gate !== 'open') {
    panel.appendChild($(`<div class="sheet-soon">Connect to the Embassy (enable it + set a server URL at the Registry) to fetch today's challenge. Your daily run still saves locally and uploads on a connected, registered visit.</div>`))
  } else {
    panel.appendChild($(`<div class="cc">Fetching today's dispatch…</div>`))
    void renderDaily(panel, v)
  }
  wrap.appendChild(panel)
  embassyFooter(wrap, () => goScene(embassyScene), '◂ Back to Embassy')
}

async function renderDaily(panel: HTMLElement, v: EmbassyView): Promise<void> {
  // gated 'open' upstream, so embassyDaily won't throw EmbassyUnavailableError — only a network/HTTP miss.
  const desc = await embassyDaily().then((d) => d, () => null)
  if (!desc) {
    panel.replaceChildren($(`<div class="sheet-soon">Could not reach the Embassy to fetch today's challenge.</div>`))
    return
  }

  const res: DailyResolution = resolveDaily(desc, { rulesetVersion: CLIENT_RULESET_VERSION, contentVersion: CLIENT_CONTENT_VERSION }, DAILY_CONTENT)
  if (res.status === 'unavailable') {
    const why = res.reason === 'version'
      ? "Your game version doesn't match today's challenge — update the game to play today's daily."
      : `Today's challenge needs content this client doesn't have${res.detail ? ` (${esc(res.detail)})` : ''}.` // §U3: res.detail is server-controlled
    panel.replaceChildren($(`<div class="sheet-soon">📅 ${esc(desc.date)} — ${why}</div>`))
    return
  }

  const fixed: DailyFixed = res.fixed
  let setup: DailySetup
  try {
    setup = deriveDailySetup(res.seed, fixed, dailyCandidates())
  } catch {
    panel.replaceChildren($(`<div class="sheet-soon">📅 ${esc(desc.date)} — today's challenge can't be built on this client (no eligible content).</div>`))
    return
  }

  const foeId = dailyFoeId(setup, fixed)
  const cls = classById(setup.classId)
  const dg = GAMEDATA.dungeons[setup.dungeonId]
  const foeName = GAMEDATA.creatures[foeId]?.name ?? foeId

  panel.replaceChildren(
    $(`<div class="sm-hd">${esc(desc.date)}${res.authored ? ' · authored' : ''}</div>`),
    $(`<div class="cc" style="margin-bottom:6px">Today everyone fights the same standardized challenge — a fresh level-1 hero, no gear, the same board.</div>`),
    $(`<div class="cc">${cls.icon} <b>${cls.name}</b> &nbsp;vs&nbsp; <b>${foeName}</b> &nbsp;·&nbsp; ${dg.name}</div>`),
    $(`<div class="cc" style="margin-top:6px">Scored on: <b>${esc(desc.criteria.join(', '))}</b></div>`), // §U3: server-controlled criteria
  )
  const note = v.status === 'registered'
    ? 'Your result uploads to your Embassy record when you sync — personal bests for now; cross-player boards are coming.'
    : 'Register at the Registry to save your result — until then it saves locally and uploads on your first connected, registered visit. (Personal bests for now; cross-player boards are coming.)'
  panel.appendChild($(`<div class="cc" style="margin-top:6px;opacity:.8">${note}</div>`))
  const play = $<HTMLButtonElement>(`<button class="cta" style="margin-top:10px">▶ Play today's daily</button>`)
  play.addEventListener('click', () => beginDaily(setup, fixed, desc.date))
  panel.appendChild(play)
}

/** Launch the daily as a single standardized fight: ephemeral level-1 hero of the derived class, the foe +
 *  board seeded from the shared daily seed (so every player's run is identical). Captured as kind:'daily'. */
function beginDaily(setup: DailySetup, fixed: DailyFixed, date: string): void {
  DELVE = null; clearDelve()
  DAILY = { date }
  const dg = GAMEDATA.dungeons[setup.dungeonId]
  if (!dg) { DAILY = null; goScene(townScene); return }
  // N2 — foe + variant roll off the foe sub-seed (decorrelated from dungeon/class); board off boardSeed.
  const rng: Rng = mulberry32(setup.foeSeed)
  const foeId = fixed.foeId ?? pickWeightedFoe(dg.enemy_table, rng)
  const foe = assembleFoe(foeId, dg, GAMEDATA, rng)
  if (!foe) { DAILY = null; goScene(townScene); return }
  const hero = makeChar('Daily Challenger', setup.classId, freshId())
  goScene((r) => startCombat(r, hero, setup.dungeonId, foe, null, hero.consumables, setup.boardSeed))
}

function characterSelectScene(root: HTMLElement, opts?: { funnel?: boolean }): void {
  DELVE = null; clearDelve() // any road back to town ends the run — drop any recovery checkpoint
  const wrap = $(`<div class="wrap"></div>`)
  wrap.appendChild($(`<h1>set.core</h1>`))
  wrap.appendChild($(`<div class="sub">town · choose your hero &nbsp;·&nbsp; <span class="vault" data-tip-title="The vault" data-tip="Your shared account gold — banked on any safe exit from a delve, dented by the death tithe. Spends at the Smithy; earned back by selling gear/consumables in Storage.">🪙 ${loadBank().gold} vault</span></div>`))
  const cols = $(`<div class="hub2"></div>`)
  const leftP = $(`<div class="panel"></div>`)
  const rightP = $(`<div class="panel"></div>`)
  cols.appendChild(leftP); cols.appendChild(rightP)
  wrap.appendChild(cols)
  const footer = $(`<div class="hubfoot"></div>`)
  wrap.appendChild(footer)
  wrap.appendChild($(`<div class="sub" style="margin-top:18px">Click cards to build a set (same-or-all-different on every trait). Set-mates flutter — the easier the set, the harder they flap; a rattling card completes one.</div>`))
  wrap.appendChild($(`<div class="sub" style="margin-top:10px;text-transform:none;letter-spacing:0;color:var(--ink-faint)">Archived single-file prototypes (the migration oracle): <a href="${import.meta.env.BASE_URL}prototype/" style="color:var(--phos);text-decoration:none">▸ /prototype/</a></div>`))
  if (isDev()) { // gated: one mis-tap+confirm from total loss — a dev-only testing affordance (FABLE §6, like grantTestGear)
    const wipeRow = $(`<div class="sub" style="margin-top:8px;text-transform:none;letter-spacing:0"></div>`)
    const wipeBtn = $<HTMLButtonElement>(`<button class="wipebtn" data-tip-title="Data Wipe" data-tip="Erase ALL saved data — every hero, the vault, gear, consumables, and settings — back to a pristine first-launch state. For testing fresh starts / beginner balance.">⟲ Data Wipe (reset everything)</button>`)
    wipeBtn.addEventListener('click', () => confirmModal({
      title: 'Wipe ALL data?', danger: true, confirmLabel: 'Wipe everything',
      body: 'This permanently erases <b>every hero</b>, your <b>vault gold</b>, all <b>gear &amp; consumables</b>, and settings — a clean first-launch state. This cannot be undone.',
      onConfirm: () => { wipeAllData(); location.reload() },
    }))
    wipeRow.appendChild(wipeBtn)
    wrap.appendChild(wipeRow)
  }
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
        slotEl.setAttribute('data-tip-title', gearTipTitle(g)); slotEl.setAttribute('data-tip', gearTipBody(g)) // full breakdown on hover
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
        const row = $(`<div class="gp-row" ${gearTip(it)}><span class="gs-ic r-${it.rarity}">${b.icon}</span><div class="gs-meta"><div class="gs-n r-${it.rarity}">${b.name}</div><div class="gs-a">${aff}</div></div><span class="gp-worth">🪙${sellValue(it)}</span><button class="gp-eq">equip</button></div>`)
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
      consRow.appendChild($(`<span class="cons-slot${cc.kind === 'scroll' ? ' scroll' : ''}" style="--cc:${tint}" ${consTip(id)}><span class="cons-ic">${cc.icon}</span></span>`))
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
        upsertChar(ch); selectedCharId = ch.id
        // P1: in the fresh-save funnel the first hero launches straight into the guided tutorial (mark it
        // seen so a bail-out never re-funnels), then lands in town with the quest cue. Otherwise stay put.
        if (opts?.funnel) { setPref('tutorialSeen', true); goScene((r) => begin(r, ch, 'tutorial', 'foe:training_dummy')); return }
        roster = loadRoster(); creating = false; render()
      })
      footer.appendChild(createBtn)
    } else {
      const back = $<HTMLButtonElement>(`<button class="cta bob">◂ Back to town</button>`)
      back.addEventListener('click', () => goScene(townScene))
      footer.appendChild(back)
    }
  }
  render()
}

/* ============================================================
   THE SMITHY (CRAWL §7 "The smith") — the crafting bench: upgrade rarity / enchant an open slot /
   reroll affixes / transfer an affix from a donor piece. Account-level (operates on the shared
   Storage gear); the engine math + pricing live in engine/smith (pure + tested). Ungated tier-1
   bench — every op available; the smithy-amenity tiers (cheapen/unlock) ride B4/B5.
   ============================================================ */
const RARITY_LABEL: Record<Rarity, string> = { grey: 'Grey', white: 'White', green: 'Green', blue: 'Blue', purple: 'Purple', orange: 'Orange' }

/** The crafting bench — shared by the SMITHY (forge: upgrade rarity · transfer affix) and the ENCHANTER
 *  (magic: enchant · reroll affixes), split by operation. The Enchanter additionally vends Potions and
 *  Scrolls (two tabs) — the magic shop. Gear ops reuse the pure engine/smith transforms. */
function craftScene(root: HTMLElement, kind: 'smith' | 'enchant'): void {
  const isEnch = kind === 'enchant'
  const benchOps: Set<SmithOp> = new Set(isEnch ? ['enchant', 'reroll'] : ['upgrade', 'transfer'])
  const wrap = $(`<div class="wrap"></div>`)
  wrap.appendChild($(`<h1>set.core</h1>`))
  const sub = $(`<div class="sub">town · ${isEnch ? 'the enchanter' : 'the smithy'} &nbsp;·&nbsp; <span class="vault">🪙 0 vault</span></div>`)
  wrap.appendChild(sub)
  const goldEl = sub.querySelector('.vault')!
  const body = $(`<div></div>`) // holds the bench (two columns) or a vendor list, per tab
  wrap.appendChild(body)
  const footer = $(`<div class="hubfoot"></div>`)
  wrap.appendChild(footer)
  root.appendChild(wrap)

  let selUid: string | null = null
  let mode: 'none' | 'enchant' | 'transfer' = 'none'
  let tab: 'bench' | 'potions' | 'scrolls' = 'bench' // the Enchanter's tab bar; the Smith stays on 'bench'
  let note = ''

  const gearList = (): GearInstance[] => loadBank().storage.filter((i): i is GearInstance => i.kind === 'gear' && !!gearBase(i.refId))
  const selected = (): GearInstance | undefined => gearList().find((g) => g.uid === selUid)

  const applySingle = (op: SmithOp, transform: (g: GearInstance) => GearInstance): void => {
    const g = selected(); if (!g) return
    const { bank, ok } = spendGold(loadBank(), smithCost(op, g))
    if (!ok) { note = '✗ Not enough gold.'; render(); return }
    saveBank(updateStorageItem(bank, transform(g)))
    mode = 'none'; note = '✓ Done.'; render()
  }
  const doTransfer = (src: GearInstance, dst: GearInstance, affixId: string): void => {
    const res = transferAffix(src, dst, affixId)
    if (!res) { note = '✗ That affix can’t go there.'; render(); return }
    const { bank, ok } = spendGold(loadBank(), smithCost('transfer', dst, dst))
    if (!ok) { note = '✗ Not enough gold.'; render(); return }
    saveBank(updateStorageItem(updateStorageItem(bank, res.src), res.dst))
    mode = 'none'; note = '✓ Affix transferred.'; render()
  }
  const buyCons = (refId: string): void => {
    if (storageFull(loadBank())) { note = '✗ Vault full — sell or stow something first.'; render(); return }
    const { bank, ok } = spendGold(loadBank(), buyPriceOfConsumable(refId, acctMarkup()))
    if (!ok) { note = '✗ Not enough gold.'; render(); return }
    saveBank(addToStorage(bank, makeItem('consumable', refId)).account)
    note = `✓ Bought ${CONSUMABLES[refId]?.name ?? 'item'}.`; render()
  }
  const affixLine = (a: Affix): string => `<span class="sm-affix">✦ ${affixShort(a)}</span>`

  const renderBench = (host: HTMLElement, g: GearInstance): void => {
    const base = gearBase(g.refId)!
    const open = openSlots(g)
    host.appendChild($(`<div class="sm-hd" ${gearTip(g)}><span class="gs-ic r-${g.rarity}">${base.icon}</span><div class="gs-meta"><div class="gs-n r-${g.rarity}">${base.name}</div><div class="gs-a">${RARITY_LABEL[g.rarity]} · ${SLOT_LABEL[base.slot]} · tier ${g.lootTier}</div></div></div>`))
    const affixWrap = $(`<div class="sm-affixes"></div>`)
    if (g.affixes.length) for (const a of g.affixes) affixWrap.appendChild($(`<div class="sm-affixrow">${affixLine(a)}</div>`))
    else affixWrap.appendChild($(`<div class="sm-affixrow dim">no affixes${open > 0 ? ` · ${open} open slot${open > 1 ? 's' : ''}` : ''}</div>`))
    if (g.affixes.length && open > 0) affixWrap.appendChild($(`<div class="sm-affixrow dim">${open} open slot${open > 1 ? 's' : ''}</div>`))
    host.appendChild(affixWrap)

    const ops = $(`<div class="sm-ops"></div>`)
    const mkOp = (label: string, cost: number, enabled: boolean, tip: string, onClick: () => void): void => {
      const b = $<HTMLButtonElement>(`<button class="sm-op" data-tip="${tip}" ${enabled ? '' : 'disabled'}><span class="sm-opl">${label}</span><span class="sm-opc">🪙 ${cost}</span></button>`)
      if (enabled) b.addEventListener('click', onClick)
      ops.appendChild(b)
    }
    const nr = nextRarity(g.rarity)
    if (benchOps.has('upgrade')) mkOp(`⬆ Upgrade${nr ? ` → ${RARITY_LABEL[nr]}` : ' (max)'}`, smithCost('upgrade', g), canUpgrade(g), 'Raise rarity one step: bigger base rider + a new affix slot. Affixes are kept.',
      () => applySingle('upgrade', upgradeRarity))
    if (benchOps.has('enchant')) mkOp(`✦ Enchant`, smithCost('enchant', g), canEnchant(g), 'Set one chosen affix into an open slot.',
      () => { mode = mode === 'enchant' ? 'none' : 'enchant'; note = ''; render() })
    if (benchOps.has('reroll')) mkOp(`🎲 Reroll affixes`, smithCost('reroll', g), canReroll(g), 'Gamble the whole affix set — count and affixes re-roll.',
      () => confirmModal({ title: 'Reroll affixes?', body: 'This discards the current affixes for a fresh random set.', confirmLabel: 'Reroll',
        onConfirm: () => applySingle('reroll', (x) => rerollAffixes(x, systemRng)) }))
    if (benchOps.has('transfer')) mkOp(`⇄ Transfer in`, smithCost('transfer', g, g), open > 0, 'Pull an affix from another Storage piece into an open slot (premium).',
      () => { mode = mode === 'transfer' ? 'none' : 'transfer'; note = ''; render() })
    host.appendChild(ops)

    if (mode === 'enchant') {
      const pick = $(`<div class="sm-picker"></div>`)
      pick.appendChild($(`<div class="sm-pickhd">Choose an affix to set:</div>`))
      const opts = enchantOptions(g)
      if (!opts.length) pick.appendChild($(`<div class="sm-affixrow dim">no eligible affixes (full or none fit)</div>`))
      for (const d of opts) {
        const row = $(`<div class="gp-row"><div class="gs-meta"><div class="gs-n">${displayName(d.sys)}</div><div class="gs-a">${d.note}</div></div><button class="gp-eq">set</button></div>`)
        row.querySelector('.gp-eq')!.addEventListener('click', () => applySingle('enchant', (x) => enchant(x, d.sys)))
        pick.appendChild(row)
      }
      host.appendChild(pick)
    }
    if (mode === 'transfer') {
      const pick = $(`<div class="sm-picker"></div>`)
      pick.appendChild($(`<div class="sm-pickhd">Transfer an affix from:</div>`))
      let any = false
      for (const donor of gearList()) {
        if (donor.uid === g.uid) continue
        const movable = donor.affixes.filter((a) => canReceiveAffix(g, a))
        if (!movable.length) continue
        any = true
        const db = gearBase(donor.refId)!
        pick.appendChild($(`<div class="sm-donorhd"><span class="gs-ic r-${donor.rarity}">${db.icon}</span> <span class="r-${donor.rarity}">${db.name}</span> <span class="dim">${RARITY_LABEL[donor.rarity]}</span></div>`))
        for (const a of movable) {
          const row = $(`<div class="gp-row"><div class="gs-meta"><div class="gs-n">${affixShort(a)}</div></div><button class="gp-eq">take</button></div>`)
          row.querySelector('.gp-eq')!.addEventListener('click', () => doTransfer(donor, g, a.id))
          pick.appendChild(row)
        }
      }
      if (!any) pick.appendChild($(`<div class="sm-affixrow dim">no donor piece has an affix that fits an open slot here</div>`))
      host.appendChild(pick)
    }
  }

  /** The bench view: the Storage gear list (left) + the selected piece's bench (right). */
  const renderBenchView = (): void => {
    const cols = $(`<div class="hub2"></div>`)
    const leftP = $(`<div class="panel"></div>`)
    const rightP = $(`<div class="panel"></div>`)
    cols.appendChild(leftP); cols.appendChild(rightP)
    body.appendChild(cols)
    const list = gearList()
    if (selUid && !list.some((g) => g.uid === selUid)) selUid = null
    leftP.appendChild($(`<label>Storage gear (${list.length})</label>`))
    if (!list.length) leftP.appendChild($(`<div class="sheet-soon">No gear in Storage. Loot some in a delve, or grant test gear from a hero sheet.</div>`))
    const gl = $(`<div class="roster"></div>`)
    for (const g of list) {
      const base = gearBase(g.refId)!
      const aff = g.affixes.map((a) => displayName(a.label)).join(' · ') || (openSlots(g) > 0 ? `${openSlots(g)} open` : 'no affixes')
      const card = $(`<div class="charcard${g.uid === selUid ? ' sel' : ''}" ${gearTip(g)}><span class="gs-ic r-${g.rarity}">${base.icon}</span><div class="cmeta"><div class="cn r-${g.rarity}">${base.name}</div><div class="cc">${RARITY_LABEL[g.rarity]} · ${aff}</div></div></div>`)
      card.addEventListener('click', () => { selUid = g.uid; mode = 'none'; note = ''; render() })
      gl.appendChild(card)
    }
    leftP.appendChild(gl)
    const g = selected()
    if (g) renderBench(rightP, g)
    else rightP.appendChild($(`<div class="sheet-soon">Select a piece of gear to work it at the bench.</div>`))
    if (note) rightP.appendChild($(`<div class="sm-note">${note}</div>`))
  }

  /** A consumable vendor list (the Enchanter's Potions / Scrolls tabs), buy at 150%. */
  const renderVendor = (sort: 'potion' | 'scroll'): void => {
    const panel = $(`<div class="panel"></div>`)
    body.appendChild(panel)
    const acc = loadBank()
    const ids = Object.keys(CONSUMABLES).filter((id) => CONSUMABLES[id].kind === sort).sort((a, b) => consumableValue(b) - consumableValue(a))
    const list = $(`<div class="baglist"></div>`)
    for (const refId of ids) {
      const c = CONSUMABLES[refId]
      const tint = c.color != null ? `var(--c${c.color})` : 'var(--line2)'
      const price = buyPriceOfConsumable(refId, acctMarkup())
      const row = $(`<div class="gp-row" ${consTip(refId)}><span class="cons-slot${c.kind === 'scroll' ? ' scroll' : ''}" style="--cc:${tint}"><span class="cons-ic">${c.icon}</span></span><div class="gs-meta"><div class="gs-n">${c.name}</div><div class="gs-a">${c.desc}</div></div><button class="buybtn${acc.gold < price ? ' cant' : ''}">buy 🪙${price}</button></div>`)
      row.querySelector('.buybtn')!.addEventListener('click', () => buyCons(refId))
      list.appendChild(row)
    }
    panel.appendChild(list)
    if (note) panel.appendChild($(`<div class="sm-note">${note}</div>`))
  }

  const render = (): void => {
    body.innerHTML = ''; footer.innerHTML = ''
    goldEl.textContent = `🪙 ${loadBank().gold} vault`
    if (isEnch) {
      const tabs = $(`<div class="tabs"></div>`)
      const mkTab = (id: typeof tab, label: string): void => {
        const t = $<HTMLButtonElement>(`<button class="tab${tab === id ? ' on' : ''}">${label}</button>`)
        t.addEventListener('click', () => { tab = id; note = ''; render() })
        tabs.appendChild(t)
      }
      mkTab('bench', 'Enchanting'); mkTab('potions', 'Potions'); mkTab('scrolls', 'Scrolls')
      body.appendChild(tabs)
    }
    if (tab === 'bench') renderBenchView()
    else renderVendor(tab === 'scrolls' ? 'scroll' : 'potion')

    const back = $<HTMLButtonElement>(`<button class="cta ghost">◂ Back to town</button>`)
    back.addEventListener('click', () => goScene(townScene))
    footer.appendChild(back)
  }
  render()
}
const smithScene = (root: HTMLElement): void => craftScene(root, 'smith')
const enchanterScene = (root: HTMLElement): void => craftScene(root, 'enchant')

/* ============================================================
   THE STORAGE / BAG screen (CRAWL §3 town economy) — the shared account vault, browsable: GEAR and
   CONSUMABLES tabs, each item sellable for its sell-back price (engine/value). Consumables stack by
   refId with a count. Account-level (the whole roster shares the bag). The loadout draws from here;
   the loot scene banks into here.
   ============================================================ */
function storageScene(root: HTMLElement): void {
  const wrap = $(`<div class="wrap"></div>`)
  wrap.appendChild($(`<h1>set.core</h1>`))
  const sub = $(`<div class="sub">town · the vault &nbsp;·&nbsp; <span class="vault">🪙 0 vault</span></div>`)
  wrap.appendChild(sub)
  const goldEl = sub.querySelector('.vault')!
  const panel = $(`<div class="panel"></div>`)
  wrap.appendChild(panel)
  const footer = $(`<div class="hubfoot"></div>`)
  wrap.appendChild(footer)
  root.appendChild(wrap)

  let tab: 'gear' | 'cons' = 'gear'
  let note = ''

  const sellByUid = (uid: string): void => {
    let acc = loadBank()
    const it = acc.storage.find((i) => i.uid === uid)
    if (!it) return
    acc = addGold(removeFromStorage(acc, uid), sellValue(it))
    saveBank(acc); render()
  }
  const buySlot = (): void => {
    const acc = loadBank()
    if (acc.storageCap >= STORAGE_SLOT_MAX) { note = '✗ Storage is at its maximum.'; render(); return }
    const { bank, ok } = spendGold(acc, slotUpgradeCost(acc.storageCap))
    if (!ok) { note = '✗ Not enough gold.'; render(); return }
    saveBank(expandStorage(bank, STORAGE_SLOT_STEP)); note = `✓ Storage expanded by ${STORAGE_SLOT_STEP} slots.`; render()
  }

  const render = (): void => {
    const acc = loadBank()
    goldEl.textContent = `🪙 ${acc.gold} vault`
    panel.innerHTML = ''; footer.innerHTML = ''
    const gear = acc.storage.filter((i): i is GearInstance => i.kind === 'gear' && !!gearBase(i.refId))
    const cons = acc.storage.filter((i) => i.kind === 'consumable' && !!CONSUMABLES[i.refId])

    // capacity + the slot upgrade (the inventory gold sink)
    const capRow = $(`<div class="cap-row"><span class="sub" style="margin:0">Vault — ${storageCount(acc)} / ${acc.storageCap} slots used</span></div>`)
    if (acc.storageCap < STORAGE_SLOT_MAX) {
      const cost = slotUpgradeCost(acc.storageCap)
      const up = $<HTMLButtonElement>(`<button class="buybtn${acc.gold < cost ? ' cant' : ''}" data-tip-title="Expand Storage" data-tip="Add ${STORAGE_SLOT_STEP} Storage slots. Cost = the square of the new total — the steady gold sink, up to ${STORAGE_SLOT_MAX}.">+${STORAGE_SLOT_STEP} slots · 🪙${cost}</button>`)
      up.addEventListener('click', buySlot)
      capRow.appendChild(up)
    } else capRow.appendChild($(`<span class="sub" style="margin:0;color:var(--ink-faint)">max size</span>`))
    panel.appendChild(capRow)
    if (note) { panel.appendChild($(`<div class="sm-note">${note}</div>`)); note = '' }
    const tabs = $(`<div class="tabs"></div>`)
    const mkTab = (id: 'gear' | 'cons', label: string): void => {
      const t = $<HTMLButtonElement>(`<button class="tab${tab === id ? ' on' : ''}">${label}</button>`)
      t.addEventListener('click', () => { tab = id; render() })
      tabs.appendChild(t)
    }
    mkTab('gear', `Gear (${gear.length})`)
    mkTab('cons', `Consumables (${cons.length})`)
    panel.appendChild(tabs)

    const list = $(`<div class="baglist"></div>`)
    if (tab === 'gear') {
      if (!gear.length) list.appendChild($(`<div class="sheet-soon">No gear stowed. Loot some in a delve.</div>`))
      for (const g of gear) {
        const base = gearBase(g.refId)!
        const aff = g.affixes.length ? g.affixes.map(affixShort).join(' · ') : '—'
        const row = $(`<div class="gp-row" ${gearTip(g)}><span class="gs-ic r-${g.rarity}">${base.icon}</span><div class="gs-meta"><div class="gs-n r-${g.rarity}">${base.name}</div><div class="gs-a">${RARITY_LABEL[g.rarity]} · ${aff}</div></div><button class="sellbtn">sell 🪙${sellValue(g)}</button></div>`)
        row.querySelector('.sellbtn')!.addEventListener('click', () => sellByUid(g.uid))
        list.appendChild(row)
      }
    } else {
      if (!cons.length) list.appendChild($(`<div class="sheet-soon">No consumables stowed.</div>`))
      // stack by refId (consumables are fungible) → one row with a count + a sell-one button
      const counts = new Map<string, string[]>() // refId → uids
      for (const c of cons) { const a = counts.get(c.refId) ?? []; a.push(c.uid); counts.set(c.refId, a) }
      for (const [refId, uids] of counts) {
        const c = CONSUMABLES[refId]
        const tint = c.color != null ? `var(--c${c.color})` : 'var(--line2)'
        const n = uids.length
        const row = $(`<div class="gp-row" ${consTip(refId)}><span class="cons-slot${c.kind === 'scroll' ? ' scroll' : ''}" style="--cc:${tint}"><span class="cons-ic">${c.icon}</span></span><div class="gs-meta"><div class="gs-n">${c.name}${n > 1 ? ` <span class="bag-x">×${n}</span>` : ''}</div><div class="gs-a">${c.desc}</div></div><button class="sellbtn">sell 🪙${sellValueOfConsumable(refId)}</button></div>`)
        row.querySelector('.sellbtn')!.addEventListener('click', () => sellByUid(uids[0]))
        list.appendChild(row)
      }
    }
    panel.appendChild(list)

    const back = $<HTMLButtonElement>(`<button class="cta ghost">◂ Back to town</button>`)
    back.addEventListener('click', () => goScene(townScene))
    footer.appendChild(back)
  }
  render()
}

/* ============================================================
   THE MARKET (B4 buy-side) — one Market scene, two tabs. GEAR: a randomized vendor stock (the loot
   roller, rarity-banded by the player's highest character level), ~10 per slot group, sorted by value;
   regenerates on reload + after each delve. CONSUMABLES: the full catalog. Buy = 150% of value
   (engine/value). The sell-side lives in Storage; this is its mirror.
   ============================================================ */
function highestCharLevel(): number {
  return Math.max(1, ...loadRoster().map((c) => c.level), 1)
}
function marketStock(): Array<{ label: string; items: GearInstance[] }> {
  if (!MARKET) MARKET = rollMarketStock(highestCharLevel(), systemRng, acctQualityBoost())
  return MARKET
}
function rareStock(): GearInstance[] {
  if (!RARE) RARE = rollRareStock(highestCharLevel(), systemRng, acctQualityBoost())
  return RARE
}

function marketScene(root: HTMLElement): void {
  const wrap = $(`<div class="wrap"></div>`)
  wrap.appendChild($(`<h1>set.core</h1>`))
  const sub = $(`<div class="sub">town · market &nbsp;·&nbsp; <span class="vault">🪙 0 vault</span></div>`)
  wrap.appendChild(sub)
  const goldEl = sub.querySelector('.vault')!
  const panel = $(`<div class="panel"></div>`)
  wrap.appendChild(panel)
  const footer = $(`<div class="hubfoot"></div>`)
  wrap.appendChild(footer)
  root.appendChild(wrap)

  let tab = 'Weapons' // a slot-group label or 'Consumables' — one tab per item type
  let note = ''

  /** Buy a gear piece: charge the markup, stow it, remove it from the vendor stock. */
  const buyGear = (g: GearInstance): void => {
    if (storageFull(loadBank())) { note = '✗ Storage full — sell or stow something first.'; render(); return }
    const { bank, ok } = spendGold(loadBank(), buyPrice(g, acctMarkup()))
    if (!ok) { note = '✗ Not enough gold.'; render(); return }
    saveBank(addToStorage(bank, g).account)
    for (const grp of MARKET ?? []) { const i = grp.items.findIndex((x) => x.uid === g.uid); if (i >= 0) grp.items.splice(i, 1) }
    note = `✓ Bought ${gearBase(g.refId)?.name ?? 'gear'}.`; render()
  }
  const buyCons = (refId: string): void => {
    if (storageFull(loadBank())) { note = '✗ Storage full — sell or stow something first.'; render(); return }
    const { bank, ok } = spendGold(loadBank(), buyPriceOfConsumable(refId, acctMarkup()))
    if (!ok) { note = '✗ Not enough gold.'; render(); return }
    saveBank(addToStorage(bank, makeItem('consumable', refId)).account)
    note = `✓ Bought ${CONSUMABLES[refId]?.name ?? 'item'}.`; render()
  }

  const render = (): void => {
    const acc = loadBank()
    goldEl.textContent = `🪙 ${acc.gold} vault`
    panel.innerHTML = ''; footer.innerHTML = ''
    panel.appendChild($(`<div class="sub" style="margin:0 0 10px">Buy at 150% of value · stock for a level-${highestCharLevel()} hero · vault has ${storageRoom(acc)} free slot(s)</div>`))
    const stock = marketStock()
    const tabs = $(`<div class="tabs"></div>`)
    const mkTab = (id: string, label: string): void => {
      const t = $<HTMLButtonElement>(`<button class="tab${tab === id ? ' on' : ''}">${label}</button>`)
      t.addEventListener('click', () => { tab = id; note = ''; render() })
      tabs.appendChild(t)
    }
    for (const grp of stock) mkTab(grp.label, `${grp.label} (${grp.items.length})`)
    mkTab('Consumables', 'Consumables')
    panel.appendChild(tabs)

    const list = $(`<div class="baglist"></div>`)
    if (tab === 'Consumables') {
      const ids = Object.keys(CONSUMABLES).filter((id) => CONSUMABLES[id].kind === 'potion').sort((a, b) => consumableValue(b) - consumableValue(a)) // potions only — no scrolls
      for (const refId of ids) {
        const c = CONSUMABLES[refId]
        const tint = c.color != null ? `var(--c${c.color})` : 'var(--line2)'
        const price = buyPriceOfConsumable(refId, acctMarkup())
        const row = $(`<div class="gp-row" ${consTip(refId)}><span class="cons-slot" style="--cc:${tint}"><span class="cons-ic">${c.icon}</span></span><div class="gs-meta"><div class="gs-n">${c.name}</div><div class="gs-a">${c.desc}</div></div><button class="buybtn${acc.gold < price ? ' cant' : ''}">buy 🪙${price}</button></div>`)
        row.querySelector('.buybtn')!.addEventListener('click', () => buyCons(refId))
        list.appendChild(row)
      }
    } else {
      const items = stock.find((g) => g.label === tab)?.items ?? []
      if (!items.length) list.appendChild($(`<div class="sheet-soon">Sold out — the smith restocks after your next delve.</div>`))
      for (const g of items) {
        const base = gearBase(g.refId)!
        const aff = g.affixes.length ? g.affixes.map((a) => displayName(a.label)).join(' · ') : '—'
        const price = buyPrice(g, acctMarkup())
        const row = $(`<div class="gp-row" ${gearTip(g)}><span class="gs-ic r-${g.rarity}">${base.icon}</span><div class="gs-meta"><div class="gs-n r-${g.rarity}">${base.name}</div><div class="gs-a">${RARITY_LABEL[g.rarity]} · ${aff}</div></div><button class="buybtn${acc.gold < price ? ' cant' : ''}">buy 🪙${price}</button></div>`)
        row.querySelector('.buybtn')!.addEventListener('click', () => buyGear(g))
        list.appendChild(row)
      }
    }
    panel.appendChild(list)
    if (note) panel.appendChild($(`<div class="sm-note">${note}</div>`))

    const back = $<HTMLButtonElement>(`<button class="cta ghost">◂ Back to town</button>`)
    back.addEventListener('click', () => goScene(townScene))
    footer.appendChild(back)
  }
  render()
}

/* ============================================================
   THE MERCHANT HOUSE (B4) — the upgrade + rare-wares shop. UPGRADES: two gold-bought tracks (Merchant
   standing → lower buy markup; Town loot quality → better TOWN-vendor rarity band). RARE WARES: a
   10-slot vendor of epic/legendary gear at 2× value (high quality, high price; spellbooks slot in here
   at Phase 5). Account-level; the tiers persist on the Account.
   ============================================================ */
function merchantScene(root: HTMLElement): void {
  const wrap = $(`<div class="wrap"></div>`)
  wrap.appendChild($(`<h1>set.core</h1>`))
  const sub = $(`<div class="sub">town · the merchant house &nbsp;·&nbsp; <span class="vault">🪙 0 vault</span></div>`)
  wrap.appendChild(sub)
  const goldEl = sub.querySelector('.vault')!
  const panel = $(`<div class="panel"></div>`)
  wrap.appendChild(panel)
  const footer = $(`<div class="hubfoot"></div>`)
  wrap.appendChild(footer)
  root.appendChild(wrap)

  let tab: 'upgrades' | 'rare' = 'upgrades'
  let note = ''

  const buyUpgrade = (track: 'merchant' | 'quality', costs: number[]): void => {
    const acc = loadBank()
    const cur = acc.upgrades[track]
    if (cur + 1 >= costs.length) { note = 'Already at the top tier.'; render(); return }
    const { bank, ok } = spendGold(acc, costs[cur + 1])
    if (!ok) { note = '✗ Not enough gold.'; render(); return }
    saveBank({ ...bank, upgrades: { ...bank.upgrades, [track]: cur + 1 } })
    if (track === 'quality') { MARKET = null; RARE = null } // restock so the better band shows now
    note = '✓ Upgraded.'; render()
  }
  const buyRare = (g: GearInstance): void => {
    if (storageFull(loadBank())) { note = '✗ Vault full — sell or stow something first.'; render(); return }
    const { bank, ok } = spendGold(loadBank(), buyPrice(g, RARE_MARKUP))
    if (!ok) { note = '✗ Not enough gold.'; render(); return }
    saveBank(addToStorage(bank, g).account)
    const i = (RARE ?? []).findIndex((x) => x.uid === g.uid); if (i >= 0 && RARE) RARE.splice(i, 1)
    note = `✓ Bought ${gearBase(g.refId)?.name ?? 'gear'}.`; render()
  }

  const trackCard = (host: HTMLElement, opts: { name: string; track: 'merchant' | 'quality'; costs: number[]; now: string; next?: string }): void => {
    const acc = loadBank()
    const cur = acc.upgrades[opts.track]
    const maxed = cur + 1 >= opts.costs.length
    const card = $(`<div class="mh-track"><div class="mh-th"><b>${opts.name}</b> <span class="tt-dim">· tier ${cur}/${opts.costs.length - 1}</span></div><div class="gs-a">${opts.now}</div></div>`)
    if (!maxed) {
      const cost = opts.costs[cur + 1]
      const row = $(`<div class="mh-next"><span class="gs-a">next: ${opts.next}</span><button class="buybtn${acc.gold < cost ? ' cant' : ''}">upgrade 🪙${cost}</button></div>`)
      row.querySelector('.buybtn')!.addEventListener('click', () => buyUpgrade(opts.track, opts.costs))
      card.appendChild(row)
    } else card.appendChild($(`<div class="gs-a" style="color:var(--ink-faint)">at the top tier</div>`))
    host.appendChild(card)
  }

  const render = (): void => {
    const acc = loadBank()
    goldEl.textContent = `🪙 ${acc.gold} vault`
    panel.innerHTML = ''; footer.innerHTML = ''
    const tabs = $(`<div class="tabs"></div>`)
    const mkTab = (id: typeof tab, label: string): void => {
      const t = $<HTMLButtonElement>(`<button class="tab${tab === id ? ' on' : ''}">${label}</button>`)
      t.addEventListener('click', () => { tab = id; note = ''; render() })
      tabs.appendChild(t)
    }
    mkTab('upgrades', 'Upgrades'); mkTab('rare', 'Rare Wares')
    panel.appendChild(tabs)

    if (tab === 'upgrades') {
      const mTier = acc.upgrades.merchant, qTier = acc.upgrades.quality
      trackCard(panel, { name: 'Merchant Standing', track: 'merchant', costs: MERCHANT_TIER_COST,
        now: `Buy prices at <b>${Math.round(MERCHANT_MARKUPS[mTier] * 100)}%</b> of value (all town vendors)`,
        next: `${Math.round((MERCHANT_MARKUPS[mTier + 1] ?? 1) * 100)}% buy prices` })
      trackCard(panel, { name: 'Town Loot Quality', track: 'quality', costs: QUALITY_TIER_COST,
        now: qTier > 0 ? `Vendor stock rolls <b>+${qualityLvlBoost(qTier)}</b> effective levels (better rarity)` : 'Vendor stock at the base rarity band',
        next: `+${qualityLvlBoost(qTier + 1)} effective levels` })
    } else {
      panel.appendChild($(`<div class="sub" style="margin:0 0 10px">Rare wares · epic & legendary gear at ${RARE_MARKUP}× value · restocks after a delve</div>`))
      const list = $(`<div class="baglist"></div>`)
      const stock = rareStock()
      if (!stock.length) list.appendChild($(`<div class="sheet-soon">Sold out — fresh rare wares after your next delve.</div>`))
      for (const g of stock) {
        const base = gearBase(g.refId)!
        const aff = g.affixes.length ? g.affixes.map((a) => displayName(a.label)).join(' · ') : '—'
        const price = buyPrice(g, RARE_MARKUP)
        const row = $(`<div class="gp-row" ${gearTip(g)}><span class="gs-ic r-${g.rarity}">${base.icon}</span><div class="gs-meta"><div class="gs-n r-${g.rarity}">${base.name}</div><div class="gs-a">${RARITY_LABEL[g.rarity]} · ${aff}</div></div><button class="buybtn${acc.gold < price ? ' cant' : ''}">buy 🪙${price}</button></div>`)
        row.querySelector('.buybtn')!.addEventListener('click', () => buyRare(g))
        list.appendChild(row)
      }
      panel.appendChild(list)
    }
    if (note) panel.appendChild($(`<div class="sm-note">${note}</div>`))

    const back = $<HTMLButtonElement>(`<button class="cta ghost">◂ Back to town</button>`)
    back.addEventListener('click', () => goScene(townScene))
    footer.appendChild(back)
  }
  render()
}

function dungeonSelectScene(root: HTMLElement, char: SavedChar, kind: 'real' | 'teaching' | 'all' = 'all'): void {
  const wrap = $(`<div class="wrap"></div>`)
  wrap.appendChild($(`<h1>set.core</h1>`))
  wrap.appendChild($(`<div class="sub">${kind === 'teaching' ? 'training ground' : 'gates of town'} · ${char.name} — ${char.hp}/${char.maxHp} HP</div>`))
  const cols = $(`<div class="hub2"></div>`)
  const leftP = $(`<div class="panel"></div>`)
  const rightP = $(`<div class="panel"></div>`)
  cols.appendChild(leftP); cols.appendChild(rightP)
  wrap.appendChild(cols)
  const footer = $(`<div class="hubfoot"></div>`)
  wrap.appendChild(footer)
  root.appendChild(wrap)

  // teaching = the coach/tutorial dungeons; real = the dungeons proper (the Gates); all = both
  const dungeonIds = Object.keys(GAMEDATA.dungeons).filter((id) => {
    const coach = !!GAMEDATA.dungeons[id].coach
    return kind === 'all' ? true : kind === 'teaching' ? coach : !coach
  })
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
  leftP.appendChild($(`<label style="margin-top:14px">Consumables · ${CONSUMABLE_SLOTS} slots · from Storage</label>`))
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
  /** The consumable loadout: chosen FROM your Storage stock (fungible, so picked by refId with a count;
   *  CONSUMABLE_SLOTS total). The selection is validated against what you still own each render, and
   *  committed OUT of Storage at delve start (survivors return via the loot scene; a death loses them). */
  const renderLoadout = (): void => {
    consWrap.innerHTML = ''
    const owned = new Map<string, number>() // refId → how many in Storage
    for (const it of loadBank().storage) if (it.kind === 'consumable' && CONSUMABLES[it.refId]) owned.set(it.refId, (owned.get(it.refId) ?? 0) + 1)

    // clean the persisted selection against current ownership (sold/used pieces drop out)
    const sel: string[] = []
    const usedPer = new Map<string, number>()
    for (const id of char.consumables) {
      if (!CONSUMABLES[id] || sel.length >= CONSUMABLE_SLOTS) continue
      const used = usedPer.get(id) ?? 0
      if (used >= (owned.get(id) ?? 0)) continue
      sel.push(id); usedPer.set(id, used + 1)
    }
    if (sel.join('|') !== char.consumables.filter(Boolean).join('|')) { char.consumables = sel.slice(); upsertChar(char) }
    const persist = (): void => { char.consumables = sel.slice(); upsertChar(char); renderLoadout() }

    // the chosen slots (click a filled chip to drop it)
    const chips = $(`<div class="cons-chips"></div>`)
    for (let i = 0; i < CONSUMABLE_SLOTS; i++) {
      const id = sel[i]; const c = id ? CONSUMABLES[id] : null
      const tint = c?.color != null ? `var(--c${c.color})` : 'var(--line2)'
      const chip = $(`<span class="cons-slot${c?.kind === 'scroll' ? ' scroll' : ''}${c ? '' : ' empty'}" style="--cc:${tint}"${c ? ` ${consTip(id)}` : ''}>${c ? `<span class="cons-ic">${c.icon}</span>` : ''}</span>`)
      if (c) chip.addEventListener('click', () => { sel.splice(i, 1); persist() })
      chips.appendChild(chip)
    }
    consWrap.appendChild(chips)
    consWrap.appendChild($(`<div class="cons-count">${sel.length} / ${CONSUMABLE_SLOTS} chosen</div>`))

    // the available stock (steppers; + capped by ownership and free slots)
    if (!owned.size) {
      const none = $(`<div class="cons-none">No consumables in Storage — <a href="#">stock up</a> (loot a delve or sell-free from the bag).</div>`)
      none.querySelector('a')!.addEventListener('click', (e) => { e.preventDefault(); goScene(storageScene) })
      consWrap.appendChild(none); return
    }
    const avail = $(`<div class="cons-avail"></div>`)
    for (const [id, have] of [...owned].sort((a, b) => a[0].localeCompare(b[0]))) {
      const c = CONSUMABLES[id]; const used = sel.filter((x) => x === id).length
      const tint = c.color != null ? `var(--c${c.color})` : 'var(--line2)'
      const row = $(`<div class="cons-availrow" ${consTip(id)}><span class="cons-slot${c.kind === 'scroll' ? ' scroll' : ''}" style="--cc:${tint}"><span class="cons-ic">${c.icon}</span></span><div class="gs-meta"><div class="gs-n">${c.name} <span class="bag-x">have ${have}</span></div><div class="gs-a">${c.desc}</div></div><span class="gp-worth">🪙${sellValueOfConsumable(id)}</span><div class="stepper"><button class="st-mns"${used === 0 ? ' disabled' : ''}>−</button><b>${used}</b><button class="st-pls"${used >= have || sel.length >= CONSUMABLE_SLOTS ? ' disabled' : ''}>+</button></div></div>`)
      row.querySelector('.st-mns')!.addEventListener('click', () => { const idx = sel.lastIndexOf(id); if (idx >= 0) { sel.splice(idx, 1); persist() } })
      row.querySelector('.st-pls')!.addEventListener('click', () => { if (used < have && sel.length < CONSUMABLE_SLOTS) { sel.push(id); persist() } })
      avail.appendChild(row)
    }
    consWrap.appendChild(avail)
  }

  fSel.addEventListener('change', () => { foeVal = fSel.value })
  fillFoes(); renderSummary(); renderLoadout()

  // FOOTER: back to the roster · DELVE (the real run — boss dungeons only) · a lone practice fight
  const back = $<HTMLButtonElement>(`<button class="cta ghost">◀ Back</button>`)
  back.addEventListener('click', () => goScene(townScene))
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

/* ---- LEVEL-UP: allocate +4 across P/E/S (CRAWL §3; tempered from +6, BALANCE.md §8). Opens from the sheet; loops over every
   pending level. XP is already banked; this just spends it into stats. Deferrable (close = allocate
   later) since pending levels persist. ---- */
const LU_STATS: { key: keyof StatAlloc; icon: string; name: string }[] = [
  { key: 'power', icon: '⚔', name: 'Power' },
  { key: 'endurance', icon: '🛡', name: 'Endurance' },
  { key: 'speed', icon: '👟', name: 'Speed' },
]
const LU_POINTS = 4 // points to distribute per level — tempered 6→4 (BALANCE.md §8 dec.7): a clean "1 in each
// + 1 bonus" (2/1/1), and it lets GEAR overtake innate in the late game (gear share crosses 50% ~L17). Balanced
// allocation now sits BELOW the foe parity line — gear is expected to close the gap (the "gear matters" cost).
const LU_MAX_PER = 3 // ≤3 to any one stat → 3/1/0 · 2/2/0 · 2/1/1 (a focused main can still reach +3/level)

function openLevelUp(c: SavedChar, onComplete: (c: SavedChar) => void): void {
  document.getElementById('levelup')?.remove()
  const base = effectiveStats(c)
  const alloc: StatAlloc = { power: 0, endurance: 0, speed: 0 }
  const spent = (): number => alloc.power + alloc.endurance + alloc.speed
  const overlay = $(`<div id="levelup"><div class="lucard">
    <div class="lu-hd">⬆ Level Up — <b>Lv ${c.level} → ${c.level + 1}</b></div>
    <div class="lu-sub">Distribute <b>+4</b> across your stats — up to <b>+3</b> each. <b id="lu-left"></b></div>
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
  DELVE = null; clearDelve()
  DAILY = null
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

/** The DELVE path (TODO §B2 first cut): start a run — the encounter schema rolls every room. The chosen
 *  consumables are COMMITTED out of Storage into the run satchel (depletes inventory; survivors return via
 *  the loot scene on a safe exit, lost on death). */
function beginDelve(char: SavedChar, dungeonId: string): void {
  DAILY = null
  const sel = char.consumables.filter((id) => !!id && !!CONSUMABLES[id])
  const { taken, account } = takeConsumablesByRef(loadBank(), sel) // pull the loadout out of the vault
  saveBank(account)
  MARKET = null; RARE = null // the vendors restock after a run
  DELVE = {
    d: createDelve(dungeonId, systemRng),
    bag: taken, // exactly what was pulled from Storage (the run satchel; drunk = gone, survivors return on a safe exit)
    tier: 'minion',
    gold: 0, // run-gold: carried, banks on any safe exit, lost on death (a weightless counter, not a slot)
    gearFound: [], // gear drops accrue here; banked to Storage on a SAFE exit, lost on death (like the satchel)
    gearPity: 0, // the gear-drop sawtooth, carried across rooms
  }
  saveDelve(DELVE) // U2: checkpoint the committed satchel so a process kill can recover it
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
  saveDelve(DELVE) // U2: checkpoint the room + satchel entering this fight (recovery restores the stake)
  startCombat(root, char, DELVE.d.dungeonId, foe, null, DELVE.bag)
}

/** Mount the combat scene for one assembled foe (shared by the practice path and the delve). */
function startCombat(root: HTMLElement, char: SavedChar, dungeonId: string, foe: FoeRuntime, sequence: string[] | null, consumables: string[], explicitSeed?: number): void {
  // Seed the run's RNG: the seed now DRIVES board-gen + the tick RNG, so the run is deterministically
  // replayable from {seed, actions} (the metrics replay substrate). Free play seeds from the system
  // source; a DAILY passes an explicitSeed derived from the shared daily seed, so every player's board
  // sequence is identical (the leaderboard's fairness substrate). The foe was already assembled upstream;
  // it's snapshotted on combat state, so replay reads it rather than re-rolling. (Full server-side re-sim
  // also needs the stat/gear context — deferred to the session seam.)
  const seed = explicitSeed !== undefined ? explicitSeed >>> 0 : (systemRng() * 0x1_0000_0000) >>> 0
  const rng: Rng = mulberry32(seed)
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
  V = { root, deps: { data: GAMEDATA, rng }, run, state: run.combat, char, actions: [], seed, classId: cls.id, loadout: acts, coach: !!dg.coach, coachCue: null, manaColor: dominantManaColor(acts), paused: true, userPaused: false, wallStart: performance.now(), pausedMs: 0, pauseCount: 0, pauseStart: 0, hitstopUntil: 0, holdHud: false, preview: null, selected: [], lastLoggedSel: '', raf: 0, lastT: 0, boardSig: '', refs: {}, stats: { dealt: 0, taken: 0, blocked: 0, healed: 0, sets: 0, traps: 0, xp: 0, gearDmg: 0, gearBlock: 0, gearMana: 0 }, roundFx: emptyRoundFx(), morphSrc: new Map(), dev: { reshapeYou: 0, reshapeFoe: 0, matches: 0, springs: 0, k1: 0, wards: 0, churns: 0 }, lastDread: 0 }
  buildPlay()
  renderBoard()
  updateBar()
  // brief the foe first; Engage starts the clock (and the guided intro, in the Tutorial)
  showBriefing(() => {
    if (!V) return
    V.paused = false
    V.lastT = 0
    V.wallStart = performance.now() // P5: start the wall-clock at ENGAGE (exclude briefing-read time) so wallClockMs tracks the actual fight
    hitstop(graceMs()) // freeze the clock for a beat after Engage — read the fresh board (Speed-stretched, §5.7)
    loop(performance.now())
    // let the player SEE the board for a beat before the guided intro freezes it ("read the board").
    // capture V so a pending timer from a prior combat can't fire into a different one.
    if (dg.guided) sceneTimeout(() => coachStartGuided(), 650)
    else if (!dg.coach) playPreview() // the abbreviated "here's what's incoming" read before round 1 (skipped in teaching fights)
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
  // §13 the COMBO METER — foreground popover above the board: live chain count + a draining 3s grace ring,
  // growing + shaking harder as the chain mounts (and an OVERTIME skin when a chain holds the round open)
  boardWrap.appendChild($(`<div id="combometer" aria-hidden="true"><div class="cmbody"><div class="cmring"><div class="cmcount"><span class="cmn">2</span><span class="cmx">×</span></div></div><div class="cmlabel">COMBO</div></div></div>`))
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
      <div class="critdisp dodgedisp" id="dodgedisp" data-tip-title="💨 Dodge chance" data-tip="Your chance to SLIP each incoming swing WHOLE. A floor from your Speed vs theirs, plus a BANKED pool you build with Move matches — it persists across rounds and resets when you dodge. Capped by the foe's cadence (rare big hits dodgeable in full; fast multi-swing flurries only partly). Stack it during a slow foe's windup to slip a haymaker you can't fully Block."><span class="cd-val" id="dodgeval">0</span><span class="cd-unit">%</span><span class="cd-lab">💨 dodge</span></div>
      <div class="tricounter" id="tricounter">
        <div class="tc-cell atk" id="tcatk" data-tip-title="⚔ Banked Attack" data-tip="Attack matches BANK damage here all round and land as ONE swing at the exchange. Reach the foe's remaining HP and it reads LETHAL — a lethal swing lands first and cancels their strike entirely.">
          <span class="tc-lab">attack</span><span class="tc-ico">⚔</span><span class="tc-val" id="exatk">0</span><span class="tc-tag lethal" id="exlethal">LETHAL</span>
        </div>
        <div class="tc-cell grd" id="tcgrd" data-tip-title="🛡 Guard" data-tip="Defend matches raise your guard against the telegraphed strike — it absorbs that much at the exchange. Once the guard meets the telegraph (✓ sated) further Defend is pure waste: spend the round elsewhere.">
          <span class="tc-lab">guard</span><span class="tc-ico">🛡</span><span class="tc-val" id="exguard">0</span><span class="tc-tag ok">✓</span><span class="tc-tag bite" id="tcbite" data-tip-title="The bite" data-tip="What lands if the exchange came now: their telegraph minus your guard — and the wounds it would scar (one per tenth of your max HP)."></span>
          <span class="grdmeter"><span class="grdfill" id="exguardfill"></span></span>
        </div>
        <div class="tc-cell tac" id="tctac" data-tip-title="⚙ Tactics" data-tip="Move matches bank Tactics charges — a Speed contest, yours vs theirs. Your stance spends them: <b>Stand Ground</b> wards enemy meddling live (board verbs ${BOARD_WARD_COST} · wounds ${WOUND_WARD_COST}); <b>Maneuver</b> burns the WHOLE bank at the rollover, redrawing the deadest cards toward your bias.">
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
  for (const id of ['foename', 'foedesc', 'fleebtn', 'enemylab', 'phpv', 'ehpv', 'php', 'ehp', 'clock', 'roundlab', 'roundfill', 'exatk', 'exinc', 'exguard', 'exguardfill', 'critdisp', 'critval', 'dodgedisp', 'dodgeval', 'exfoe', 'tricounter', 'tcatk', 'tcgrd', 'tctac', 'tcch', 'tcbite', 'tacpips', 'm0', 'm1', 'm2', 'mp0', 'mp1', 'mp2', 'buffind', 'strip', 'dreadbar', 'dreadfill', 'dreadfloor', 'dreadlab', 'boardwrap', 'board', 'tugbar', 'tugmarker', 'tugfoe', 'tugyou', 'devstats', 'spyou', 'spfoe', 'stancebadge', 'log', 'abilities', 'tactics', 'passives', 'consumables', 'floatlayer', 'comboglow', 'combometer']) {
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
const MANA_NAMES = ['Fire', 'Nature', 'Frost']
/** Condense a round's cast list into "Cleave ×2 · Frost Nova" (dedup, keep order, count repeats). */
function castSummary(casts: string[]): string {
  const order: string[] = []
  const n = new Map<string, number>()
  for (const c of casts) { if (!n.has(c)) order.push(c); n.set(c, (n.get(c) ?? 0) + 1) }
  return order.map((c) => (n.get(c)! > 1 ? `${c} ×${n.get(c)}` : c)).join(' · ')
}
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
  const pips = $(`<div class="tacpips" id="tacpips" data-tip-title="Tactics charges" data-tip="Banked by matching Move cards — each Move card's worth is a Speed contest (yours vs theirs). Your stance spends them: <b>Stand Ground</b> wards enemy meddling live (board verbs ${BOARD_WARD_COST} · wounds ${WOUND_WARD_COST}) and carries the bank; <b>Maneuver</b> burns ALL charges at the rollover, redrawing the deadest cards toward your bias. Pips group in threes — one warded wound each."></div>`)
  for (let i = 0; i < CHARGE_CAP; i++) pips.appendChild($(`<span class="pip"></span>`))
  tacSec.appendChild(pips)
  // THE WHEEL — center: Stand Ground · top arc: shape biases · bottom arc: colour biases.
  // One tap queues next round's stance (it LOCKS at the deal — the commitment mechanic).
  const wheel = $(`<div class="wheel" id="tactics"></div>`)
  for (const sp of WHEEL_SPOKES) wheel.appendChild($(`<div class="spoke pos-${sp.pos}" data-axis="${sp.axis}" data-value="${sp.value}" data-tip-title="Maneuver · ${BIAS_NAME[sp.axis][sp.value]}" data-tip="${sp.tip} Locks at the next deal; the dump burns the whole bank.">${sp.icon}</div>`))
  wheel.appendChild($(`<div class="hub" data-tip-title="🛡 Stand Ground" data-tip="Hold the line — charges ward enemy meddling live (a warp or lock costs ${BOARD_WARD_COST}, a wound costs ${WOUND_WARD_COST}), and the bank carries across rounds. Locks at the next deal.">${HUB_SVG}</div>`))
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
    const btn = $(`<button class="cons-slot${c.kind === 'scroll' ? ' scroll' : ''}" data-slot="${slot}" style="--cc:${tint}" ${consTip(c.id)}><span class="cons-ic">${c.icon}</span></button>`)
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
/** Player PAUSE (spacebar) — reuses the `paused` freeze gate (which already stops ticks + blocks every
 *  input handler), marked `userPaused` so the toggle knows this freeze is the player's (a coaching /
 *  briefing pause is left alone). Blocked mid-rollover (holdHud) so it can't strand the choreography. */
function togglePause(): void {
  if (!V || !V.state.running || V.holdHud) return
  if (DAILY) { // P5: no player pause on the daily — but say WHY (a silent dead key is worse than the answer)
    document.getElementById('pauseoverlay')?.remove()
    document.body.appendChild($(`<div id="pauseoverlay"><div class="po-card">⏸ <b>No pausing on the daily</b><div class="po-sub">it's scored on a fair, uninterrupted clear</div></div></div>`))
    sceneTimeout(() => document.getElementById('pauseoverlay')?.remove(), 1500)
    return
  }
  if (V.paused && !V.userPaused) return // a coaching/briefing/flee freeze owns the gate — don't fight it
  if (V.userPaused) { // resume (lastT=0 → no dt jump); bank the pause duration
    V.paused = false; V.userPaused = false; V.lastT = 0
    if (V.pauseStart) { V.pausedMs += performance.now() - V.pauseStart; V.pauseStart = 0 }
  } else { // enter pause
    V.paused = true; V.userPaused = true; V.pauseStart = performance.now(); V.pauseCount++
  }
  renderPauseOverlay()
  updateBar() // refresh the .frozen dim immediately (don't wait a frame)
}
/** The PAUSED scrim + message (a body singleton — swept on any scene change). */
function renderPauseOverlay(): void {
  document.getElementById('pauseoverlay')?.remove()
  if (!V?.userPaused) return
  const ov = $(`<div id="pauseoverlay"><div class="po-card">⏸ <b>PAUSED</b><div class="po-sub">press <kbd>Space</kbd> to resume</div></div></div>`)
  document.body.appendChild(ov)
}
/** One global Space listener (installed once): toggles the player pause during a live fight. Ignored
 *  when a text field or an interactive control is focused (Space keeps its native activation there). */
function initCombatKeys(): void {
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' && e.key !== ' ') return
    if (!V || !V.state.running) return
    if (document.getElementById('confirmmodal') || document.getElementById('briefing')) return // a modal owns the keys
    const t = e.target as HTMLElement | null
    if (t?.closest('input, textarea, button, [contenteditable="true"]')) return // let Space do its native job
    e.preventDefault()
    togglePause()
  })
}

function onFlee(): void {
  if (!V || !V.state.running || V.paused) return
  V.paused = true // freeze the clock while the dialog is open (a custom modal doesn't block like confirm())
  // P5: the flee-dialog freeze is the ONE remaining clock-freeze on the daily (pause is disabled there),
  // so account it like a pause — otherwise repeatedly open→cancel would freeze-plan invisibly. Captured in
  // pausedMs/pauseCount, so wallClockMs−pausedMs stays honest and the behavior is visible in the corpus.
  V.pauseStart = performance.now()
  V.pauseCount++
  confirmModal({
    title: 'Flee combat?',
    body: (DELVE
      ? 'You forfeit this room’s spoils and fall back to the junction. The next chamber is rerolled — press on or go home from there.'
      : 'You forfeit this encounter and retreat to town.')
      + ' <b>⚠ The foe gets one parting strike as you turn to run</b> — your Speed may let you dodge it, and a lethal blow still kills.',
    confirmLabel: '🏃 Flee', danger: true,
    onConfirm: () => { if (V) dispatch({ type: 'flee' }) }, // endScreen banks the open pauseStart into pausedMs
    onCancel: () => { if (V) { V.paused = false; if (V.pauseStart) { V.pausedMs += performance.now() - V.pauseStart; V.pauseStart = 0 } } },
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
  // E7 (FABLE §3): record a selection CHANGE into the action log right before the action that will read it,
  // so hard-rule-6 shielding is reproducible on replay (runSession has no V.selected). One central site —
  // every tick/completeSet is preceded by the current selection, no matter which tap mutated it.
  const selKey = V.selected.join(',')
  if (selKey !== V.lastLoggedSel) { V.actions.push({ type: 'setSelection', slots: V.selected.slice() }); V.lastLoggedSel = selKey }
  V.state.selected = V.selected // hard rule #6: hand the live selection to the engine before it can transmute (tick/trap)
  // U6: snapshot each selected slot's CARD KEY before the reduce — a deliberate player cast is exempt
  // from #6 and can rewrite a selected card in place; we drop those (stale-glow) slots afterward.
  const board0 = V.state.board
  const wasKeys = new Map<number, number | null>(V.selected.map((i) => [i, board0[i] ? keyOf(board0[i]!) : null]))
  const defeated = V.state.foe // captured BEFORE the reduce — the foe that may die this step (a swap loses it)
  const { run, events } = runReduce(V.run, action, V.deps)
  const state = run.combat
  V.run = run
  V.state = state
  V.actions.push(action) // record the session log (the seam): a server could replay these
  // XP banks the moment a foe falls — `won` (final/lone/delve-room) OR `foeChanged` (mid-gauntlet);
  // XP ALWAYS banks (even the run-ending death already credited its earlier kills). Persist now.
  if (events.some((e) => e.type === 'won' || e.type === 'foeChanged')) awardXP(defeated)
  // drop any selected slot that's emptied, locked, OR rewritten in place — so the glow can't dangle on
  // a card the player never picked (U6: the deliberate-cast residual of hard rule #6)
  V.selected = revalidateSelection(V.selected, wasKeys, state.board, state.locked)
  const choreographed = interpret(events) // a rollover batch sequences its own beats + board render
  if (!choreographed && boardSignature(state) !== V.boardSig) renderBoard(verbsFromEvents(events))
  if (events.some((e) => e.type === 'consumableUsed')) {
    renderConsumables() // a slot was spent
    // U2: a consumable drunk mid-fight mutates V.state.consumables directly — re-sync DELVE.bag and
    // re-checkpoint so a "drink then quit mid-fight" can't recover (and thus DUPE) the drunk items.
    if (DELVE) { DELVE.bag = V.state.consumables.slice(); saveDelve(DELVE) }
  }
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

/* THE ROLLOVER CHOREOGRAPHY — the engine resolves the exchange atomically; the UI plays it back as a
   cinematic. The NUMBERS run in a centered BREAKDOWN POPOVER over a fully-dimmed playfield (playBreakdown):
   part by part — YOUR SWING → THEIR STRIKE → NEXT STRIKE → ROUND — each formula's terms POP one at a time,
   the TOTAL biggest, HP snapping as each total lands. Then RELEASE: the popover closes, the field
   re-brightens, the board settles (churn morphs / wound-knit / shatter cracks), "Round N" stamps, the new
   telegraph reveals. CARD INPUT LOCKS for the whole beat (selection cleared, board inert + dimmed behind
   the popover); abilities/consumables/flee stay live. Ticks freeze (the hitstop spans the whole breakdown,
   so the new round opens on a full clock). Only knitHold + releasePad survive from the old beat table; the
   per-term pacing lives in XB. */
const EXCHANGE_BEATS = {
  knitHold: 750, // the wound-knit flare fires this long after the board re-renders at release
  releasePad: 400, // the hitstop runs to breakdownDuration+pad — the freeze covers the whole popover with margin
}
/** prefers-reduced-motion: the wound-knit fires immediately; the pad shrinks (the popover itself snaps via XB_REDUCED). */
const EXCHANGE_BEATS_REDUCED: typeof EXCHANGE_BEATS = { knitHold: 0, releasePad: 250 }
const exBeats = (): typeof EXCHANGE_BEATS => (matchMedia('(prefers-reduced-motion: reduce)').matches ? EXCHANGE_BEATS_REDUCED : EXCHANGE_BEATS)

/** A beat to let a terminal cue land before the end card takes over — the flee PARTING BLOW and any
 *  instant mid-round death (a trap killing you) get this pause so the hit/dodge is SEEN, not skipped
 *  straight to the defeat screen. The rollover's own death is sequenced by the popover instead, so
 *  `choreoFinale` flags that path to end immediately (no double delay). */
const PARTING_BEAT_MS = 1000
let choreoFinale = false

function choreographRollover(events: CombatEvent[]): void {
  if (!V) return
  bumpCareerRounds() // one fought round → the lifetime tally that paces the splash cinematics
  const B = exBeats()
  const seg: Record<'swing' | 'counter' | 'tide' | 'deal', CombatEvent[]> = { swing: [], counter: [], tide: [], deal: [] }
  const finale: CombatEvent[] = [] // won/lost — the end banner fires the instant an HP count crosses 0
  for (const e of events) {
    switch (e.type) {
      case 'roundEnded': break // the beat itself (the mode-shift below)
      case 'won': case 'lost': finale.push(e); break
      case 'enemyDamaged': seg.swing.push(e); break
      case 'swingMath': case 'blockMath': case 'roundSummary': break // the cutscene math beats — played from the extracted sm/bm/rs below, not the tide
      case 'playerDamaged': case 'playerBlocked': case 'cardsShattered': case 'warded': case 'strikeDodged': seg.counter.push(e); break
      case 'windup': case 'roundStarted': seg.deal.push(e); break
      default: seg.tide.push(e) // dump/deal/stance-lock + anything unforeseen rides the tide beat
    }
  }
  const won = finale.some((e) => e.type === 'won')
  const s = V.state // POST-exchange (the engine already resolved); the pre-reads are reconstructed below
  const swingDmg = seg.swing.reduce((a, e) => a + (e.type === 'enemyDamaged' ? e.amount : 0), 0)
  const postFoeHP = s.enemyHP
  const pd = seg.counter.find((e): e is Extract<CombatEvent, { type: 'playerDamaged' }> => e.type === 'playerDamaged')
  const blockedAll = seg.counter.some((e) => e.type === 'playerBlocked')
  const raw = pd ? pd.amount + pd.absorbed : blockedAll ? domNum(V.refs.exinc, 0) : null // null = no strike this round
  const absorbed = pd ? pd.absorbed : raw ?? 0
  const bite = pd ? pd.amount : 0
  const postYouHP = s.playerHP
  const dodgedAll = raw == null && seg.counter.some((e) => e.type === 'strikeDodged')
  const lost = finale.some((e) => e.type === 'lost')
  const shatters = seg.counter.flatMap((e) => (e.type === 'cardsShattered' ? e.slots : []))
  const knits = events.flatMap((e) => (e.type === 'cardsReformed' ? e.slots : [])) // at the rollover, reforms = the knit
  const verbs = verbsFromEvents(events) // booms (wounds) + morphs (tide) + reforms (knit/deal)
  const foeName = bareFoe(s.foe.name)
  const sm = events.find((e): e is Extract<CombatEvent, { type: 'swingMath' }> => e.type === 'swingMath')
  const bm = events.find((e): e is Extract<CombatEvent, { type: 'blockMath' }> => e.type === 'blockMath')
  const rs = events.find((e): e is Extract<CombatEvent, { type: 'roundSummary' }> => e.type === 'roundSummary')
  V.exSwing = sm; V.exBlock = bm // hand the receipt math to the seg.swing/seg.counter log lines (consumed there)
  // guard NO-CARRY (BALANCE §2.1): what was raised but went UNSPENT this rollover — it never carries. On a
  // strike round the engine reports block+telegraph; on a no-strike round read the held HUD before it resets.
  const guardHeld = bm ? bm.block : domNum(V.refs.exguard, 0)
  const guardUsed = bm ? Math.min(bm.block, Math.max(0, bm.telegraph - bm.soaked)) : 0
  const guardWasted = Math.max(0, guardHeld - guardUsed)
  const wEv = seg.deal.find((e): e is Extract<CombatEvent, { type: 'windup' }> => e.type === 'windup')
  if (sm) V.stats.gearDmg += sm.weapon // fight-cumulative gear contribution (the end-screen "your gear" lines)
  if (bm) V.stats.gearBlock += bm.blkRider

  // BUILD THE BREAKDOWN — the exchange plays as a centered POPOVER over a fully-dimmed playfield, part by
  // part; within each formula every term POPS in turn (shake·zoom·dropshadow·colour-dash) with a small line
  // of detail under it, and the TOTAL lands biggest. HP snaps when each total pops; the board settles at release.
  const fx = V.roundFx // the round's accrued activity (abilities, mana) — captured before release resets it
  const wpn = V.char.equipped.weapon ? gearBase(V.char.equipped.weapon.refId) : undefined
  const casterNames = [V.char.equipped.weapon, V.char.equipped.armor, V.char.equipped.relic]
    .map((g) => (g ? gearBase(g.refId) : undefined)).filter((b): b is NonNullable<typeof b> => !!b?.rider?.manaPerMatch)
    .map((b) => `${b.icon} ${b.name}`).join(' & ')
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
  const parts: BPart[] = []
  if (swingDmg > 0) { // ① YOUR SWING
    const terms: BTerm[] = []
    const nAtk = sm?.attacks ?? 0
    if (sm && sm.matches > 0) terms.push({ txt: `⚔ Matches ${sm.matches}`, sub: `${plural(nAtk, 'attack card')} × your Power`, mag: 0.5 })
    if (sm && sm.weapon > 0) terms.push({ txt: `🗡 Weapon +${sm.weapon}`, sub: `+${nAtk > 0 ? Math.round(sm.weapon / nAtk) : sm.weapon}/card · ${wpn ? wpn.name : 'weapon'}`, mag: 0.5 })
    if (sm && sm.crit) terms.push({ txt: `✦ CRIT ×${sm.mult.toFixed(1)}`, sub: 'skill-earned — your chains paid off', mag: 0.85 })
    terms.push({ txt: `${won ? '☠ ' : ''}${swingDmg} damage`, sub: won ? `the ${foeName} falls` : `foe ${postFoeHP + swingDmg} → ${postFoeHP}`, mag: 1, total: true })
    parts.push({ title: 'Your Swing', cls: 'atk', terms, onTotal: () => { interpretChunk(seg.swing); paintHP('e', postFoeHP) } })
  }
  if (!won && raw != null) { // ② THEIR STRIKE — (dodge) → telegraph − soak − block → the net
    const terms: BTerm[] = []
    if (bm && bm.dodged > 0) terms.push({ txt: `💨 ${bm.dodged} dodged`, sub: 'swings you slipped', mag: 0.45, whiff: true }) // §2.3 banked-dodge slip
    terms.push({ txt: `⚔ Telegraph ${raw}`, sub: bm && bm.dodged > 0 ? 'what got through' : 'their raw blow', mag: 0.55 })
    if (bm && bm.soaked > 0) terms.push({ txt: `🪨 Soak −${bm.soaked}`, sub: 'your armor shrugs it off', mag: 0.45 })
    const blk = bm ? bm.block : absorbed
    if (blk > 0) terms.push({ txt: `🛡 Block −${blk}`, sub: bm ? `${plural(bm.defends, 'defend card')} × Endurance${bm.blkRider > 0 ? ` · +${bm.blkRider} armor` : ''}` : 'your guard', mag: 0.55 })
    terms.push({ txt: bite > 0 ? `−${bite} to you` : 'Held! 0', sub: bite > 0 ? `HP ${postYouHP + bite} → ${postYouHP}` : 'the guard holds — no wound', mag: bite > 0 ? 1 : 0.8, total: true })
    parts.push({ title: 'Their Strike', cls: bite > 0 ? 'def' : 'hold', terms, onTotal: () => { interpretChunk(seg.counter); paintHP('p', postYouHP) } })
  } else if (!won && dodgedAll) { // the full whiff — a free round
    parts.push({ title: 'Their Strike', cls: 'dodge', terms: [{ txt: '💨 DODGED', sub: 'every swing slipped — a free round', mag: 1, total: true }], onTotal: () => { spriteReact('you', 'splunge'); interpretChunk(seg.counter) } })
  }
  // ③④⑤ — YOUR round's offense quality. Shown even on a KILL (the user's "show my whole round, don't jump
  // straight to loot"); only a DEATH (lost) cuts to the finish. Each panel still gates on its own data > 0.
  if (!lost && fx.casts.length > 0) { // ③ ABILITY SUMMARY — what your spells did this round (skipped if none cast)
    const cast = castSummary(fx.casts)
    const terms: BTerm[] = [{ txt: `✦ ${cast}`, sub: plural(fx.casts.length, 'cast'), mag: 0.55 }]
    const fxTerms: BTerm[] = []
    if (fx.dmg > 0) fxTerms.push({ txt: `${fx.dmg} damage`, sub: 'dealt by your abilities', mag: 0.9 })
    if (fx.healed > 0) fxTerms.push({ txt: `+${fx.healed} healed`, sub: 'you mend', mag: 0.7 })
    if (fx.transformed > 0) fxTerms.push({ txt: `${fx.transformed} reforged`, sub: 'cards you transmuted', mag: 0.6 })
    if (fx.locked > 0) fxTerms.push({ txt: `${fx.locked} locked`, sub: 'cards held fast', mag: 0.55 })
    if (fx.extended > 0) fxTerms.push({ txt: `+${fx.extended}s`, sub: 'you stalled the clock', mag: 0.55 })
    if (fxTerms.length) fxTerms[0].total = true; else terms[0].total = true // the headline effect lands biggest
    parts.push({ title: 'Your Abilities', cls: 'abil', terms: [...terms, ...fxTerms] })
  }
  const manaSum = fx.mana[0] + fx.mana[1] + fx.mana[2]
  if (!lost && manaSum > 0) { // ④ MANA AWARD — what you banked this round, and from where
    const terms: BTerm[] = []
    for (let c = 0; c < 3; c++) if (fx.mana[c] > 0) terms.push({ txt: `${MANA_ICON[c]} +${fx.mana[c]} ${MANA_NAMES[c]}`, sub: 'from your sets', mag: 0.5 })
    terms.push({ txt: `+${manaSum} mana`, sub: fx.riderMana > 0 && casterNames ? `incl +${fx.riderMana} from ${casterNames}` : 'banked for your spells', mag: 0.8, total: true })
    parts.push({ title: 'Mana', cls: 'mana', terms })
  }
  if (!lost && rs && (rs.comboPeak >= 2 || rs.primed > 0)) { // ⑤ ROUND — the offense-quality shine
    const terms: BTerm[] = []
    if (rs.comboPeak >= 2) terms.push({ txt: `🔥 ${rs.comboPeak}× combo`, sub: rs.combos > rs.comboPeak ? `${Math.round(rs.combos)} chains linked in time` : 'a clean streak', mag: Math.min(0.95, 0.5 + rs.comboPeak * 0.05), total: rs.primed === 0 })
    if (rs.primed > 0) terms.push({ txt: `✦ ${rs.primed} primed`, sub: 'Maneuver churn matched in time', mag: 0.7, total: true })
    parts.push({ title: 'Round', cls: 'sum', terms })
  }
  if (!won && !lost && wEv && wEv.swings > 0) { // ⑥ NEXT STRIKE — what's incoming; how much guard to raise
    const landed = wEv.swings - wEv.dodged
    const per = landed > 0 ? Math.round(wEv.amount / landed) : 0
    const terms: BTerm[] = [{ txt: `⚔ ${plural(wEv.swings, 'swing')}`, sub: per > 0 ? `~${per} each` : 'winding up', mag: 0.45 }]
    if (wEv.dodged > 0) terms.push({ txt: `💨 ${wEv.dodged} dodged`, sub: 'your Speed slips them', mag: 0.4, whiff: true })
    terms.push({ txt: wEv.amount > 0 ? `⚔ ${wEv.amount} incoming` : '💨 all dodged', sub: wEv.amount > 0 ? `raise ${wEv.amount} guard to negate it` : 'a free round ahead', mag: 0.85, total: true })
    parts.push({ title: 'Next Strike', cls: 'tele', terms, onTotal: () => { const g = V?.refs.tcgrd; if (g) { g.classList.remove('goalflash'); void g.offsetWidth; g.classList.add('goalflash'); sceneTimeout(() => g.classList.remove('goalflash'), 1000) } } })
  }

  // a fight-ENDING rollover (a kill, or your death) doesn't re-open the round — it hands off to the end
  // screen (the win-reveal / defeat card). No board settle, no tableau: the lethal panel pops, then ends.
  const ending = won || lost
  // RELEASE — the popover closed; re-brighten, settle the board (morphs/knits/wound-cracks), stamp the round
  const release = ending
    ? (): void => { if (V) { V.exSwing = undefined; V.exBlock = undefined; choreoFinale = true; interpretChunk(finale); choreoFinale = false } } // → endScreen NOW (the popover already sequenced it)
    : (): void => {
      if (!V) return
      V.holdHud = false
      exchangeExit()
      for (const sl of shatters) boomSlot(sl, verbs)
      if (shatters.length) bamWord('CRACK!', 'pain', V.refs.boardwrap, 1.1)
      interpretChunk(seg.tide)
      if (boardSignature(V.state) !== V.boardSig) renderBoard(verbs)
      holdKnits(knits, B.knitHold)
      interpretChunk(seg.deal)
      if (raw == null && !dodgedAll && !seg.counter.length) log(`<span style="opacity:.7">The ${foeName} doesn't strike.</span>`, 'foe')
      // the guard no-carry drop (only when banked Defend actually went to waste) + the deal's wound knit
      if (guardWasted > 0) log(`<span style="opacity:.75">${guardDropLine(guardWasted)}</span>`, 'you')
      if (knits.length) log(knitLine(knits.length), 'you')
      if (rs && (rs.comboPeak >= 2 || rs.primed > 0)) devLog(`round — ${rs.comboPeak}× combo peak · ${Math.round(rs.combos)} chains · ${rs.primed} primed.`)
      V.exSwing = undefined; V.exBlock = undefined // clear any unconsumed receipt (no swing fired this round)
      roundStamp(V.state.round)
      pulseTelegraph() // the new telegraph reveals with its flourish
      V.roundFx = emptyRoundFx() // the new round starts with a clean activity slate (settle events above are flushed)
    }

  // the slide-to-corner TABLEAU is for surviving multi-panel rounds only — a kill, a death, or a lone
  // panel just pops and goes (the user's "don't slide when it's the only thing / the killing blow").
  const tableau = !ending && parts.length > 1

  // FREEZE + LOCKOUT, then play. The hitstop spans the whole breakdown so the new round opens on a full clock.
  V.holdHud = true
  hitstop(breakdownDuration(parts, 1, tableau) + B.releasePad)
  V.selected = []
  V.refs.board?.querySelectorAll('.card.sel, .card.badpair, .card.bad').forEach((el) => el.classList.remove('sel', 'badpair', 'bad'))
  exchangeEnter() // the board locks + dims (the popover backdrop dims the rest)
  log(`<span style="opacity:.8">— the exchange —</span>`, 'you')
  if (parts.length === 0) { sceneTimeout(release, 220); return } // a quiet round — no formula to show
  playBreakdown(parts, release, 1, tableau)
}

/* THE BREAKDOWN POPOVER — the exchange cutscene as a centered modal over a fully-dimmed playfield. Each
   PART is a formula; its terms POP one at a time (the per-term pop is the shake·zoom·dropshadow·colour
   flash), the TOTAL biggest + longest, then the next part. onTotal fires the HP snap / log for that part. */
interface BTerm { txt: string; sub?: string; mag: number; total?: boolean; whiff?: boolean }
interface BPart { title: string; cls: string; terms: BTerm[]; onTotal?: () => void }
// modestly faster than the original (500/460/920/1550/640/3000/520) — the "speed it up a little" pass.
// Still reads beat by beat; the experience-pace multiplier (paceForRounds) compresses it further for
// veterans, and a CLICK skips the rest (playBreakdown). `hold` = the parked-tableau dwell.
const XB = { intro: 420, partIntro: 380, term: 760, total: 1280, gap: 520, hold: 2400, outro: 440 }
const XB_REDUCED: typeof XB = { intro: 160, partIntro: 150, term: 260, total: 400, gap: 200, hold: 650, outro: 180 }
/** The live experience pace (1 = novice/full window → 0.4 = veteran/floor), read from the lifetime tally.
 *  Multiplies the animation beats AND the dwell so the whole ledger compresses as the player logs rounds. */
const expPace = (): number => paceForRounds(careerRounds())
const xbT = (pace = 1): typeof XB => {
  const x = matchMedia('(prefers-reduced-motion: reduce)').matches ? XB_REDUCED : XB
  const exp = expPace()
  const m = pace * exp // animation beats scale with BOTH the per-call pace and experience
  if (m === 1 && exp === 1) return x
  return { intro: x.intro * m, partIntro: x.partIntro * m, term: x.term * m, total: x.total * m, gap: x.gap * m, hold: x.hold * exp, outro: x.outro * m }
}
const XB_QUICKHOLD = 700 // the dwell when there's no tableau (a single panel, a kill swing, the opener) — pop, linger, go
const quickHold = (): number => XB_QUICKHOLD * expPace()
/** Skip pacing: a click completes the current panel (keeping its normal wait); the next click advances.
 *  RAPID_COUNT clicks inside RAPID_WINDOW_MS = "spam to skip" → flush straight to the end. */
const RAPID_WINDOW_MS = 600
const RAPID_COUNT = 3
function breakdownDuration(parts: BPart[], pace = 1, tableau = parts.length > 1): number {
  const X = xbT(pace)
  let t = X.intro
  for (const p of parts) { t += X.partIntro; for (const term of p.terms) t += term.total ? X.total : X.term; t += X.gap }
  return t + (tableau ? X.hold : quickHold()) + X.outro
}
/** UX-FRIENDLY PARK ZONES (replaces the old four-corner scatter). Finished ledger panels settle into two
 *  readable columns flanking the centre, top→bottom, instead of being flung to the screen edges over the
 *  HP bars / tactics wheel. Each lands a little randomly within its zone (jitter) so the spread reads
 *  hand-dealt, not gridded. Offsets are vw/vh from screen-centre; kept well inside the edges. */
const PARK_ANCHORS: [number, number][] = [
  [-20, -15], [20, -15], // upper-left, upper-right
  [-23, 0], [23, 0],     // mid-left, mid-right
  [-18, 14], [18, 14],   // lower-left, lower-right
]
function parkTransform(i: number): string {
  const [bx, by] = PARK_ANCHORS[i % PARK_ANCHORS.length]
  const jx = (Math.random() - 0.5) * 5 // ±2.5vw jitter (cosmetic — Math.random, never the engine rng)
  const jy = (Math.random() - 0.5) * 4 // ±2vh
  const rot = (Math.random() - 0.5) * 4 // ±2°
  return `translate(calc(-50% + ${(bx + jx).toFixed(1)}vw), calc(-50% + ${(by + jy).toFixed(1)}vh)) scale(.52) rotate(${rot.toFixed(1)}deg)`
}
/** The sequenced ledger. tableau (default = more than one part) scatters finished panels to corners and
 *  holds the spread; without it (a lone panel, a kill swing, the round-1 opener) each panel just fades as
 *  the next appears and the run ends on a short linger — no slide, no long pause. */
function playBreakdown(parts: BPart[], release: () => void, pace = 1, tableau = parts.length > 1): void {
  const view = V
  if (!view) return
  const X = xbT(pace)
  document.body.classList.add('xbreak-on')
  const stage = $(`<div id="xbreak"></div>`)
  document.body.appendChild(stage)
  void stage.offsetWidth; stage.classList.add('in')
  const cards: HTMLElement[] = []
  const park = (i: number): void => { const c = cards[i]; if (c) { c.classList.add('parked'); c.style.transform = parkTransform(i) } } // slide+scale to its zone
  const fade = (i: number): void => { const c = cards[i]; if (c) { c.classList.remove('show'); window.setTimeout(() => c.remove(), 450) } } // no-tableau: the panel just leaves
  const showPart = (idx: number, part: BPart): void => {
    if (idx > 0) { if (tableau) park(idx - 1); else fade(idx - 1) } // the previous panel slides to its slot, or fades out
    const card = $(`<div class="xb-card ${part.cls}"><div class="xb-title in"></div><div class="xb-row"></div></div>`)
    card.querySelector('.xb-title')!.textContent = part.title
    stage.appendChild(card); cards[idx] = card
    void card.offsetWidth; card.classList.add('show')
  }
  const showTerm = (idx: number, part: BPart, term: BTerm): void => {
    if (!cards[idx]) return
    const chip = $(`<div class="xb-term${term.total ? ' total' : ''}${term.whiff ? ' whiff' : ''}"><span class="xb-val"></span>${term.sub ? '<span class="xb-sub"></span>' : ''}</div>`)
    chip.querySelector('.xb-val')!.textContent = term.txt
    if (term.sub) chip.querySelector('.xb-sub')!.textContent = term.sub
    chip.style.setProperty('--mag', String(term.mag))
    cards[idx].querySelector('.xb-row')!.appendChild(chip); void chip.offsetWidth; chip.classList.add('pop')
    if (term.total) part.onTotal?.()
  }
  // PANEL DRIVER — panels play one at a time; within a panel the terms pop in turn, then it WAITS (the gap,
  // or the hold on the last) before the next. Timers are scheduled lazily one panel ahead, so at any moment
  // only the current panel's timers are pending — which makes the per-click skip below clean to reason about.
  let timers: number[] = []
  const at = (ms: number, fn: () => void): void => { timers.push(sceneTimeout(fn, ms)) }
  const clearTimers = (): void => { for (const id of timers) clearTimeout(id); timers = [] }
  const popped: number[] = parts.map(() => 0) // terms popped per panel
  let cur = -1 // current panel index (−1 = pre-intro)
  let panelDone = false // the current panel's terms are all in; it's now in its WAIT

  // RELEASE — fade the stage, remove it, hand back. Idempotent (skip + auto-fire race).
  let finished = false
  let skipped = false
  const finish = (): void => {
    if (finished) return
    finished = true
    clearTimers()
    document.removeEventListener('pointerdown', onClick, true)
    stage.classList.add('out')
    window.setTimeout(() => stage.remove(), X.outro)
    document.body.classList.remove('xbreak-on')
    if (skipped && view === V) view.hitstopUntil = performance.now() // unfreeze the clock as the board settles
    if (view === V) release()
  }

  const completePanel = (i: number): void => { // pop every remaining term of panel i now (fires its onTotal)
    const part = parts[i]
    for (let k = popped[i]; k < part.terms.length; k++) showTerm(i, part, part.terms[k])
    popped[i] = part.terms.length
    panelDone = true
  }
  const waitThenNext = (i: number): void => { // the panel's NORMAL wait, then advance (or finish on the last)
    if (i >= parts.length - 1) { if (tableau) park(i); at(tableau ? X.hold : quickHold(), finish) }
    else at(X.gap, () => startPanel(i + 1))
  }
  function startPanel(i: number): void {
    if (view !== V) return
    cur = i; panelDone = false
    showPart(i, parts[i])
    let tt = X.partIntro
    parts[i].terms.forEach((term, k) => { at(tt, () => { if (popped[i] <= k) { popped[i] = k + 1; showTerm(i, parts[i], term) } }); tt += term.total ? X.total : X.term })
    at(tt, () => { panelDone = true; waitThenNext(i) })
  }

  // SKIP — one click completes the current panel (then keeps its normal wait); a click while it's already
  // waiting skips ahead to the next panel; THREE clicks in a short window flush straight to the end.
  let clicks: number[] = []
  const flushAll = (): void => {
    clearTimers()
    for (let i = Math.max(0, cur); i < parts.length; i++) { if (cards[i] == null) showPart(i, parts[i]); completePanel(i) }
    if (tableau && parts.length) park(parts.length - 1)
    finish()
  }
  const skip = (): void => {
    if (finished) return
    if (view !== V || !stage.isConnected) { document.removeEventListener('pointerdown', onClick, true); return } // scene torn down mid-cinematic → self-clean
    skipped = true
    clicks = rollClicks(clicks, performance.now(), RAPID_WINDOW_MS)
    switch (skipAction(cur, panelDone, parts.length - 1, clicks.length, RAPID_COUNT)) {
      case 'flush': flushAll(); break
      case 'start': clearTimers(); startPanel(0); break // clicked during the intro → start now
      case 'complete': clearTimers(); completePanel(cur); waitThenNext(cur); break // end-state now, keep the wait
      case 'advance': clearTimers(); startPanel(cur + 1); break // skip the wait → next panel
      case 'finish': clearTimers(); finish(); break // waiting on the last → release
    }
  }
  const onClick = (e: Event): void => { e.stopPropagation(); skip() }
  document.addEventListener('pointerdown', onClick, true)
  at(X.intro, () => startPanel(0))
}

/** ROUND-1 PREVIEW — a short, abbreviated read at combat start: the incoming swings, the dodges, and how
 *  much guard to raise. Same popover grammar as the exchange's "Next Strike" part, played snappier. Skipped
 *  if the foe has no telegraph (a pressure-free dummy). Freezes the clock + locks the board for its run. */
function playPreview(): void {
  if (!V) return
  const inc = V.state.incoming
  const swings = V.state.foe.swings
  if (inc == null || swings <= 0) return
  const dodged = V.state.incomingDodged
  const landed = swings - dodged
  const per = landed > 0 ? Math.round(inc / landed) : 0
  const terms: BTerm[] = [{ txt: `⚔ ${swings} swing${swings === 1 ? '' : 's'}`, sub: per > 0 ? `~${per} each` : 'winding up', mag: 0.5 }]
  if (dodged > 0) terms.push({ txt: `💨 ${dodged} dodged`, sub: 'your Speed slips them', mag: 0.4, whiff: true })
  terms.push({ txt: inc > 0 ? `⚔ ${inc} incoming` : '💨 all dodged', sub: inc > 0 ? `raise ${inc} guard to negate it` : 'a free opening', mag: 0.85, total: true })
  const part: BPart = { title: 'Incoming', cls: 'tele', terms }
  V.holdHud = true // lock the board + freeze the read while the preview plays
  hitstop(breakdownDuration([part], 0.65) + 300)
  playBreakdown([part], () => { if (V) { V.holdHud = false; const g = V.refs.tcgrd; if (g) { g.classList.add('goalflash'); sceneTimeout(() => g.classList.remove('goalflash'), 1000) } } }, 0.65)
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

function emptyRoundFx(): View['roundFx'] {
  return { casts: [], dmg: 0, healed: 0, transformed: 0, locked: 0, extended: 0, mana: [0, 0, 0], riderMana: 0 }
}
/** Accumulate the round's activity live (NOT during the exchange hold) — feeds the breakdown's Ability +
 *  Mana parts. Reset each round at release. Ability/proc damage, heals, your reforges/locks, stalls, mana. */
function accrueRoundFx(events: CombatEvent[]): void {
  if (!V || V.holdHud) return // the exchange replays its own events through interpretChunk — don't double-count
  const fx = V.roundFx
  for (const e of events) {
    switch (e.type) {
      case 'abilityCast': fx.casts.push(ABILITIES[e.id]?.name ?? e.id); break
      case 'enemyDamaged': if (!e.immune) fx.dmg += e.amount; break // mid-round damage = an ability/proc (the exchange swing is gated out by holdHud)
      case 'playerHealed': fx.healed += e.amount; break
      case 'cardsTransmuted': if (!e.source && !e.hostile) fx.transformed += e.slots.length; break // your own cast (no source tag, not a boom)
      case 'cardsLocked': fx.locked += e.slots.length; break
      case 'clockChanged': if (e.deltaSeconds > 0) fx.extended += e.deltaSeconds; break
      case 'manaGained': for (let i = 0; i < 3; i++) fx.mana[i] += e.mana[i]; break
      case 'setResolved': fx.riderMana += e.riderMana; break
    }
  }
}

/** Strip a leading "The " so our log templates ("The ${foe}…", "the ${foe}…") don't DOUBLE the article
 *  for title-named bosses — "The Goblin King" reads "Goblin King" inside the template, so the rendered
 *  line is "The Goblin King collapses." not "The The Goblin King…". Bare-title displays (the foe header /
 *  briefing) use the raw name and keep the full title. */
const bareFoe = (name: string): string => name.replace(/^the\s+/i, '')

/** Wrap a (possibly empty) receipt breakdown as a dim trailing span — the secondary "how the number
 *  came to be" detail that rides under the headline strike line. '' in → '' out (no empty span). */
function recapSpan(detail: string): string {
  return detail ? ` <span class="recap">(${detail})</span>` : ''
}

/** The affix label tagged onto a proc's effect event by the engine (`fireProcs`), or undefined for a
 *  normal swing/heal/etc. The UI uses it to attribute on-match/on-wound gear procs in the log. */
function procSourceOf(e: CombatEvent): string | undefined {
  return (e as { procSource?: string }).procSource
}

/** Dev-mode verbose log: the continuous resource flow (charge/mana/dodge income) that normally lives on
 *  the HUD/floats only. Gated on isDev() so normal play stays outcome-focused (the user's "log all gains
 *  that don't normally surface, if dev mode is on"). */
function devLog(html: string): void {
  if (isDev()) log(`<span class="devlog">${html}</span>`, 'you')
}

function interpretChunk(events: CombatEvent[]): void {
  if (!V || !events.length) return
  accrueRoundFx(events)
  const MANA = ['Fire', 'Nature', 'Frost']
  logGroup = $(`<div class="loggroup"></div>`) // collect this batch's log lines into one cascade unit
  bumpTurn() // advance the flavour-variety counter once per batch (verbs rotate, stable across re-renders)
  const foe = bareFoe(V.state.foe.name)
  const voice = voiceOf(GAMEDATA.creatures[V.state.foe.id]?.voice)
  // collect full-screen feedback and flush once: one flash (highest priority), one hitstop, staggered bursts
  let flashKind: 'trap' | 'trick' | 'wound' | null = null
  let flashPow = 1
  let hs = 0
  let matchSlots: number[] | null = null // the set just played (for the reactive-transmute ripple)
  // a resolved set means its cards are IN FLIGHT to the counter — the landing owns the punch
  // (cellLand/flashStat fire from landPunch when each card arrives, never before)
  const resolveFlight = !REDUCED.matches && events.some((e) => e.type === 'setResolved')
  // wound count in this batch — folded as the "(N wounds)" tail onto the strike line that scarred them
  const shatterCount = events.reduce((n, e) => n + (e.type === 'cardsShattered' ? e.slots.length : 0), 0)
  // a named trap/trick already narrates its own board pull — suppress the generic churn line when present
  const hasNamedTrigger = events.some((e) => e.type === 'triggerSprung')
  // affix gear procs: dev labels each one; normal play COALESCES them into one summary line per match
  const procAgg = { dmg: 0, mana: [0, 0, 0] as [number, number, number], block: 0, heal: 0, labels: [] as string[] }
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
        devLog(`⚙ +${e.amount.toFixed(2)} charge${e.amount === 1 ? '' : 's'}${e.source === 'overflow' ? ' (block overflow)' : ''}.`)
        break
      case 'dodgeGained':
        devLog(`💨 dodge pool ${e.pool.toFixed(2)}/${e.cap.toFixed(2)}.`)
        break
      case 'roundStarted': {
        log(e.incoming != null
          ? `<b>Round ${e.round}</b> — the ${foe} telegraphs <b>⚔${e.incoming}</b>.`
          : `<b>Round ${e.round}</b> — the ${foe} circles: <b>no strike</b> this round.`, 'foe')
        // §5.8 dread: narrate the moment it crosses the onset / climbs a step — the live damage multipliers
        const dl = dreadLevel(V.state)
        const dline = dreadLine(V.lastDread, { level: dl, foeMult: dreadFoeMult(V.state), playerMult: dreadPlayerMult(V.state) }, DREAD_ONSET)
        if (dline) { log(`<b>${dline}</b>`, 'foe'); V.lastDread = dl }
        kickClock() // the round bar refills with the deal
        break
      }
      case 'tacticsBurned':
        // §5.7 live-burn: each ~1/s burn rolls one card (the morph + the ⚙ counter carry it). Keep the
        // log quiet — only mark the moment the bank runs dry, so the tide reads as continuous, not spammy.
        if (e.remaining === 0) log('<b>Maneuver</b> — the bank runs dry; the tide settles.', 'you')
        break
      case 'combo':
        // §7/§13 combo streak — the visceral skill layer (full floaty escalation in onCombo).
        onCombo(e.level, e.styled, e.color)
        break
      case 'roundOvertime':
        // §13 the clutch moment — a live chain just held the exchange open past the clock. Shout it once;
        // the meter + clock flip to the OVERTIME skin in updateBar for as long as the hold lasts.
        bamWord('OVERTIME!', 'tide', V.refs.board, 1.15)
        log('<b>OVERTIME</b> — your chain holds the round open. Keep it alive!', 'you')
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
        { const ps = procSourceOf(e); if (ps) { if (isDev()) log(`<span class="recap">gear</span> ${ps}.`, 'you'); else { procAgg.dmg += e.amount; procAgg.labels.push(ps) } break } } // gear proc — attribute (dev: the label self-describes) / coalesce (normal)
        if (actor && !e.crit) { actor.dmg += e.amount; if (e.magic) actor.magic = true; break } // fold into the action's own line (a crit gets its own shout)
        // the rollover swing carries its receipt (matches + weapon + crit); a magic/mid-round hit has none
        const recap = e.magic ? '' : recapSpan(offenseRecap(V.exSwing)); V.exSwing = undefined
        if (e.crit) log(`✦ <b>CRITICAL</b> — you strike for <b>−${e.amount}</b>!${recap}`, 'you big')
        else { const tier = tierOf(e.amount, 12); if (e.magic) log(`${magicLead()} — drains <b>${e.amount}</b>.`, 'you'); else log(`You land ${strikeWord(tier)} — <b>−${e.amount}</b>.${recap}`, tier === 'heavy' ? 'you big' : 'you') }
        break
      }
      case 'enemyHealed':
        log(`The ${foe} ${pick(voice.heal)} — <b>+${e.amount}</b>.`, 'foe')
        floatBoard(`+${e.amount}`, 'var(--red)', 'enemy')
        break
      case 'playerHealed': {
        floatBoard(`+${e.amount}`, 'var(--green)', 'you')
        V.stats.healed += e.amount
        const ps = procSourceOf(e)
        // a RATE label (e.g. lifesteal 🩸5%) doesn't encode the HP it restored — show both; a flat label (+4hp) already does
        if (ps) { if (isDev()) log(`<span class="recap">gear</span> ${ps}${ps.includes('%') ? ` — <b>+${e.amount}</b> HP` : ''}.`, 'you'); else { procAgg.heal += e.amount; procAgg.labels.push(ps) } break }
        if (actor) { actor.heal += e.amount; break }
        log(`You ${healWord()} — <b>+${e.amount}</b> HP.`, 'you')
        break
      }
      case 'blockGained': {
        // sated guard cue: the gain past an already-met telegraph is waste — say so, greyly
        const wasSated = V.state.incoming != null && V.state.block - e.amount >= V.state.incoming
        floatBoard(wasSated ? `+${e.amount}🛡 wasted` : `+${e.amount}🛡`, wasSated ? 'var(--ink-faint)' : 'var(--blue)', 'you', wasSated ? 'wasted' : undefined)
        if (!wasSated && !resolveFlight) { cellLand('tcgrd'); flashStat('exguard') } // the guard cell rings as real Block lands (waste gets no reward ring; a flight rings on landing)
        const ps = procSourceOf(e)
        if (ps) { if (isDev()) log(`<span class="recap">gear</span> ${ps}.`, 'you'); else { procAgg.block += e.amount; procAgg.labels.push(ps) } break }
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
        const ps = procSourceOf(e)
        const manaClause = e.mana.map((x, i) => (x > 0 ? `+${x} ${MANA[i]}` : '')).filter(Boolean).join(' · ')
        if (ps) { if (isDev()) log(`<span class="recap">gear</span> ${ps} ${e.mana.map((x, i) => (x > 0 ? MANA[i] : '')).filter(Boolean).join(' · ')}.`, 'you'); else { for (let i = 0; i < 3; i++) procAgg.mana[i] += e.mana[i]; procAgg.labels.push(ps) } break }
        if (manaClause) devLog(`✦ mana ${manaClause}.`)
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
        // attribution line — only when no NAMED trap/trick already narrates this pull (avoid double-logging),
        // and never for player churn (the continuous ~1/s Maneuver burn carries its own beat)
        if ((src === 'drift' || src === 'trap' || src === 'trick') && !hasNamedTrigger) log(churnLine(src, e.slots.length), src === 'trick' ? 'trick' : 'foe')
        break
      }
      case 'cardsLocked':
        log(lockLine(e.slots.length, Math.round((e.untilMs - V.state.now) / 1000)), 'foe')
        break
      case 'cardsUnlocked':
        log(`<span style="opacity:.7">Locked cards come free.</span>`, 'you')
        break
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
        log(`You break off and flee the ${foe}.`, 'you')
        sceneTimeout(() => endScreen('flee'), PARTING_BEAT_MS) // let the parting-blow cue land first
        break
      case 'manaDrained':
        log(`The ${foe} ${drainWord()} your ${MANA[e.color]} — <b>−${e.amount}</b>.`, 'foe')
        break
      case 'clockChanged':
        // v3 interim stall re-anchor: a stall verb STRETCHES the round (+) / an enemy yank shortens it (−)
        if (e.deltaSeconds > 0) {
          kickClock() // the round bar recoils + visibly refills as roundEndsAt moves out
          log(`<span style="opacity:.85">⏳ The round stretches — <b>+${e.deltaSeconds}s</b>.</span>`, 'you')
        } else if (e.deltaSeconds < 0 && !hasNamedTrigger) {
          // a named trap (e.g. Confusion) already narrates its own "−Ns" line — don't double-log the yank
          log(`The ${foe} hurries the exchange — <b>${e.deltaSeconds}s</b>.`, 'foe')
        }
        break
      case 'setResolved': {
        V.dev.matches++
        V.stats.sets++
        V.stats.gearMana += e.riderMana // caster weapon/armor contribution — the end-screen "your gear" mana line
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
        if (e.source === 'the dread') { // §5.8 the unguardable bleed — foe-independent, bypasses guard
          log(`<b>Dread</b> gnaws past your guard — <b>−${e.amount}</b> (unguardable).`, 'foe')
        } else {
          // the rollover strike (or an instant trap hit) carries its receipt: telegraph→slip→soak→guard, + scars
          const detail = [defenseRecap(V.exBlock), woundTail(shatterCount)].filter(Boolean).join(' · '); V.exBlock = undefined
          const data = `<b>−${e.amount}</b>${e.absorbed ? ` (${e.absorbed} blocked)` : ''}`
          log(`The ${foe} ${pick(voice.hit)} you — ${strikeWord(tier, 1)}, ${data}.${recapSpan(detail)}`, tier === 'heavy' ? 'foe big' : 'foe')
        }
        V.stats.taken += e.amount; V.stats.blocked += e.absorbed
        queueFlash('wound', 0.8 + Math.min(1.2, e.amount / Math.max(1, V.state.foe.damage))) // severity-scaled flash
        spriteReact('you', 'sphit'); spriteReact('foe', 'splunge')
        floatBoard(`-${e.amount} HP`, 'var(--red)', 'you')
        flashStat('phpv')
        bursts.push(['💥', '✷ struck', foe, e.absorbed ? `−${e.amount} HP · ${e.absorbed} blocked` : `−${e.amount} HP`, 'wound'])
        hs = Math.max(hs, 150)
        break
      }
      case 'enemyStrikes':
        kickClock() // an instant strike landed OUTSIDE the exchange — the round bar recoils (the interrupt beat;
        break       // the paired trap chip + −HP carry the rest, so this only adds the "not-at-the-rollover" jolt)
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
      case 'won': {
        log(`The ${foe} collapses. <b>Victory!</b>`, 'win')
        // a one-line payoff: the XP this fight banked (gold/drops roll in the spoils ledger after this scene)
        if (V.stats.xp > 0) log(`<span style="opacity:.9">Spoils — <b>+${V.stats.xp} XP</b>${pendingLevels(V.char) > 0 ? ' · <b>Level up!</b>' : ''}.</span>`, 'win')
        // the rollover's win-reveal fires NOW (the popover already sequenced it); a mid-round kill
        // (passive/trick) gets a beat so the killing cue lands before the reveal.
        if (choreoFinale) endScreen('win'); else sceneTimeout(() => endScreen('win'), PARTING_BEAT_MS)
        break
      }
      case 'lost':
        log(`You fall in battle. <b>Defeat.</b>`, 'foe')
        // rollover death → end now (popover-sequenced); a flee parting-blow / instant trap death → a
        // beat so the killing hit is SEEN before the defeat card.
        if (choreoFinale) endScreen('lose'); else sceneTimeout(() => endScreen('lose'), PARTING_BEAT_MS)
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
  // NORMAL play: the match's gear procs, coalesced into one summary line (dev already labelled each above)
  if (!isDev() && (procAgg.dmg || procAgg.block || procAgg.heal || procAgg.mana.some((x) => x > 0))) {
    const cl: string[] = []
    if (procAgg.dmg) cl.push(`<b>−${procAgg.dmg}</b>`)
    if (procAgg.block) cl.push(`<b>+${procAgg.block}</b> Block`)
    if (procAgg.heal) cl.push(`<b>+${procAgg.heal}</b> HP`)
    procAgg.mana.forEach((x, i) => { if (x > 0) cl.push(`<b>+${x}</b> ${MANA[i]}`) })
    log(`Gear procs — ${cl.join(' · ')}. <span class="recap">${procAgg.labels.join(' · ')}</span>`, 'you')
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
  // the meter PUNCH — the per-frame updateBar carries the count/grace-ring/scale; this just re-triggers the
  // pop on each new link (the meter itself fades in/out + grows in updateBar from s.combo)
  const cm = V.refs.combometer
  if (cm) { cm.classList.remove('pop'); void cm.offsetWidth; cm.classList.add('pop') }
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
    const ot = s.roundOvertime // §13 a live chain is HOLDING the exchange open
    V.refs.roundlab.textContent = s.running ? (ot ? `Round ${s.round} · OVERTIME` : `Round ${s.round}${s.roundExtendedS > 0 ? ` · +${s.roundExtendedS}s` : ''}`) : 'Round —'
    const clk = V.refs.clock
    clk.textContent = !s.running ? '—' : ot ? '⏱ OT' : `${Math.ceil(remain)}s`
    clk.classList.toggle('low', !ot && remain <= 5 && remain > 2.5)
    clk.classList.toggle('crit', !ot && remain <= 2.5)
    clk.classList.toggle('overtime', ot)
    const frac = Math.max(0, Math.min(1, remain / roundLen))
    V.refs.roundfill.style.width = `${!s.running ? 100 : ot ? 100 : frac * 100}%` // overtime pins the bar full (gold)
    V.refs.roundfill.classList.toggle('low', !ot && remain <= 5 && remain > 2.5)
    V.refs.roundfill.classList.toggle('crit', !ot && remain <= 2.5)
    V.refs.roundfill.classList.toggle('overtime', ot)
    // §13 the COMBO METER — count + draining grace ring + grow/shake, all derived from s.combo vs the engine
    // clock (no UI-local timer → no desync with the engine's grace decision)
    const cm = V.refs.combometer
    if (cm) {
      const lvl = s.combo.level
      const graceRemain = Math.max(0, (CRIT_GRACE_MS - (s.now - s.combo.lastAt)) / 1000)
      const live = s.running && lvl >= 2 && graceRemain > 0
      if (live) {
        const n = Math.floor(lvl)
        const chain = Math.max(0, Math.min(1, (lvl - 2) / 8)) // 0 at a 2-chain → 1 by an ~10-chain (size/shake ramp)
        cm.style.setProperty('--chain', chain.toFixed(3))
        cm.style.setProperty('--grace', (graceRemain / (CRIT_GRACE_MS / 1000)).toFixed(3))
        cm.style.setProperty('--shake-dur', `${(0.5 - chain * 0.34).toFixed(2)}s`) // faster rattle as it mounts
        const tint = s.combo.lastColor != null && s.combo.lastColor >= 0 ? `var(--c${s.combo.lastColor})` : 'var(--phos)'
        cm.style.setProperty('--tint', ot ? 'var(--gold)' : tint)
        const nEl = cm.querySelector('.cmn'); if (nEl && nEl.textContent !== String(n)) nEl.textContent = String(n)
        const lab = cm.querySelector('.cmlabel'); const wantLab = ot ? 'OVERTIME' : 'COMBO'
        if (lab && lab.textContent !== wantLab) lab.textContent = wantLab
        cm.classList.toggle('overtime', ot)
        cm.classList.toggle('shake', chain > 0.12) // only the bigger chains rattle (low combos sit + breathe)
        cm.classList.add('on')
      } else {
        cm.classList.remove('on', 'shake', 'overtime')
      }
    }
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
    // the DODGE% display (§2.3) — the live per-swing chance to slip the strike (Speed floor + banked Move pool)
    if (V.refs.dodgeval) {
      const d = dodgeReadout(s)
      V.refs.dodgeval.textContent = String(Math.round(d.chance * 100))
      V.refs.dodgedisp.classList.toggle('hot', d.pool > 0 && d.chance >= 0.5) // glows when banked dodge nears a sure slip
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
  // N1: round dtMs to an integer — the tick log is the outbox's dominant cost (unrounded floats are ~40
  // chars each). Replay stays exact: the engine consumes the SAME recorded integer. (Lossless tick
  // COALESCING is a deeper engine change — deferred; see TODO Phase 1 / the parked U5 note.)
  if (!frozen && dt > 0 && dt < 500) dispatch({ type: 'tick', dtMs: Math.round(dt) })
  updateBar()
  V.raf = requestAnimationFrame(loop)
}

// ---- end ----
function endScreen(result: 'win' | 'lose' | 'flee'): void {
  if (!V) return
  // METRICS (net/run-capture): queue this finished run for the Embassy outbox before any teardown, so
  // the tallies/state are still fresh. Best-effort + gated (a modded game records nothing); never throws.
  recordRun({
    seed: V.seed,
    classId: V.classId,
    foeId: V.state.foe?.id ?? null,
    dungeonId: V.run.dungeonId ?? DELVE?.d.dungeonId ?? null,
    mode: DAILY ? 'daily' : DELVE ? 'delve' : 'practice',
    dailyDate: DAILY?.date ?? null,
    result,
    rounds: V.state.round,
    elapsedMs: V.state.now,
    depthReached: DELVE ? DELVE.d.room : 1,
    wallClockMs: performance.now() - V.wallStart,
    pausedMs: V.pausedMs + (V.pauseStart ? performance.now() - V.pauseStart : 0),
    pauseCount: V.pauseCount,
    devMode: isDev(),
    actions: V.actions.slice(),
    dev: { ...V.dev },
    stats: { ...V.stats },
  })
  coachFinish() // close any open guided step before the end banner
  V.paused = false // a flee-confirm pause must not survive onto the end card (frozen animations)
  V.holdHud = false // a mid-choreography end must not leave the HUD frozen on stale numbers…
  exchangeExit() // …nor the field stuck in exchange mode (dim/vignette/flag/drain glows)
  updateBar() // …so paint the final read once before the loop dies
  cancelAnimationFrame(V.raf)
  if (V.refs.fleebtn) V.refs.fleebtn.style.display = 'none' // no fleeing a finished fight
  document.getElementById('ptint')?.classList.remove('low', 'crit') // drop the low-HP vignette on the end card
  // persist the hero's HP across the hub↔combat boundary (the seed of the run-attrition layer) — EXCEPT
  // the daily's standardized hero, which is ephemeral (built fresh from the seed each play) and must never
  // enter the persisted roster.
  if (!DAILY) {
    V.char.hp = Math.max(0, Math.min(V.char.maxHp, V.state.playerHP))
    upsertChar(V.char)
  }
  if (DELVE) { delveFork(result); return } // the delve owns its own end beat (the between-rooms fork)
  const again = $<HTMLButtonElement>(`<button class="cta" style="display:block;margin:0 auto">▶ Back to town</button>`)
  again.addEventListener('click', () => goScene(townScene))
  if (result === 'win') {
    // the WIN REVEAL — the spoils pop part-by-part in the breakdown ledger, then the back-to-town card lands
    playBreakdown(buildWinParts(), () => { if (V) V.refs.boardwrap.replaceChildren($(`<div class="banner win">★ Victory</div>`), again) }, 0.9)
  } else {
    const text = result === 'flee' ? '🏃 Fled' : '✖ Defeat'
    V.refs.boardwrap.replaceChildren($(`<div class="banner lose">${text}</div>`), combatChart(), again)
  }
}

/** Bank the kill's XP onto the live character (always banks; persisted immediately) + tally it for
 *  the end-of-combat / fork summary. A floating "+N XP" gives the kill its dopamine in-fight. */
function awardXP(foe: CombatState['foe']): void {
  if (!V) return
  // §C1 (FABLE §4) + the daily design: the daily's STANDARDIZED hero is ephemeral and roster-power-neutral,
  // so it earns NO XP at all — no bank, no float, no tally (persisting it also leaked a phantom "Daily
  // Challenger" per win). The daily's reward is the leaderboard, not progression. (Planned: an "open daily"
  // running your OWN character will award normally and feed a SEPARATE leaderboard; and once the Tavern
  // ships, running the daily becomes a QUEST with its own reward — see TODO Embassy/daily.)
  if (DAILY) return
  const x = computeXP(foe, V.char.level) // the outlevel penalty applies (sim §8 — farming trivial content doesn't pay)
  if (x <= 0) return
  V.stats.xp += x
  V.char = addXP(V.char, x) // pure: banks XP, capped at LEVEL_CAP
  upsertChar(V.char)
  floatBoard(`+${x} XP`, 'var(--gold)', 'enemy')
}

/** The end-of-fight WIN reveal — the same Mörk Borg ledger as the exchange breakdown, played over the
 *  spoils: Victory → Tally → Your Gear → Experience, each part popping then sliding to a corner. */
function buildWinParts(): BPart[] {
  const st = V!.stats, ch = V!.char
  const parts: BPart[] = []
  parts.push({ title: 'Victory', cls: 'sum', terms: [{ txt: `★ ${V!.state.foe.name} falls`, sub: 'the kill is yours', mag: 1, total: true }] })
  const tally: BTerm[] = []
  if (st.sets > 0) tally.push({ txt: `${st.sets} sets`, sub: 'patterns you found', mag: 0.5 })
  if (st.blocked > 0) tally.push({ txt: `${st.blocked} blocked`, sub: 'damage turned aside', mag: 0.5 })
  if (st.taken > 0) tally.push({ txt: `${st.taken} taken`, sub: 'the cost of the fight', mag: 0.5 })
  tally.push({ txt: `${st.dealt} dealt`, sub: 'total damage you did', mag: 0.9, total: true })
  parts.push({ title: 'Tally', cls: 'atk', terms: tally })
  const eq = ch.equipped
  const wpn = eq.weapon ? gearBase(eq.weapon.refId) : undefined
  const arm = eq.armor ? gearBase(eq.armor.refId) : undefined
  const casterNames = [eq.weapon, eq.armor, eq.relic, eq.trinket1, eq.trinket2]
    .map((g) => (g ? gearBase(g.refId) : undefined)).filter((b): b is NonNullable<typeof b> => !!b?.rider?.manaPerMatch)
    .map((b) => `${b.icon} ${b.name}`).join(' & ')
  const gear: BTerm[] = []
  if (st.gearDmg > 0) gear.push({ txt: `+${st.gearDmg} damage`, sub: wpn ? `${wpn.icon} ${wpn.name}` : 'your weapon', mag: 0.6 })
  if (st.gearBlock > 0) gear.push({ txt: `+${st.gearBlock} block`, sub: arm ? `${arm.icon} ${arm.name}` : 'your armor', mag: 0.6 })
  if (st.gearMana > 0) gear.push({ txt: `+${st.gearMana} mana`, sub: casterNames || 'caster gear', mag: 0.55 })
  if (gear.length) { gear[gear.length - 1].total = true; parts.push({ title: 'Your Gear', cls: 'abil', terms: gear }) }
  const ready = pendingLevels(ch)
  const xpTerms: BTerm[] = []
  if (ready > 0) xpTerms.push({ txt: `⬆ ${ready} level-up${ready > 1 ? 's' : ''}`, sub: 'allocate in town', mag: 0.6 })
  xpTerms.push({ txt: `✦ +${st.xp} XP`, sub: ch.level >= LEVEL_CAP ? '★ max level' : `Lv ${ch.level} · ${ch.xp}/${xpForLevel(ch.level)}`, mag: 0.9, total: true })
  parts.push({ title: 'Experience', cls: 'sum', terms: xpTerms })
  return parts
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
  // how much your GEAR CHOICES paid off this fight — names the weapon/armor type so the player sees the impact
  const eq = ch.equipped
  const wpn = eq.weapon ? gearBase(eq.weapon.refId) : undefined
  const arm = eq.armor ? gearBase(eq.armor.refId) : undefined
  // mana comes from whichever CASTER pieces are equipped (wand/staff · robe · focus) — name them
  const casters = [eq.weapon, eq.armor, eq.relic, eq.trinket1, eq.trinket2]
    .map((g) => (g ? gearBase(g.refId) : undefined))
    .filter((b): b is NonNullable<typeof b> => !!b && !!b.rider?.manaPerMatch)
  const casterNames = casters.map((b) => `${b.icon} ${b.name}`).join(' & ')
  const gearBits: string[] = []
  if (st.gearDmg > 0) gearBits.push(`${wpn ? `${wpn.icon} ${wpn.name}` : 'Weapon'} added <b>+${st.gearDmg}</b> damage`)
  if (st.gearBlock > 0) gearBits.push(`${arm ? `${arm.icon} ${arm.name}` : 'Armor'} added <b>+${st.gearBlock}</b> block`)
  if (st.gearMana > 0) gearBits.push(`${casterNames || 'Caster gear'} channeled <b>+${st.gearMana}</b> mana`)
  const gearLine = gearBits.length ? `<div class="sx-gear">your gear: ${gearBits.join(' · ')}</div>` : ''
  return $(`<div class="summary">${bars}${gearLine}<div class="summary-xp"><span class="sx-lab">✦ +${V!.stats.xp} XP</span>${xpLine}</div>${readyLine}</div>`)
}

/* ---- THE BETWEEN-ROOMS FORK — the delve's heartbeat (CRAWL §2 / §6) ----
   Win → loot (the real category-first roll: gold/consumables/gear, `loot.rollRoomLoot`) into the
   satchel + the fork: press on or carry the spoils home. Flee → the same fork at a price: no spoils,
   the next chamber rerolled, the elite sawtooth reset. Boss win → the dungeon is CLEARED (the run's
   best exit) + the marquee gear. Death → the run + satchel + carried gold are lost where you fell,
   plus the ~12% bank tithe (XP always banks). Still TODO from the exit ladder: the parting blow on
   flee (TODO post-review Stage 3). */
/** The dungeon-clear MARQUEE reveal — the headline rare+ piece (§3). */
function marqueeCardEl(g: GearInstance): HTMLElement {
  const b = gearBase(g.refId)
  const aff = g.affixes.length ? g.affixes.map(affixShort).join(' · ') : '—'
  return $(`<div class="lootcard gearloot marquee" ${gearTip(g)}><span class="loot-lab r-${g.rarity}">★ marquee · ${g.rarity}</span><span class="gs-ic r-${g.rarity}">${b?.icon ?? '🎁'}</span><div class="loot-id"><div class="ln r-${g.rarity}">${b?.name ?? g.refId}</div><div class="ld">${aff}</div></div></div>`)
}

/* ============================================================
   THE LOOT-MANAGEMENT scene (CRAWL §3) — the short triage at the end of every safe run: keep each
   piece (→ Storage) or sell it (→ gold @ sell-back). Lists the found gear + every surviving satchel
   consumable (carried-in AND looted). Reads the live DELVE; banks the run gold + the sale proceeds +
   the kept items, then ends the run (DELVE = null) back to town. Death skips this — all is lost there.
   ============================================================ */
function lootManageScene(root: HTMLElement, char: SavedChar): void {
  if (!DELVE) { goScene(townScene); return }
  const runGold = DELVE.gold
  const foundGear = DELVE.gearFound.slice()
  const consCount = new Map<string, number>() // refId → how many in the satchel
  for (const id of DELVE.bag) if (CONSUMABLES[id]) consCount.set(id, (consCount.get(id) ?? 0) + 1)

  const gearSell = new Set<string>() // gear uids marked sell
  const consSell = new Map<string, number>() // refId → how many of the stack to sell
  let banked = false // latch — the confirm banks exactly once (guards a double-click before goScene tears down)

  const wrap = $(`<div class="wrap"></div>`)
  wrap.appendChild($(`<h1>set.core</h1>`))
  wrap.appendChild($(`<div class="sub">spoils · triage — keep or sell</div>`))
  const panel = $(`<div class="panel"></div>`)
  wrap.appendChild(panel)
  const footer = $(`<div class="hubfoot"></div>`)
  wrap.appendChild(footer)
  root.appendChild(wrap)

  const acct = loadBank()
  const nothing = !foundGear.length && !consCount.size

  const render = (): void => {
    panel.innerHTML = ''; footer.innerHTML = ''
    // compute the split
    const keepGear = foundGear.filter((g) => !gearSell.has(g.uid))
    const keepCons: string[] = []
    let saleGold = 0
    for (const g of foundGear) if (gearSell.has(g.uid)) saleGold += sellValue(g)
    for (const [refId, n] of consCount) {
      const sell = Math.min(n, consSell.get(refId) ?? 0)
      for (let i = 0; i < n - sell; i++) keepCons.push(refId)
      saleGold += sell * sellValueOfConsumable(refId)
    }
    const keptCount = keepGear.length + keepCons.length
    const free = acct.storageCap - storageCount(acct)
    const overflow = Math.max(0, keptCount - free)

    panel.appendChild($(`<div class="sub" style="margin:0 0 10px">Carrying <b>${runGold}🪙</b> from the run · vault <b>${acct.gold}🪙</b></div>`))
    if (nothing) panel.appendChild($(`<div class="sheet-soon">No spoils to triage — just the gold you carried.</div>`))

    // GEAR
    if (foundGear.length) {
      panel.appendChild($(`<div class="lm-hd">Gear (${foundGear.length})</div>`))
      const list = $(`<div class="baglist"></div>`)
      for (const g of foundGear) {
        const base = gearBase(g.refId)!
        const aff = g.affixes.length ? g.affixes.map(affixShort).join(' · ') : '—'
        const sell = gearSell.has(g.uid)
        const row = $(`<div class="gp-row${sell ? ' selling' : ''}" ${gearTip(g)}><span class="gs-ic r-${g.rarity}">${base.icon}</span><div class="gs-meta"><div class="gs-n r-${g.rarity}">${base.name}</div><div class="gs-a">${RARITY_LABEL[g.rarity]} · ${aff}</div></div><button class="lm-toggle">${sell ? `sell 🪙${sellValue(g)}` : 'keep'}</button></div>`)
        row.querySelector('.lm-toggle')!.addEventListener('click', () => { sell ? gearSell.delete(g.uid) : gearSell.add(g.uid); render() })
        list.appendChild(row)
      }
      panel.appendChild(list)
    }

    // CONSUMABLES (stacked; a sell-count stepper per type)
    if (consCount.size) {
      panel.appendChild($(`<div class="lm-hd">Consumables (${DELVE!.bag.filter((id) => CONSUMABLES[id]).length})</div>`))
      const list = $(`<div class="baglist"></div>`)
      for (const [refId, n] of consCount) {
        const c = CONSUMABLES[refId]
        const sell = Math.min(n, consSell.get(refId) ?? 0)
        const tint = c.color != null ? `var(--c${c.color})` : 'var(--line2)'
        const row = $(`<div class="gp-row" ${consTip(refId)}><span class="cons-slot${c.kind === 'scroll' ? ' scroll' : ''}" style="--cc:${tint}"><span class="cons-ic">${c.icon}</span></span><div class="gs-meta"><div class="gs-n">${c.name} <span class="bag-x">×${n}</span></div><div class="gs-a">keep ${n - sell} · sell ${sell}${sell ? ` (🪙${sell * sellValueOfConsumable(refId)})` : ''}</div></div><div class="stepper"><button class="st-mns"${sell === 0 ? ' disabled' : ''}>−</button><b>${sell}</b><button class="st-pls"${sell >= n ? ' disabled' : ''}>+</button></div></div>`)
        row.querySelector('.st-mns')!.addEventListener('click', () => { consSell.set(refId, Math.max(0, sell - 1)); render() })
        row.querySelector('.st-pls')!.addEventListener('click', () => { consSell.set(refId, Math.min(n, sell + 1)); render() })
        list.appendChild(row)
      }
      panel.appendChild(list)
    }

    // tally
    const tally = $(`<div class="lm-tally"></div>`)
    tally.appendChild($(`<div>Sell proceeds <b>+${saleGold}🪙</b> · keeping <b>${keptCount}</b> item${keptCount === 1 ? '' : 's'} · vault after <b>${acct.gold + runGold + saleGold}🪙</b></div>`))
    if (overflow > 0) tally.appendChild($(`<div class="lm-warn">⚠ Storage has ${free} free — ${overflow} kept item${overflow === 1 ? '' : 's'} won’t fit and will be auto-sold.</div>`))
    panel.appendChild(tally)

    // quick toggles + confirm
    if (!nothing) {
      const quick = $(`<div class="lm-quick"></div>`)
      const keepAll = $<HTMLButtonElement>(`<button class="cta ghost">Keep all</button>`)
      keepAll.addEventListener('click', () => { gearSell.clear(); consSell.clear(); render() })
      const sellAll = $<HTMLButtonElement>(`<button class="cta ghost">Sell all</button>`)
      sellAll.addEventListener('click', () => { for (const g of foundGear) gearSell.add(g.uid); for (const [refId, n] of consCount) consSell.set(refId, n); render() })
      quick.append(keepAll, sellAll)
      panel.appendChild(quick)
    }

    const confirm = $<HTMLButtonElement>(`<button class="cta bob">🏠 Bank & return to town</button>`)
    confirm.addEventListener('click', () => {
      if (banked) return
      banked = true
      const res = resolveLootKeep(loadBank(), runGold, saleGold, keepGear, keepCons)
      saveBank(res.account)
      DELVE = null; clearDelve() // spoils banked via triage — drop the recovery checkpoint before town
      goScene(townScene)
    })
    footer.appendChild(confirm)
  }
  render()
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
    const { account, outcome } = resolveDelveExit(loadBank(), DELVE, 'death')
    DELVE = null; clearDelve() // resolve the checkpoint the instant death forfeits the satchel — recovery must never return it
    saveBank(account)
    const lost = outcome.goldLost
    const tithe = outcome.tithe // 12% of BANKED gold forfeit (the exit ladder, §6)
    const home = $<HTMLButtonElement>(`<button class="cta" style="display:block;margin:0 auto">🏠 Back to town</button>`)
    home.addEventListener('click', () => goScene(townScene))
    const tolls = [`Your satchel${lost > 0 ? ` and ${lost}🪙 carried` : ''} is lost where you fell.`, tithe > 0 ? `The recovery tithe takes ${tithe}🪙 from your vault.` : ''].filter(Boolean).join(' ')
    host.replaceChildren(
      $(`<div class="banner lose">✖ Slain — room ${room} claims you</div>`),
      $(`<div class="forksub">${tolls}</div>`),
      combatChart(), home,
    )
    return
  }

  // a WIN rolls its loot ONCE now (gold/gear/satchel banked into the run); flee forfeits the room.
  const isBoss = result === 'win' && DELVE.tier === 'boss'
  const loot = result === 'win' ? applyRoomLoot(DELVE, V.state.foe, systemRng) : null
  const marquee = isBoss ? rollMarqueeGear(V.state.foe, DELVE.d.room, systemRng) : undefined // §3 dungeon-clear MARQUEE
  if (marquee) DELVE.gearFound.push(marquee)
  saveDelve(DELVE) // U2: checkpoint the between-rooms rest (survivors reconciled above) for recovery

  // the screen builder — runs directly for a flee, or as the ledger-reveal's release for a win
  const render = (): void => {
    if (!V || !DELVE) return
    // BOSS DOWN — the dungeon is cleared (the run's best exit); the run-gold + gear bank now
    if (isBoss) {
      const mqEl = marqueeCardEl(marquee!)
      const lootEl = lootRevealEl(loot!)
      const carried = DELVE.gold
      const gearN = DELVE.gearFound.length
      const home = $<HTMLButtonElement>(`<button class="cta bob" style="display:block;margin:0 auto">🏆 Carry the spoils home</button>`)
      home.addEventListener('click', () => goScene((r) => lootManageScene(r, char))) // triage, then bank
      host.replaceChildren(
        $(`<div class="banner win">🏆 ${dgName} — CLEARED in ${room} rooms</div>`),
        mqEl, lootEl, $(satchelHTML(DELVE.bag)),
        $(`<div class="forksub">Carrying <b>${carried}🪙</b>${gearN ? ` + <b>${gearN}</b> gear` : ''} — triage your spoils next.</div>`),
        combatChart(), home,
      )
      return
    }
    // THE FORK — press on or go home (between rooms only, after a clear; flee pays its price here)
    const fork = $(`<div class="forkwrap"></div>`)
    if (result === 'win') {
      fork.appendChild($(`<div class="banner win">★ Room ${room} cleared</div>`))
      fork.appendChild(lootRevealEl(loot!))
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
    const home = $<HTMLButtonElement>(`<button class="cta ghost">🏠 Cash out (${DELVE.gold}🪙${gearN ? ` + ${gearN} gear` : ''})</button>`)
    home.addEventListener('click', () => goScene((r) => lootManageScene(r, char))) // triage spoils → bank
    const deeper = $<HTMLButtonElement>(`<button class="cta bob">▶ Delve deeper</button>`)
    deeper.addEventListener('click', () => goScene((r) => delveRoom(r, char)))
    btns.append(home, deeper)
    fork.appendChild(btns)
    host.replaceChildren(fork)
  }

  // a WIN reveals the spoils in the ledger (gold → loot → marquee → XP) first, then lands the screen
  if (result === 'win') playBreakdown(buildLootParts(loot!, marquee), render, 0.9)
  else render() // flee — no spoils, no reveal
}

/** The fork's static loot list, built from an already-rolled DelveLoot (no re-roll; see delve-run.ts). */
function lootRevealEl(loot: DelveLoot): HTMLElement {
  const wrap = $(`<div class="lootreveal"></div>`)
  if (loot.gold > 0) wrap.appendChild($(`<div class="lootgold">🪙 <b>+${loot.gold}</b> gold</div>`))
  for (const g of loot.gear) {
    const base = gearBase(g.refId)
    const affixTxt = g.affixes.length ? g.affixes.map(affixShort).join(' · ') : '—'
    wrap.appendChild($(`<div class="lootcard gearloot" ${gearTip(g)}><span class="loot-lab r-${g.rarity}">${g.rarity}</span><span class="gs-ic r-${g.rarity}">${base?.icon ?? '🎁'}</span><div class="loot-id"><div class="ln r-${g.rarity}">${base?.name ?? g.refId}</div><div class="ld">${affixTxt}</div></div></div>`))
  }
  for (const id of loot.added) {
    const c = CONSUMABLES[id]; if (!c) continue
    const tint = c.color != null ? `var(--c${c.color})` : 'var(--line2)'
    wrap.appendChild($(`<div class="lootcard" ${consTip(id)}><span class="loot-lab">loot</span><span class="cons-slot${c.kind === 'scroll' ? ' scroll' : ''}" style="--cc:${tint}"><span class="cons-ic">${c.icon}</span></span><div class="loot-id"><div class="ln">${c.name}</div><div class="ld">${c.desc}</div></div></div>`))
  }
  for (const id of loot.left) { const c = CONSUMABLES[id]; if (c) wrap.appendChild($(`<div class="forksub">Satchel full — the ${c.name} is left behind.</div>`)) }
  if (!wrap.children.length) wrap.appendChild($(`<div class="forksub">The room holds nothing of value.</div>`))
  if (isDev() && loot.trace.length) wrap.appendChild($(`<div class="devpanel devtrace"><span class="dvl">loot roll</span>${loot.trace.map((l) => `<span>${l}</span>`).join('')}</div>`))
  return wrap
}
/** The delve-win LEDGER reveal parts (CRAWL §3): gold → gear/satchel drops → the boss marquee → XP. Same
 *  Mörk Borg grammar as the exchange; played before the fork so the spoils land beat by beat. */
function buildLootParts(loot: DelveLoot, marquee?: GearInstance): BPart[] {
  const parts: BPart[] = []
  if (loot.gold > 0) parts.push({ title: 'Gold', cls: 'sum', terms: [{ txt: `🪙 +${loot.gold}`, sub: 'into the run purse', mag: 0.8, total: true }] })
  const drops: BTerm[] = []
  for (const g of loot.gear) { const b = gearBase(g.refId); drops.push({ txt: `${b?.icon ?? '🎁'} ${b?.name ?? g.refId}`, sub: `${g.rarity}${g.affixes.length ? ` · ${g.affixes.map(affixShort).join(' · ')}` : ''}`, mag: 0.7 }) }
  for (const id of loot.added) { const c = CONSUMABLES[id]; if (c) drops.push({ txt: `${c.icon} ${c.name}`, sub: 'into the satchel', mag: 0.5 }) }
  if (drops.length) { drops[drops.length - 1].total = true; parts.push({ title: 'Loot', cls: 'abil', terms: drops }) }
  if (marquee) { const b = gearBase(marquee.refId); parts.push({ title: 'Marquee', cls: 'mana', terms: [{ txt: `★ ${b?.icon ?? '🎁'} ${b?.name ?? marquee.refId}`, sub: `${marquee.rarity} · the dungeon's prize${marquee.affixes.length ? ` · ${marquee.affixes.map(affixShort).join(' · ')}` : ''}`, mag: 1, total: true }] }) }
  const ch = V!.char, st = V!.stats
  const ready = pendingLevels(ch)
  const xpTerms: BTerm[] = []
  if (ready > 0) xpTerms.push({ txt: `⬆ ${ready} level-up${ready > 1 ? 's' : ''}`, sub: 'allocate in town', mag: 0.6 })
  xpTerms.push({ txt: `✦ +${st.xp} XP`, sub: ch.level >= LEVEL_CAP ? '★ max level' : `Lv ${ch.level} · ${ch.xp}/${xpForLevel(ch.level)}`, mag: 0.9, total: true })
  parts.push({ title: 'Experience', cls: 'sum', terms: xpTerms })
  return parts
}

/** The run satchel as a chip row (the carried consumables — next room's combat loadout). */
function satchelHTML(bag: string[]): string {
  const chips = bag.map((id) => {
    const c = CONSUMABLES[id]
    if (!c) return ''
    const tint = c.color != null ? `var(--c${c.color})` : 'var(--line2)'
    return `<span class="cons-slot${c.kind === 'scroll' ? ' scroll' : ''}" style="--cc:${tint}" ${consTip(id)}><span class="cons-ic">${c.icon}</span></span>`
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
