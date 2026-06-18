/* sim/balance-sim.mjs — THE BALANCE WORKSHOP (BALANCE.md §6; gates the rebalance pass).
   Self-contained headless model of the PROPOSED unified verb↔stat↔defense model. Like
   progression-sim.mjs it deliberately does NOT import src/ — it derives constants that don't
   exist in code yet. Deterministic: seeded mulberry32 throughout.

   Run: node sim/balance-sim.mjs

   The model under test (BALANCE.md §2):
     • Attack·Power → damage dealt          (banked → rollover)
     • Defend·Endurance → Block             (deterministic, partial, THIS round only — NO carry)
     • Move·Speed → Dodge                   (probabilistic full negation, BANKED, capped by foe cadence)
     • Telegraph DECOUPLED from the player's chosen E — anchored to the level's PARITY E, so it stays
       level-invariant (A4) yet gives no passive freebie for stacking E. Zero Defend = full damage.
     • Foe HP re-anchored to TYPICAL play: 100 / 250 / 400 (minion / elite / boss).
     • Skill is a 4-AXIS VECTOR: finding (sets/rd) · tactics · ability · gear-choice efficiency.

   Sections:
     §A  the laws + the dodge cadence-cap table
     §B  Report A — Defend sets/round → damage taken, scaled by Endurance
     §C  Report B — Speed differential → dodge floor & foe tempo
     §D  the 4-axis profile matrix (winrate · TTK · HP left · worst round) vs §7 targets
     §E  P/E/S marginal-EDR equality (+6 in one stat → win delta) — the alignment gate
     §F  doom-cap check (worst single-round HP loss ≤ 40%)
     §G  gear-vs-innate power share by level (the §5.4 crossover)
*/

// ---------- deterministic rng (shared with progression-sim) ----------
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// ---------- the settled laws (mirror src/engine/resolve.ts) ----------
const HP_BASE = 100, HP_PER_LEVEL = 5
const RATE_BASE = 8, RATE_MIN = 2, RATE_MAX = 20, RATE_K = 0.2
const MOVE_BASE = 1, MOVE_MIN = 0.2, MOVE_MAX = 3, MOVE_K = 0.025
const QSUM = 3.1 // quality-sum of a magnitude-6 set (0.7+1.0+1.4)
const TIER_OUT = { minion: 1.0, elite: 1.7, boss: 2.4 } // A5 tier output multipliers — RAISED from 1/1.5/2:
// elites/bosses must out-demand the Defend capacity a player can casually spare, or they can't threaten
// competent play (the telegraph is fully blockable). This is the structural "rush is harder" lever — but
// it trades against the doom cap (bigger telegraph = bigger unblocked tail), the §8 design tension.
const ELITE_E_BUMP = { minion: 0, elite: 4, boss: 8 }
const WOUND_CAP = 5

const rate = (yours, theirs) => clamp(RATE_BASE + RATE_K * (yours - theirs), RATE_MIN, RATE_MAX)
const moveRate = (yS, tS) => clamp(MOVE_BASE + MOVE_K * (yS - tS), MOVE_MIN, MOVE_MAX)
const parityStat = (L) => 10 + 2 * (L - 1)
const maxHP = (L) => HP_BASE + HP_PER_LEVEL * (L - 1)

function tempo(S, P) {
  const d = S - P
  const strikeEvery = d <= -8 ? 3 : d <= -5 ? 2 : 1
  const swings = strikeEvery > 1 ? 1 : d >= 4 ? 3 : d >= -1 ? 2 : 1
  return { strikeEvery, swings }
}
function weightedRoll(max, rng) {
  max = Math.max(1, Math.round(max))
  const total = (max * (max + 1)) / 2
  let r = Math.floor(rng() * total) + 1, v = 0, acc = 0
  while (acc < r) { v++; acc += v }
  return v
}

