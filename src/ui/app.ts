/* ui/app — a functional, playable UI over the engine. Renders the board/HUD, turns clicks into
   `completeSet` actions, runs the clock via `tick`, and interprets CombatEvents into feedback.
   Intentionally a clean rebuild (not pixel-parity with the prototype). Layout: a compact board on the
   left + a side rail (abilities/tactics stub, combat log) on the right — the abilities panel goes live
   in step 5. Plays the reactive board game: matches, traps & tricks, Tactics meter, enemy clock, gauntlets. */

import { systemRng, type Rng } from '../core/rng'
import { type Card, isSet, third, keyOf } from '../core/affine'
import { findSets } from '../core/sets'
import type { GenConfig } from '../core/generate'
import { GAMEDATA } from '../data/game-data'
import type { Dungeon } from '../data/schema'
import { CLASSES, classById } from '../data/classes'
import { ABILITIES, canAfford } from '../engine/abilities'
import { PASSIVES } from '../engine/passives'
import { assembleFoe, pickWeightedFoe } from '../engine/foe'
import { createCombat, reduce, colsForN, COMBAT_GEN, type Deps, type CombatAction } from '../engine/combat'
import type { CombatState } from '../engine/state'
import { TACTICS_GOAL } from '../engine/state'
import type { CombatEvent } from '../engine/events'

const GEN: GenConfig = COMBAT_GEN
const GLYPH = ['⚔', '🛡', '➤'] // attack / defend / move
const $ = <T extends HTMLElement>(html: string): T => {
  const t = document.createElement('template')
  t.innerHTML = html.trim()
  return t.content.firstChild as T
}

interface View {
  root: HTMLElement
  deps: Deps
  state: CombatState
  /** the session action log — every mutation goes through here (the step-6 seam) */
  actions: CombatAction[]
  classId: string
  loadout: string[] // the chosen class's ability ids (the active grid)
  selected: number[]
  raf: number
  lastT: number
  boardSig: string
  refs: Record<string, HTMLElement>
}
let V: View | null = null

export function mountApp(root: HTMLElement): void {
  startScreen(root)
}

// ---- start screen ----
function startScreen(root: HTMLElement): void {
  root.innerHTML = ''
  const wrap = $(`<div class="wrap"></div>`)
  wrap.appendChild($(`<h1>set.core</h1>`))
  wrap.appendChild($(`<div class="sub">action-resolution prototype · new client</div>`))
  const panel = $(`<div class="panel"></div>`)
  const rowEl = $(`<div class="row"></div>`)
  const dCol = $(`<div><label>Dungeon</label></div>`)
  const dSel = $<HTMLSelectElement>(`<select id="dungeon"></select>`)
  for (const id in GAMEDATA.dungeons) dSel.appendChild($(`<option value="${id}">${GAMEDATA.dungeons[id].name}</option>`))
  dCol.appendChild(dSel)
  const fCol = $(`<div><label>Foe</label></div>`)
  const fSel = $<HTMLSelectElement>(`<select id="foe"></select>`)
  fCol.appendChild(fSel)
  rowEl.appendChild(dCol)
  rowEl.appendChild(fCol)
  panel.appendChild(rowEl)

  // class picker
  let classId = CLASSES[0].id
  panel.appendChild($(`<label style="margin-top:14px">Class</label>`))
  const cgrid = $(`<div class="classgrid"></div>`)
  const blurb = $(`<div class="classblurb"></div>`)
  const paintClass = () => {
    cgrid.querySelectorAll('.classcard').forEach((el) => el.classList.toggle('sel', (el as HTMLElement).dataset.cid === classId))
    blurb.innerHTML = classBlurbHTML(classId)
  }
  for (const c of CLASSES) {
    const card = $(`<div class="classcard" data-cid="${c.id}"><div class="ci">${c.icon}</div><div class="cn">${c.name}</div></div>`)
    card.addEventListener('click', () => { classId = c.id; paintClass() })
    cgrid.appendChild(card)
  }
  panel.appendChild(cgrid)
  panel.appendChild(blurb)
  paintClass()

  const cta = $<HTMLButtonElement>(`<button class="cta">▶ Begin combat</button>`)
  panel.appendChild(cta)
  wrap.appendChild(panel)
  wrap.appendChild($(`<div class="sub" style="margin-top:18px">Click cards to build a set (same-or-all-different on every trait). Teal halos show set-mates.</div>`))
  root.appendChild(wrap)

  const fillFoes = () => {
    const dg = GAMEDATA.dungeons[dSel.value]
    fSel.innerHTML = ''
    if (dg.sequence?.length) fSel.appendChild($(`<option value="sequence">▶ Run the gauntlet · ${dg.sequence.length} foes</option>`))
    dg.enemy_table.forEach((e) => fSel.appendChild($(`<option value="foe:${e.foe}">${GAMEDATA.creatures[e.foe]?.name ?? e.foe}</option>`)))
    if (dg.boss) fSel.appendChild($(`<option value="foe:${dg.boss}">☠ ${GAMEDATA.creatures[dg.boss]?.name}</option>`))
    fSel.value = dg.sequence?.length ? 'sequence' : dg.default_foe ? `foe:${dg.default_foe}` : fSel.options[0]?.value ?? ''
  }
  dSel.addEventListener('change', fillFoes)
  fillFoes()
  cta.addEventListener('click', () => begin(root, dSel.value, fSel.value, classId))
}