// ---------- PROPOSED new-model constants (BALANCE.md §2/§5) ----------
const FOE_HP = { minion: 100, elite: 250, boss: 400 } // §5.2 — re-anchored to Typical play
// THE TELEGRAPH, decoupled from the player's chosen E (§2.2): anchored to the level's PARITY E so it
// is level-invariant (parity foe vs parity player → 25×tier at every level, A4) yet a player who
// over-invests in E gets NO passive reduction — mitigation comes ONLY from Defend sets + Dodge.
const foeBudget = (foe) => rate(foe.P, parityStat(foe.L)) * QSUM * TIER_OUT[foe.tier]

// DODGE: a Speed-differential FLOOR (per swing) + a BANKED pool fed by Move sets, capped by the foe's
// cadence (§2.3). The pool persists across rounds and RESETS to the floor on a successful dodge.
const DODGE_BASE = 0.10, DODGE_K = 0.015, DODGE_MIN = 0.03, DODGE_MAX = 0.40 // the Speed floor (src live)
const DODGE_PER_MOVE = 0.12 // PROPOSED: banked dodge added per mag-6 Move set (× q/QSUM) — §6 tunes
const dodgeFloor = (S, foeS) => clamp(DODGE_BASE + DODGE_K * (S - foeS), DODGE_MIN, DODGE_MAX)
/** Dodge ceiling by foe cadence (§2.3): rarer-but-bigger hits → invest all the way; chip can't be fully slipped. */
function dodgeCap(foe) {
  if (foe.strikeEvery === 3) return 1.00 // 1 hit / 3 rounds — the haymaker
  if (foe.strikeEvery === 2) return 0.90 // 1 hit / 2 rounds
  return foe.swings === 3 ? 0.60 : foe.swings === 2 ? 0.70 : 0.80 // 1/round: 3-swing 60 · 2-swing 70 · clean 80
}

// DREAD escalation (the anti-stall). With the telegraph fully blockable and the unblockable fraction
// cut, dread is THE load-bearing threat vs skilled "block everything" play: a two-way damage multiplier
// + an unguardable bleed past the onset, so dragging a fight is punished. D0 = depth floor (deeper foes
// start hotter). Bosses sit at the end of a delve → high D0; minions early → low.
const DREAD_RISE = 0.5, DMG_ONSET = 7, DREAD_MAX = 10, DREAD_FOE_MAX = 2.0, DREAD_PLAYER_MAX = 1.5, DREAD_BLEED_MAX = 0.06
const DREAD_D0 = { minion: 1.5, elite: 2.5, boss: 4.0 }
const dreadAt = (round, D0) => Math.min(DREAD_MAX, Math.max(1, D0 + DREAD_RISE * round))
const dreadBand01 = (d) => clamp((d - DMG_ONSET) / (DREAD_MAX - DMG_ONSET), 0, 1)
const dmgMult = (d) => d < DMG_ONSET ? { foe: 1, player: 1 } : { foe: 1 + dreadBand01(d) * (DREAD_FOE_MAX - 1), player: 1 + dreadBand01(d) * (DREAD_PLAYER_MAX - 1) }

// ABILITY economy (§3/§5.1): mana income from sets, spent at VPM≈4.
const VPM = 4, MANA_PER_SET = 1.1 // avg mana/set net of the mono/rainbow mix + cap losses (trimmed — offense was hot)
// TRAP TAX (§5.3): the undodgeable/unblockable pressure floor. ONE spring per round (not per-set — the
// per-set roll let skilled players, who make many sets, eat a pile of unguardable hits → the doom blowout).
const TRAP_SPRING_P = 0.28 // chance the foe springs its trap in a round
const TRAP_HIT = (foe) => 5 * TIER_OUT[foe.tier] * (maxHP(foe.L) / 100) // severity ∝ intended-level HP
const BOSS_TICK = (L) => 3 * (maxHP(L) / 100)
const STEER_BASE = 0.40, STEER_SKILL = 0.42 // P(get the shape you wanted) = base + skill·tactics (cap ~0.82)
const DOOM_CAP = 0.40 // §3.1 — worst single-round HP loss must stay ≤ 40% maxHP (haymakers are the noted exception)

// GEAR model (§5.4 — the user's rarity-by-level spec). Drop rarity climbs with character/dungeon level;
// affix magnitude climbs with item level (LOOTTIER_K). Gear POWER ∝ rarity² (higher rarity = MORE
// affixes AND bigger riders) × the item-level magnitude → gear climbs SUPER-linearly, so its share can
// rise against the (linear) innate stat curve. §G reports the resulting share.
const RARITY_IDX = { white: 1, green: 2, blue: 3, purple: 4, orange: 5 }
const RARITY_BANDS = [ // drop weights per character/dungeon-level band (sum 100)
  { maxL: 5, w: { white: 65, green: 28, blue: 7, purple: 0, orange: 0 } }, // ≤5: mostly white, some green, rarely blue
  { maxL: 12, w: { white: 25, green: 50, blue: 20, purple: 5, orange: 0 } }, // 6–12: some white, mostly green, unusually blue, rarely purple
  { maxL: 18, w: { white: 5, green: 45, blue: 35, purple: 13, orange: 2 } }, // 13–18: often green, sometimes blue, unusually purple, rarely orange
  { maxL: 99, w: { white: 0, green: 15, blue: 50, purple: 28, orange: 7 } }, // 19+: mostly blue, some purple, rarely-but-more orange
]
const rarityBand = (L) => RARITY_BANDS.find((b) => L <= b.maxL).w
const expRarityIdx2 = (L) => { const w = rarityBand(L); let s = 0, n = 0; for (const k in w) { s += w[k] * RARITY_IDX[k] ** 2; n += w[k] } return s / n }
const LOOTTIER_K = 0.12 // affix magnitude × (1 + k·(itemLevel−1)) — PROPOSED, up from live 0.02 (§5.4)
const gearPower = (L) => expRarityIdx2(L) * (1 + LOOTTIER_K * (L - 1)) // abstract power units (stat + riders + procs)
const GEAR_COMBAT_C = 0.42 // gear's BOUNDED raw-stat slice for the contest (riders/procs aren't raw stat)
const gearStatAtL = (L, eff) => eff * gearPower(L) * GEAR_COMBAT_C

/** Author a foe at dungeon level L, tier, speed archetype (level-invariant role spread). */
function makeFoe(tier, L, archetype = 'steady') {
  const p = parityStat(L)
  const spread = { swift: { P: -2, S: +5 }, steady: { P: 0, S: 0 }, heavy: { P: +2, S: -5 }, giant: { P: +4, S: -9 } }[archetype]
  const P = p + spread.P, S = p + spread.S, E = p + ELITE_E_BUMP[tier]
  return { tier, L, archetype, P, E, S, hp: FOE_HP[tier], ...tempo(S, P) }
}