/** Loadout summary for the class blurb: tagline + ability names + passive name. */
function classBlurbHTML(id: string): string {
  const c = classById(id)
  const abil = c.abilities.map((a) => ABILITIES[a]?.name).filter(Boolean).join(' · ')
  const pas = c.passives.map((p) => PASSIVES[p]?.name).filter(Boolean).join(' · ')
  return `${c.icon} <b>${c.name}</b> — ${c.blurb}<br><b>Abilities:</b> ${abil} &nbsp; <b>Passive:</b> ${pas}`
}

// ---- begin combat ----
function begin(root: HTMLElement, dungeonId: string, foeVal: string, classId: string): void {
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
  const cls = classById(classId)
  const state = createCombat({ foe, gen: GEN, passives: cls.passives, sequence, seqIdx: 0, dungeonId }, rng)
  V = { root, deps: { data: GAMEDATA, rng }, state, actions: [], classId: cls.id, loadout: cls.abilities.slice(), selected: [], raf: 0, lastT: 0, boardSig: '', refs: {} }
  buildPlay()
  renderBoard()
  updateBar()
  loop(performance.now())
}

// ---- play screen skeleton ----
function buildPlay(): void {
  if (!V) return
  V.root.innerHTML = ''
  const wrap = $(`<div class="wrap"></div>`)
  const head = $(`<div class="panel"></div>`)
  head.appendChild($(`<div class="foename" id="foename"></div>`))
  head.appendChild($(`<div class="foedesc" id="foedesc"></div>`))
  wrap.appendChild(head)

  const barP = $(`<div class="panel"></div>`)
  barP.appendChild($(`
    <div class="bar">
      <div class="gauge"><div class="lab"><span>You</span><span id="phpv"></span></div><div class="track"><span class="fill php" id="php"></span></div></div>
      <div class="gauge"><div class="lab"><span id="enemylab">Enemy</span><span id="ehpv"></span></div><div class="track"><span class="fill ehp" id="ehp"></span></div></div>
      <div class="clock" id="clock">—</div>
    </div>`))
  barP.appendChild($(`
    <div class="bar" style="margin-top:12px">
      <div class="gauge"><div class="lab"><span>Tactics</span><span id="tacv"></span></div><div class="track"><span class="fill tac" id="tac"></span></div></div>
      <div class="mana"><span style="color:var(--c0)">🔥<b id="m0">0</b></span><span style="color:var(--c1)">🌿<b id="m1">0</b></span><span style="color:var(--c2)">❄<b id="m2">0</b></span></div>
      <div class="chips"><span>🛡 <b id="block">0</b></span></div>
    </div>`))
  const strip = $(`<div class="strip" id="strip"></div>`)
  barP.appendChild(strip)
  wrap.appendChild(barP)

  // play area: compact board (left) + side rail (abilities / tactics / log) on the right
  const play = $(`<div class="play"></div>`)
  const boardWrap = $(`<div class="boardwrap" id="boardwrap"></div>`)
  const board = $(`<div class="board" id="board"></div>`)
  board.style.gridTemplateColumns = `repeat(${V.state.cols}, 1fr)`
  boardWrap.appendChild(board)
  play.appendChild(boardWrap)

  const rail = $(`<div class="rail"></div>`)
  rail.appendChild(buildCastPanel())
  const logP = $(`<div class="panel"></div>`)
  logP.appendChild($(`<label>Combat log</label>`))
  logP.appendChild($(`<div class="log" id="log"></div>`))
  rail.appendChild(logP)
  play.appendChild(rail)
  wrap.appendChild(play)
  V.root.appendChild(wrap)

  V.refs = {}
  for (const id of ['foename', 'foedesc', 'enemylab', 'phpv', 'ehpv', 'php', 'ehp', 'clock', 'tacv', 'tac', 'm0', 'm1', 'm2', 'block', 'strip', 'boardwrap', 'board', 'log', 'abilities', 'tactics', 'passives']) {
    const el = wrap.querySelector('#' + id)
    if (el) V.refs[id] = el as HTMLElement
  }
  board.addEventListener('click', onBoardClick)
  V.refs.abilities?.addEventListener('click', onAbilityClick)
  V.refs.tactics?.addEventListener('click', onTacticClick)
  renderStrip()
  updateCastables()
  V.refs.foename.textContent = V.state.foe.name + (V.state.sequence ? `  ·  ${V.state.seqIdx + 1}/${V.state.sequence.length}` : '')
  V.refs.foedesc.innerHTML = V.state.foe.desc ?? ''
}