// ===================================================================================================
// THE COMBAT MODEL (the new defensive grammar)
// skill = { find: sets/round, tactics: 0..1, ability: 0..1, gear: 0..1 }
// ===================================================================================================
function fight(foe, L, sk, rng, opts = {}) {
  const gEff = opts.gearOverride ?? sk.gear ?? 0
  const g = gearStatAtL(L, gEff)
  const base = opts.stats ?? { P: parityStat(L), E: parityStat(L), S: parityStat(L) }
  const st = { P: base.P + g, E: base.E + g, S: base.S + g }
  if (opts.statBonus) { st.P += opts.statBonus.P || 0; st.E += opts.statBonus.E || 0; st.S += opts.statBonus.S || 0 }
  const pMax = maxHP(L)
  let pHP = pMax * (opts.startHPfrac ?? 1), fHP = foe.hp, wounds = opts.startWounds ?? 0, charges = 0, bankedDodge = 0
  let telegraph = null, strikeRound = foe.strikeEvery
  const budget = foeBudget(foe)
  const perSwing = (budget * foe.strikeEvery) / foe.swings
  const atkRate = rate(st.P, foe.E), defRate = rate(st.E, foe.P), chgRate = moveRate(st.S, foe.S)
  const dFloor = dodgeFloor(st.S, foe.S), dCap = dodgeCap(foe)
  const woundQ = pMax / 10
  const disc = sk.tactics ?? 0.5 // defensive discipline: how often the optimal defensive pick is taken
  let dmgTaken = 0, worstRound = 0, rounds = 0

  const D0 = opts.D0 ?? DREAD_D0[foe.tier]
  for (let round = 1; round <= 40; round++) {
    rounds = round
    const dread = opts.noDread ? 1 : dreadAt(round, D0)
    const dmult = dmgMult(dread)
    const revealAt = strikeRound - (foe.strikeEvery - 1) // telegraph shows at windup start
    if (telegraph == null && round >= revealAt) telegraph = perSwing * foe.swings * dmult.foe // expected (dread folds in at reveal)
    const strikeThisRound = round >= strikeRound && telegraph != null
    const inWindup = telegraph != null && !strikeThisRound

    // --- make sets ---
    const liveScale = Math.pow((15 - wounds) / 15, 1.5) // wounds shrink the board
    const expected = sk.find * liveScale
    const sets = Math.floor(expected) + (rng() < expected % 1 ? 1 : 0)
    let bankedAtk = 0, guard = 0, roundLoss = 0 // guard is THIS-ROUND-ONLY (no carry)
    // SHAPE-STEERING IS A SKILL: you find whatever sets the board offers; Tactics/Maneuver bias the
    // shape toward your intent but never dictate it. steer = P(you get the shape you wanted); the rest
    // is board-forced (random). This is the opportunity cost that makes the rush real — you can't both
    // fully attack AND fully cover the telegraph, and even experts miss ~20% of their intended shapes.
    const steer = STEER_BASE + STEER_SKILL * disc // novice ~0.45 · average ~0.60 · expert ~0.80
    for (let i = 0; i < sets; i++) {
      let q = clamp(QSUM + (rng() - 0.5) * 1.2, 2.1, 4.2)
      if (charges >= 1 && rng() < disc * 0.3) { q = Math.min(4.2, q + 0.4); charges -= 1 } // Maneuver Priming
      let want // the intent
      if (opts.turtle) want = 'def'
      else if (strikeThisRound && guard < telegraph) want = 'def' // cover the hit landing THIS round
      else if (inWindup && bankedDodge < dCap) want = 'mov' // build dodge for the coming haymaker
      else want = 'atk'
      const shape = rng() < steer ? want : ['atk', 'def', 'mov'][Math.floor(rng() * 3)] // steered, else board-forced

      if (shape === 'atk') bankedAtk += atkRate * q
      else if (shape === 'def') guard += defRate * q
      else { charges = Math.min(15, charges + chgRate * q); bankedDodge = Math.min(dCap, bankedDodge + DODGE_PER_MOVE * (q / QSUM)) }
    }
    if (rng() < TRAP_SPRING_P) { // trap tax — ONE spring/round, undodgeable + unblockable (§2.3/§5.3)
      const trap = TRAP_HIT(foe) * dmult.foe; pHP -= trap; dmgTaken += trap; roundLoss += trap
      if (pHP <= 0) return { win: false, rounds, dmgTaken, pHP: 0, worstRound: Math.max(worstRound, roundLoss) }
    }
    // --- ability injection (VPM): mana income spent on damage, or heal when low ---
    const abilEDR = sets * MANA_PER_SET * VPM * (sk.ability ?? 0)
    if (pHP / pMax < 0.45) pHP = Math.min(pMax, pHP + abilEDR * dmult.player)
    else bankedAtk += abilEDR
    // --- boss ambient tick + the generic dread bleed (both unguardable, ride the ramp) ---
    if (foe.tier === 'boss') { const t = BOSS_TICK(L) * dmult.foe; pHP -= t; dmgTaken += t; roundLoss += t; if (pHP <= 0) return { win: false, rounds, dmgTaken, pHP: 0, worstRound: Math.max(worstRound, roundLoss) } }
    const bleed = dreadBand01(dread) * DREAD_BLEED_MAX * pMax
    if (bleed > 0) { pHP -= bleed; dmgTaken += bleed; roundLoss += bleed; if (pHP <= 0) return { win: false, rounds, dmgTaken, pHP: 0, worstRound: Math.max(worstRound, roundLoss) } }

    // --- the exchange: player swings FIRST (kill-race) ---
    fHP -= bankedAtk * dmult.player
    if (fHP <= 0) return { win: true, rounds, dmgTaken, pHP, worstRound }
    if (strikeThisRound) {
      let raw = 0, eff = Math.min(dCap, dFloor + bankedDodge)
      for (let s = 0; s < foe.swings; s++) {
        if (rng() < eff) { bankedDodge = 0; eff = dFloor } // dodged — pool resets to the floor
        else raw += weightedRoll(perSwing * dmult.foe, rng)
      }
      const bite = Math.max(0, raw - guard) // Block mitigates only what lands THIS round
      pHP -= bite; dmgTaken += bite; roundLoss += bite
      let w = Math.min(WOUND_CAP - wounds, Math.floor(bite / woundQ))
      while (w > 0 && charges >= 3 && rng() < disc) { charges -= 3; w-- } // tactics-scaled wound warding
      wounds += Math.max(0, w)
      telegraph = null; strikeRound = round + foe.strikeEvery
    }
    worstRound = Math.max(worstRound, roundLoss)
    if (pHP <= 0) return { win: false, rounds, dmgTaken, pHP: 0, worstRound }
    if (wounds > 0) wounds-- // 1 knits per deal
  }
  return { win: false, rounds: 40, dmgTaken, pHP, worstRound } // timeout = loss
}

const quantile = (arr, q) => { if (!arr.length) return 0; const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * q))] }
function mc(foe, L, sk, opts = {}, n = 4000, seed = 1234) {
  const rng = mulberry32(seed)
  let wins = 0, ttk = 0, ttkN = 0, hpLeft = 0
  const hps = [], worsts = []
  for (let i = 0; i < n; i++) {
    const r = fight(foe, L, sk, rng, opts)
    if (r.win) { wins++; ttk += r.rounds; ttkN++; hpLeft += r.pHP / maxHP(L); hps.push(r.pHP / maxHP(L)) }
    worsts.push(r.worstRound / maxHP(L))
  }
  // doom = the p99 round (a genuinely bad round), NOT the 1-in-n perfect-storm confluence
  return { winrate: wins / n, ttk: ttkN ? ttk / ttkN : NaN, hpLeft: ttkN ? hpLeft / ttkN : 0, p10HP: quantile(hps, 0.1), worstRoundFrac: quantile(worsts, 0.99) }
}

// ---------- the 4-axis skill profiles (BALANCE.md §6.2) ----------
const PROFILES = {
  Novice: { find: 3, tactics: 0.2, ability: 0.3, gear: 0.3 },
  Average: { find: 6.5, tactics: 0.5, ability: 0.6, gear: 0.6 }, // ← the tuning target (Typical)
  Good: { find: 9, tactics: 0.7, ability: 0.8, gear: 0.8 },
  Expert: { find: 12.5, tactics: 0.9, ability: 0.95, gear: 0.95 },
}
// §7 target bands (win-rate, no consumables) for the checked tiers
const TARGETS = {
  minion: { Novice: 0.85, Average: 0.97, Expert: 0.995 },
  elite: { Novice: 0.55, Average: 0.80, Expert: 0.95 },
  boss: { Novice: 0.40, Average: 0.70, Expert: 0.90 },
}
// off-diagonal profiles (gate §6.4.4): the curve should reward BALANCED skill, not let one axis carry.
const OFFDIAG = {
  Rusher: { find: 11, tactics: 0.1, ability: 0.6, gear: 0.6 }, // all finding, no defensive discipline
  Grinder: { find: 4, tactics: 0.9, ability: 0.75, gear: 0.75 }, // patient, defensive, low throughput
}
const pct = (x) => `${(x * 100).toFixed(1)}%`
const mark = (actual, target, tol = 0.08) => Math.abs(actual - target) <= tol ? '✓' : actual > target ? '↑' : '↓'