/** The live castable panel: the class loadout (mana-gated click-to-cast), the Tactics buttons (live at
 *  full meter), and the always-on passive chips — all dispatching castAbility / useTactic to the engine. */
const MANA_ICON = ['🔥', '🌿', '❄']
const TAC_BTNS: { k: string; label: string; flee?: boolean }[] = [
  { k: 'strike', label: '⚔ Strike' }, { k: 'dodge', label: '🛡 Dodge' }, { k: 'flee', label: '🏃 Flee', flee: true },
  { k: 'heat', label: '🔥 Heat' }, { k: 'chill', label: '❄ Chill' }, { k: 'wild', label: '🌿 Wild' },
]
function buildCastPanel(): HTMLElement {
  const cls = classById(V!.classId)
  const panel = $(`<div class="panel"></div>`)
  panel.appendChild($(`<div class="panelhd"><label>Abilities · ${cls.name}</label><span class="stub-note">spend mana</span></div>`))
  const grid = $(`<div class="ability-grid" id="abilities"></div>`)
  for (const id of V!.loadout) {
    const a = ABILITIES[id]
    if (!a) continue
    const cost = a.cost.map((c, i) => (c > 0 ? `${MANA_ICON[i]}${c}` : '')).filter(Boolean).join(' ')
    grid.appendChild($(`<div class="ab-slot" data-ab="${id}" title="${a.name} — ${a.desc}"><div class="abi">${a.icon}</div><div class="abn">${a.name}</div><div class="abc">${cost}</div></div>`))
  }
  panel.appendChild(grid)
  panel.appendChild($(`<div class="panelhd" style="margin-top:12px"><label>Tactics</label><span class="stub-note">at full meter</span></div>`))
  const row = $(`<div class="tactics-row" id="tactics"></div>`)
  for (const t of TAC_BTNS) row.appendChild($(`<div class="tac-btn${t.flee ? ' flee' : ''}" data-tac="${t.k}">${t.label}</div>`))
  panel.appendChild(row)
  const pas = $(`<div class="passives" id="passives"></div>`)
  for (const id of V!.state.passives) {
    const p = PASSIVES[id]
    if (p) pas.appendChild($(`<div class="pchip" data-passive="${id}" title="${p.name} — ${p.desc}"><span class="pi">${p.icon}</span>${p.name}</div>`))
  }
  if (V!.state.passives.length) panel.appendChild(pas)
  return panel
}

function renderStrip(): void {
  if (!V) return
  const strip = V.refs.strip
  strip.innerHTML = ''
  const trigs = V.state.foe.triggers
  if (!trigs.length) return
  const hasTrick = trigs.some((t) => t.kind === 'trick')
  strip.appendChild($(`<span class="lab">${hasTrick ? '⚠ Traps · ✦ Tricks' : '⚠ Enemy traps'}</span>`))
  for (const t of trigs) {
    const trick = t.kind === 'trick'
    const d = $(`<div class="trig${trick ? ' trick' : ''}"><span>${t.icon ?? (trick ? '✦' : '⚠')}</span><span class="tn">${t.name}</span>${t.desc ? `<span class="td">${trick ? 'aim: ' : ''}${t.desc}</span>` : ''}</div>`)
    strip.appendChild(d)
  }
}