// ===================================================================================================
function sectionA() {
  console.log('\n════ §A THE LAWS + THE DODGE CADENCE-CAP TABLE ════')
  console.log(`Unified model: Attack·Power→deal · Defend·Endurance→Block (no carry) · Move·Speed→Dodge (banked).`)
  console.log(`Telegraph (decoupled from player E, anchored to level parity): budget = rate(P_foe, parityE(L)) × ${QSUM} × tier.`)
  console.log(`  parity foe → ${(rate(parityStat(12), parityStat(12)) * QSUM).toFixed(0)}×tier at EVERY level (A4 holds). Foe HP: minion ${FOE_HP.minion} · elite ${FOE_HP.elite} · boss ${FOE_HP.boss}.`)
  console.log(`\nDodge cap by foe cadence (Block strong-vs-chip ↔ Dodge cap high-vs-haymaker = complements):`)
  console.log(`  1 hit / 3 rounds (giant)  → 100%`)
  console.log(`  1 hit / 2 rounds (heavy)  →  90%`)
  console.log(`  1 hit / round   (clean)   →  80%`)
  console.log(`  2 hits / round  (steady)  →  70%`)
  console.log(`  3 hits / round  (swift)   →  60%`)
}

function sectionB() {
  console.log('\n════ §B REPORT A — Defend sets/round → damage taken (scaled by Endurance) ════')
  const foe = makeFoe('boss', 12) // a boss telegraph
  const budget = foeBudget(foe)
  console.log(`vs a boss telegraph ≈ ${budget.toFixed(0)} (foe P${foe.P}, ×2 tier). block/set = rate(E, ${foe.P})×${QSUM}. damage = max(0, tele − sets·block):`)
  for (const [label, E] of [['Low  E=10', 10], ['Mid  E=30', 30], ['High E=50', 50]]) {
    const perSet = rate(E, foe.P) * QSUM
    const row = [0, 1, 2, 3, 4].map((n) => String(Math.max(0, Math.round(budget - n * perSet))).padStart(4))
    console.log(`  ${label} (~${perSet.toFixed(0)}/set):  sets→ 0:${row[0]}  1:${row[1]}  2:${row[2]}  3:${row[3]}  4:${row[4]}`)
  }
  console.log(`  → 0 Defend = full damage; Endurance is the SLOPE to zero (the §2.2 spec).`)
}

function sectionC() {
  console.log('\n════ §C REPORT B — Speed differential → dodge floor & foe tempo ════')
  console.log(`Dodge FLOOR per swing = clamp(0.10 + 0.015·ΔS, 0.03, 0.40):`)
  console.log(`  ΔS:   −20    −10     0    +10    +20`)
  console.log(`  floor ${[-20, -10, 0, 10, 20].map((d) => pct(dodgeFloor(10 + d, 10)).padStart(5)).join('  ')}`)
  console.log(`\nFoe tempo → packaging + dodge cap (per-swing of a 50 budget):`)
  for (const a of ['swift', 'steady', 'heavy', 'giant']) {
    const f = makeFoe('minion', 12, a)
    console.log(`  ${a.padEnd(7)} S−P=${String(f.S - f.P).padStart(3)} → every ${f.strikeEvery}r ×${f.swings} swings · ~${Math.round(50 * f.strikeEvery / f.swings)}/swing · dodge cap ${pct(dodgeCap(f))}`)
  }
}

function sectionD() {
  console.log('\n════ §D THE 4-AXIS PROFILE MATRIX (winrate · TTK · HP-left · worst-round) vs §7 targets ════')
  console.log('No consumables (panic-button headroom). Foe = "steady" archetype at level-matched parity.')
  for (const L of [3, 12, 20]) {
    console.log(`\n  — level ${L} (parity ${parityStat(L)}, HP ${maxHP(L)}) —`)
    for (const tier of ['minion', 'elite', 'boss']) {
      const foe = makeFoe(tier, L)
      console.log(`   ${tier.toUpperCase()} (hp ${foe.hp})`)
      for (const name of Object.keys(PROFILES)) {
        const r = mc(foe, L, PROFILES[name])
        const tgt = TARGETS[tier][name]
        const tg = tgt != null ? ` [tgt ${pct(tgt)} ${mark(r.winrate, tgt)}]` : ''
        console.log(`     ${name.padEnd(8)} win ${pct(r.winrate).padStart(6)}  TTK ${isNaN(r.ttk) ? ' — ' : r.ttk.toFixed(1).padStart(4)}r  HPleft ${pct(r.hpLeft).padStart(5)} (p10 ${pct(r.p10HP).padStart(5)})  worst ${pct(r.worstRoundFrac).padStart(5)}${tg}`)
      }
    }
  }
}

function sectionE() {
  console.log('\n════ §E P/E/S MARGINAL-EDR EQUALITY (+6 in one stat → win-rate delta) — the alignment gate ════')
  console.log('Goal (gate §6.4.5): the three deltas within ~±15% of each other, given a mixed roster.')
  const L = 12, sk = PROFILES.Average
  // a mixed roster: a steady minion (chip), a giant elite (haymaker → rewards dodge), a boss
  const roster = [makeFoe('minion', L, 'steady'), makeFoe('elite', L, 'giant'), makeFoe('boss', L, 'heavy')]
  for (const foe of roster) {
    const b = mc(foe, L, sk).winrate
    const dP = mc(foe, L, sk, { statBonus: { P: 6 } }).winrate - b
    const dE = mc(foe, L, sk, { statBonus: { E: 6 } }).winrate - b
    const dS = mc(foe, L, sk, { statBonus: { S: 6 } }).winrate - b
    console.log(`  ${foe.tier.padEnd(6)} ${foe.archetype.padEnd(6)} (base ${pct(b)}):  +6P ${(dP * 100 >= 0 ? '+' : '') + (dP * 100).toFixed(1)}pp  ·  +6E ${(dE * 100 >= 0 ? '+' : '') + (dE * 100).toFixed(1)}pp  ·  +6S ${(dS * 100 >= 0 ? '+' : '') + (dS * 100).toFixed(1)}pp`)
  }
  console.log('  (E should win vs chip · S should win vs the giant haymaker · P everywhere — the encounter MIX is what equalizes them, §3.)')
}

function sectionF() {
  console.log('\n════ §F DOOM-CAP CHECK — worst single-round HP loss ≤ 40% (§3.1), Average profile ════')
  console.log('Measured on the Average profile (who defends/dodges). The GIANT haymaker is the noted exception:')
  console.log('its identity is a telegraphed one-hit dodge-check (cap 100%) — failing it is a multi-round prep failure, not "one bad round".')
  const L = 12
  for (const tier of ['minion', 'elite', 'boss']) {
    for (const arch of (tier === 'minion' ? ['swift', 'steady'] : tier === 'elite' ? ['steady', 'giant'] : ['steady'])) {
      const foe = makeFoe(tier, L, arch)
      const r = mc(foe, L, PROFILES.Average)
      const haymaker = foe.strikeEvery >= 2
      const ok = r.worstRoundFrac <= DOOM_CAP
      console.log(`  ${tier.padEnd(6)} ${arch.padEnd(6)} worst round ${pct(r.worstRoundFrac).padStart(6)}  ${ok ? '✓ within cap' : haymaker ? '⚠ over (haymaker — dodge-check by design)' : '✗ EXCEEDS 40% — tune threat down'}`)
    }
  }
  console.log('  (banked dodge is the bad-round insurance: Move investment carries protection into a whiffed Attack round.)')
}