// ---- board rendering ----
function boardSignature(s: CombatState): string {
  return s.board.map((c) => (c ? keyOf(c) : -1)).join(',') + '|' + [...s.locked.keys()].sort((a, b) => a - b).join(',')
}
function renderBoard(): void {
  if (!V) return
  const s = V.state
  const board = V.refs.board
  board.innerHTML = ''
  const sets = findSets(s.board)
  const mates = glowSet(s, V.selected, sets)
  s.board.forEach((c, i) => {
    if (!c) {
      board.appendChild($(`<div class="card empty"></div>`))
      return
    }
    const locked = s.locked.has(i)
    const cls = ['card']
    if (V!.selected.includes(i)) cls.push('sel')
    else if (mates.complete === i) cls.push('complete')
    else if (mates.set.has(i)) cls.push('mate')
    if (locked) cls.push('locked')
    const el = $(`<div class="${cls.join(' ')}" data-i="${i}" style="--cc:var(--c${c[0]})"><div class="glyph">${GLYPH[c[1]]}</div><div class="pips">${'<i></i>'.repeat(c[3] + 1)}</div>${locked ? '<span class="lock">🔒</span>' : ''}</div>`)
    board.appendChild(el)
  })
  V.boardSig = boardSignature(s)
}

/** Which board slots are set-mates of the current selection (for the teal glow). */
function glowSet(s: CombatState, sel: number[], sets: [number, number, number][]): { set: Set<number>; complete: number } {
  const out = new Set<number>()
  let complete = -1
  if (sel.length === 1) {
    for (const t of sets) if (t.includes(sel[0])) for (const j of t) if (j !== sel[0]) out.add(j)
  } else if (sel.length === 2) {
    const a = s.board[sel[0]]
    const b = s.board[sel[1]]
    if (a && b) {
      const want = keyOf(third(a, b))
      s.board.forEach((c, i) => {
        if (c && !sel.includes(i) && !s.locked.has(i) && keyOf(c) === want) complete = i
      })
    }
  }
  return { set: out, complete }
}

// ---- input ----
function onBoardClick(e: Event): void {
  if (!V || !V.state.running) return
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
      const sel = V.selected.slice() as [number, number, number]
      V.selected = []
      dispatch({ type: 'completeSet', slots: sel })
    } else {
      // misread — shake + clear
      V.selected.forEach((j) => V!.refs.board.querySelector(`[data-i="${j}"]`)?.classList.add('bad'))
      log('A misread — those three are not a set.', 'foe')
      setTimeout(() => {
        if (V) {
          V.selected = []
          renderBoard()
        }
      }, 320)
      return
    }
  }
  renderBoard()
}