const GEAR_SHARE_C = 1.30 // total gear power (stat + riders + procs) per power-unit — calibrated to the §7 curve
function sectionG() {
  console.log('\n════ §G GEAR-vs-INNATE POWER SHARE by level — rarity-by-level + item-level magnitude (§5.4) ════')
  console.log('Drop rarity climbs with level (the user spec); affix magnitude climbs with item level (LOOTTIER_K).')
  console.log('Gear power ∝ E[rarity²]×(1+k·iLvl); share vs FULL innate stat (base 10 + balanced allocation). Target: innate-led early → gear-led late.')
  console.log('  band         drop weights (W/G/B/P/O)        E[rarity²]  gearPow   share')
  const bandLabel = (L) => L <= 5 ? '≤5  ' : L <= 12 ? '6–12' : L <= 18 ? '13–18' : '19+ '
  for (const L of [3, 6, 11, 16, 21]) {
    const w = rarityBand(L)
    const innate = parityStat(L) // full innate stat (base + balanced allocation)
    const gear = gearPower(L) * GEAR_SHARE_C
    const share = gear / (innate + gear)
    const ws = `${w.white}/${w.green}/${w.blue}/${w.purple}/${w.orange}`.padEnd(16)
    console.log(`  L${String(L).padEnd(2)} (${bandLabel(L)})  ${ws}  ${expRarityIdx2(L).toFixed(2).padStart(6)}   ${gear.toFixed(0).padStart(4)}    ${pct(share).padStart(6)}`)
  }
  console.log(`  → rarity-by-level makes the share RISE & cross ~50% late (was flat). The combat raw-stat slice is bounded (GEAR_COMBAT_C ${GEAR_COMBAT_C}); riders/procs carry the rest.`)
  console.log(`    NOTE: the +6/level innate allocation grows steeply early — a literal "innate 80% at L3" needs tempering that allocation too (a §5.6 lever); rarity-by-level alone lands ~${pct((gearPower(3) * GEAR_SHARE_C) / (parityStat(3) + gearPower(3) * GEAR_SHARE_C))} gear at L3.`)
}

function sectionH() {
  console.log('\n════ §H WHERE BOSS DIFFICULTY LIVES — context & off-diagonal (§6.4.4) ════')
  const L = 12, boss = makeFoe('boss', L)
  console.log(`A FRESH level-matched boss is winnable by anyone competent (correct!). The §7 boss band is the EXPECTED CONTEXT:`)
  console.log(`reached at the end of a delve — wounded, resources spent, the dread floor elevated by depth + Heat.`)
  const fresh = mc(boss, L, PROFILES.Average)
  const ctx = mc(boss, L, PROFILES.Average, { startHPfrac: 0.7, startWounds: 2, D0: 6, abilityCap: true })
  console.log(`  Average vs boss — FRESH (D0 ${DREAD_D0.boss}, full HP): win ${pct(fresh.winrate)}  TTK ${fresh.ttk.toFixed(1)}r`)
  console.log(`  Average vs boss — DELVE CONTEXT (D0 6, enter 70% HP + 2 wounds): win ${pct(ctx.winrate)}  TTK ${ctx.ttk.toFixed(1)}r  [tgt ${pct(TARGETS.boss.Average)}]`)
  console.log(`\nOff-diagonal (same boss, fresh) — the rush should be FASTER but RISKIER (lower HP-left = thinner margin):`)
  for (const [name, sk] of Object.entries(OFFDIAG)) {
    const r = mc(boss, L, sk)
    console.log(`  ${name.padEnd(8)} (find ${sk.find}, tactics ${sk.tactics}) win ${pct(r.winrate).padStart(6)}  TTK ${r.ttk.toFixed(1)}r  HPleft ${pct(r.hpLeft)} (p10 ${pct(r.p10HP)})`)
  }
  console.log(`  → Rusher kills faster on a thinner margin; in real (attrition) context that margin is where the rush loses runs.`)
}

// ---------- run ----------
console.log('╔══════════════════════════════════════════════════════════════════════╗')
console.log('║  BALANCE WORKSHOP — the unified verb↔stat↔defense model (BALANCE.md)    ║')
console.log('║  PROPOSED numbers — sim-fodder, not committed. Gates the rebalance pass. ║')
console.log('╚══════════════════════════════════════════════════════════════════════╝')
sectionA(); sectionB(); sectionC(); sectionD(); sectionE(); sectionF(); sectionG(); sectionH()
console.log('\n(Scaffold: the model + harness + reports run. Next: tune constants to the §6.4 gates,')
console.log(' add off-diagonal profiles (rusher/grinder) and the dungeon ±2 ramp, then port to src/.)\n')