function onAbilityClick(e: Event): void {
  if (!V || !V.state.running) return
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

function onTacticClick(e: Event): void {
  if (!V || !V.state.running || !V.state.tacticsArmed) return
  const el = (e.target as HTMLElement).closest('.tac-btn') as HTMLElement | null
  const key = el?.dataset.tac
  if (!key) return
  if (key === 'flee' && !confirm('Flee combat?\n\nYou forfeit this encounter.')) return
  dispatch({ type: 'useTactic', key })
}

/** Refresh ability/tactic affordances — runs every frame so they track mana + the armed meter live. */
function updateCastables(): void {
  if (!V) return
  const s = V.state
  V.refs.abilities?.querySelectorAll<HTMLElement>('.ab-slot').forEach((el) => {
    const a = el.dataset.ab ? ABILITIES[el.dataset.ab] : undefined
    el.classList.toggle('ready', !!a && s.running && canAfford(s, a.cost))
  })
  V.refs.tactics?.querySelectorAll<HTMLElement>('.tac-btn').forEach((el) => {
    el.classList.toggle('armed', s.running && s.tacticsArmed)
  })
}

// ---- dispatch + event interpretation ----
function dispatch(action: CombatAction): void {
  if (!V) return
  const { state, events } = reduce(V.state, action, V.deps)
  V.state = state
  V.actions.push(action) // record the session log (the seam): a server could replay these
  interpret(events)
  if (boardSignature(state) !== V.boardSig) renderBoard()
  updateBar()
}

function interpret(events: CombatEvent[]): void {
  if (!V) return
  const MANA = ['Fire', 'Nature', 'Frost']
  for (const e of events) {
    switch (e.type) {
      case 'enemyDamaged':
        if (e.immune) log('Swords pass through — only magic bites this foe.', 'foe')
        else if (e.magic) log(`Your magic drains <b>${e.amount}</b>.`, 'you')
        else log(`You strike for <b>${e.amount}</b>.`, 'you')
        break
      case 'enemyHealed':
        log(`The ${V.state.foe.name} heals <b>${e.amount}</b>.`, 'foe')
        break
      case 'playerHealed':
        log(`You recover <b>${e.amount}</b> HP.`, 'you')
        break
      case 'abilityCast':
        log(`You cast <b>${ABILITIES[e.id]?.name ?? e.id}</b>.`, 'you')
        break
      case 'abilityFizzled':
        log(`<b>${ABILITIES[e.id]?.name ?? e.id}</b> fizzles — no target.`, 'foe')
        break
      case 'passiveProc':
        pulsePassive(e.id)
        break
      case 'tacticUsed':
        if (e.key !== 'flee') log(`Tactic — <b>${e.key[0].toUpperCase()}${e.key.slice(1)}</b>!`, 'you')
        break
      case 'fled':
        endScreen('flee')
        break
      case 'manaDrained':
        log(`The foe drains your ${['Fire', 'Nature', 'Frost'][e.color]} mana.`, 'foe')
        break
      case 'setResolved': {
        // give every match a line; a damaging match already logged its strike (enemyDamaged)
        if (e.damage > 0) break
        const parts: string[] = []
        if (e.block > 0) parts.push(`+${e.block} block`)
        if (e.boot > 0) parts.push(`+${e.boot}s clock`)
        const m = e.mana.findIndex((x) => x === 3)
        if (m >= 0) parts.push(`+3 ${MANA[m]}`)
        else if (e.mana.some((x) => x > 0)) parts.push('+1 each mana')
        log(`Set — ${parts.join(' · ') || 'resolved'}.`, 'you')
        break
      }
      case 'playerDamaged':
        log(`The ${V.state.foe.name} hits you for <b>${e.amount}</b>${e.absorbed ? ` (${e.absorbed} blocked)` : ''}.`, 'foe')
        flash('wound')
        break
      case 'triggerSprung': {
        const trick = e.trigger.kind === 'trick'
        log(`<b>${e.trigger.name}</b> — ${e.label}.`, trick ? 'trick' : 'foe')
        flash(trick ? 'trick' : 'trap')
        break
      }
      case 'tacticsArmed':
        log('Your <b>Tactics</b> meter is full — a window of decisive moves.', 'you')
        break
      case 'foeChanged':
        log(`The foe falls — <b>${e.name}</b> rises next.`, 'win')
        renderStrip()
        if (V.refs.foename) V.refs.foename.textContent = e.name + (V.state.sequence ? `  ·  ${V.state.seqIdx + 1}/${V.state.sequence.length}` : '')
        if (V.refs.foedesc) V.refs.foedesc.innerHTML = V.state.foe.desc ?? ''
        renderBoard()
        break
      case 'won':
        endScreen('win')
        break
      case 'lost':
        endScreen('lose')
        break
    }
  }
}

function flash(kind: 'trap' | 'trick' | 'wound'): void {
  if (!V) return
  const w = V.refs.boardwrap
  w.classList.remove('flash-trap', 'flash-trick', 'flash-wound')
  void w.offsetWidth
  w.classList.add('flash-' + kind)
}

function log(html: string, cls: string): void {
  if (!V) return
  const line = $(`<div class="${cls}">${html}</div>`)
  V.refs.log.prepend(line)
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
  V.refs.tac.style.width = `${(s.tactics / TACTICS_GOAL) * 100}%`
  V.refs.tac.classList.toggle('armed', s.tacticsArmed)
  V.refs.tacv.textContent = `${Math.round(s.tactics * 10) / 10}/${TACTICS_GOAL}`
  V.refs.m0.textContent = String(s.mana[0])
  V.refs.m1.textContent = String(s.mana[1])
  V.refs.m2.textContent = String(s.mana[2])
  V.refs.block.textContent = String(s.block)
  const remain = Math.max(0, (s.nextAttackAt - s.now) / 1000)
  const clk = V.refs.clock
  clk.textContent = s.running ? `${Math.ceil(remain)}s` : '—'
  clk.classList.toggle('low', remain <= 5 && remain > 2.5)
  clk.classList.toggle('crit', remain <= 2.5)
  updateCastables()
}

// ---- the clock loop ----
function loop(t: number): void {
  if (!V) return
  if (!V.state.running) return
  const dt = V.lastT ? t - V.lastT : 0
  V.lastT = t
  if (dt > 0 && dt < 500) dispatch({ type: 'tick', dtMs: dt })
  updateBar()
  V.raf = requestAnimationFrame(loop)
}

// ---- end ----
function endScreen(result: 'win' | 'lose' | 'flee'): void {
  if (!V) return
  cancelAnimationFrame(V.raf)
  const text = result === 'win' ? '★ Victory' : result === 'flee' ? '🏃 Fled' : '✖ Defeat'
  const banner = $(`<div class="banner ${result === 'win' ? 'win' : 'lose'}">${text}</div>`)
  const again = $<HTMLButtonElement>(`<button class="cta" style="display:block;margin:0 auto">▶ Back to start</button>`)
  const root = V.root
  V.refs.boardwrap.replaceChildren(banner, again)
  again.addEventListener('click', () => {
    V = null
    startScreen(root)
  })
}
