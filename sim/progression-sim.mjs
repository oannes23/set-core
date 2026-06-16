/* sim/progression-sim.mjs — THE NUMBERS WORKSHOP (TODO.md; gates the progression package).
   Self-contained headless model of the v3 laws + the settled progression package
   (CRAWL §3/§5.7) — it derives the NEW constants (which exist in no code yet), so it
   deliberately does NOT import src/ (the FLOOR stress test, which needs the real engine,
   lives in src/ as a vitest file instead). Deterministic: seeded mulberry32 throughout.

   Run: node sim/progression-sim.mjs

   Sections:
     §1 the re-denomination (closed-form): RATE_K, parity line, tempo bands, telegraph law
     §2 A6 kill budgets → derived foe HP per tier + the authoring table
     §3 Monte Carlo: budget conformance per tier × skill × level (parity invariance check)
     §4 guard-carry A/B vs strikeEvery (does the savings test level the speed tiers?)
     §5 dodge EV parity (+1P vs +1E vs +1S marginal value; picks DODGE_K)
     §6 XP law + curve scan (geometric vs polynomial; anchors + clears-to-cap)
*/

// ---------- deterministic rng ----------
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------- the laws (mirrors of src/engine, with the PROPOSED new constants) ----------
const HP_BASE = 100, HP_PER_LEVEL = 5
const RATE_BASE = 8, RATE_MIN = 2, RATE_MAX = 20
const NEW_RATE_K = 0.2 // PROPOSED (was 0.8): see §1 derivation
const MOVE_BASE = 1, MOVE_MIN = 0.2, MOVE_MAX = 3
const NEW_MOVE_K = 0.025 // PROPOSED (was 0.1): scales with RATE_K
const QSUM = 3.1 // quality-sum of a magnitude-6 set (A2/A4: 0.7+1.0+1.4)
const TIER_OUT = { minion: 1.0, elite: 1.5, boss: 2.0 } // A5 output multipliers
const ELITE_E_BUMP = { minion: 0, elite: 4, boss: 8 } // endurance blunting, rebased (was +2/+4 in the narrow band)
const WOUND_CAP = 5

const rate = (yours, theirs, k = NEW_RATE_K) => Math.min(RATE_MAX, Math.max(RATE_MIN, RATE_BASE + k * (yours - theirs)))
const moveRate = (yS, tS) => Math.min(MOVE_MAX, Math.max(MOVE_MIN, MOVE_BASE + NEW_MOVE_K * (yS - tS)))

/** Player parity stat at level L (balanced allocation: +6/level across 3 stats → +2 each). */
const parityStat = (L) => 10 + 2 * (L - 1)
const maxHP = (L) => HP_BASE + HP_PER_LEVEL * (L - 1)

/** Tempo law — UNCHANGED bands (role spreads stay level-invariant, see §1): foe's own S−P. */
function tempo(S, P) {
  const d = S - P
  const strikeEvery = d <= -8 ? 3 : d <= -5 ? 2 : 1
  const swings = strikeEvery > 1 ? 1 : d >= 4 ? 3 : d >= -1 ? 2 : 1
  return { strikeEvery, swings }
}

/** THE TELEGRAPH LAW, re-anchored (a §1 finding): foe round budget derives from the CONTEST,
 *  not raw Power — budget = rate(P_f, E_player) × QSUM × tierOut. At parity → 25 × tier (A4/A5)
 *  at EVERY level. (The raw-P form `P × 2.5` breaks beyond the narrow band: parity mitigation is
 *  level-invariant in a difference system, but raw-P budgets would grow ~5× over the arc.) */
const foeBudget = (foe, playerE) => rate(foe.P, playerE) * QSUM * TIER_OUT[foe.tier]

/** Triangular weightedRoll mirror (enemy strikes). */
function weightedRoll(max, rng) {
  max = Math.max(1, Math.round(max))
  const total = (max * (max + 1)) / 2
  let r = Math.floor(rng() * total) + 1, v = 0, acc = 0
  while (acc < r) { v++; acc += v }
  return v
}

// ---------- §1 THE RE-DENOMINATION (closed-form) ----------
function section1() {
  console.log('\n════ §1 THE RE-DENOMINATION (closed-form) ════')
  console.log(`Arc: +6/level (freely distributed, ≤3/stat: 3/3/0·2/2/2·3/2/1), cap 21 → +120 points; focused main +60, balanced +40/stat.
Parity line (balanced): stat(L) = 10 + 2(L−1)  →  L1=10 · L3=14 · L12=32 · L20=48 (endgame foes ≈40–80 ✓)`)
  const k = NEW_RATE_K
  console.log(`\nRATE_K ${k} (was 0.8). At parity rate=8 (A4 anchor holds at EVERY level — difference math):`)
  console.log(`  +1 level in your main (+3)      → +${(k * 3 / RATE_BASE * 100).toFixed(1)}% lane throughput at parity`)
  console.log(`  focused vs balanced main (±20)  → ${rate(70, 48).toFixed(1)} vs ${rate(50, 48).toFixed(1)} (+${((rate(70, 48) / rate(50, 48) - 1) * 100).toFixed(0)}%)`)
  console.log(`  full endgame kit (≈+12/stat)    → +${(k * 12 / RATE_BASE * 100).toFixed(0)}% per lane (gear share ≈25% ✓)`)
  console.log(`  outlevel content by 5           → +10 diff → rate ${rate(parityStat(8), parityStat(3)).toFixed(1)} (+25% — old zones soften, don't vanish)`)
  console.log(`  clamp [2,20] binds at ±${((RATE_MAX - RATE_BASE) / k).toFixed(0)} diff → only tutorial-tier content ever fully trivializes`)
  console.log(`\nTempo bands: UNCHANGED. They read the foe's OWN S−P; role spreads are authored
LEVEL-INVARIANT (±8 around the dungeon's parity line), so the bands never re-denominate.
(The "×6 bands" guess in the docs dies here — only PLAYER-vs-foe diffs widen with the arc.)`)
  console.log(`\nTHE TELEGRAPH LAW RE-ANCHORS (the big §1 finding): budget = rate(P_f, E_p) × ${QSUM} × tierOut.
  raw-P form (P×2.5):  L1 parity budget 25 · L20 parity budget ${(parityStat(20) * 2.5).toFixed(0)} — but parity Defend stays 25/round → A4 BREAKS
  contest form:        parity budget 25×tier at every level ✓ · underleveled −10 diff → ×${(rate(48, 38) / 8).toFixed(2)} · overleveled +10 → ×${(rate(38, 48) / 8).toFixed(2)}
  → DMG_BUDGET_K (raw) RETIRES; foe damage authors as the contest does.`)
  console.log(`\nMOVE_RATE_K ${NEW_MOVE_K} (was 0.1): parity 1/card; speed build at cap vs same-tier (+22 diff) → ${moveRate(70, 48).toFixed(2)}/card.`)
}

// ---------- §2 KILL BUDGETS (A6) + the foe authoring table ----------
const KILL_BUDGET = { minion: 2.5, elite: 5, boss: 10 } // PROPOSED A6 (rounds at baseline 6/6/6)
/** Foe HP derived from the kill budget: rounds × the player's per-round attack vs THAT foe's E. */
function foeHP(tier, L) {
  const pAtk = rate(parityStat(L), parityStat(L) + ELITE_E_BUMP[tier]) * QSUM // one attack set/round (A2)
  return Math.round((KILL_BUDGET[tier] * pAtk) / 5) * 5
}
/** Author a foe for dungeon level L, tier, and a speed archetype (role spread, level-invariant). */
function makeFoe(tier, L, archetype = 'steady') {
  const p = parityStat(L)
  const spread = { swift: { P: -2, S: +5 }, steady: { P: 0, S: 0 }, heavy: { P: +2, S: -5 }, giant: { P: +4, S: -9 } }[archetype]
  const P = p + spread.P, S = p + spread.S, E = p + ELITE_E_BUMP[tier]
  return { tier, L, archetype, P, E, S, hp: foeHP(tier, L), ...tempo(S, P), traps: tier === 'boss' ? 4 : tier === 'elite' ? 2 : 1 }
}
function section2() {
  console.log('\n════ §2 A6 KILL BUDGETS + FOE AUTHORING ════')
  console.log(`PROPOSED A6 (rounds-to-kill at baseline 6/6/6; competent ≈ ×2 → halves):
  minion ${KILL_BUDGET.minion} · elite ${KILL_BUDGET.elite} · boss ${KILL_BUDGET.boss}   (seconds: ${KILL_BUDGET.minion * 20} / ${KILL_BUDGET.elite * 20} / ${KILL_BUDGET.boss * 20})`)
  console.log(`\nFoe authoring table — parity stat ± level-invariant role spreads (swift −2P+5S · steady · heavy +3P−6S · giant +4P−9S),
E bump per tier +${ELITE_E_BUMP.elite}/+${ELITE_E_BUMP.boss}, HP derived from the budget:`)
  for (const L of [3, 8, 12, 16, 20]) {
    const rows = []
    for (const tier of ['minion', 'elite', 'boss']) rows.push(`${tier[0].toUpperCase()} P${makeFoe(tier, L).P}/E${makeFoe(tier, L).E}/S${makeFoe(tier, L).S} hp${makeFoe(tier, L).hp}`)
    console.log(`  L${String(L).padEnd(2)} (parity ${parityStat(L)}): ${rows.join(' · ')}`)
  }
  console.log(`  (warren = fresh L3 ✓ — the live rebased goblin (~65hp) sits exactly on the derived minion line)`)
}

// ---------- the Monte Carlo combat model ----------
const DODGE_BASE = 0.10, DODGE_MIN = 0.03, DODGE_MAX = 0.40
let DODGE_K = 0.012 // per point of S edge — §5 tunes this
// THE TRAP TAX — the threat layer's pressure, absent from pure card-play: each set risks a
// spring (warren-sweep measured 0–50%, target ~30% → model 0.22 net of play-around). Trap hits
// bypass the guard. AUTHORING GUIDELINE (a §3 finding): trap/tick severity scales with the
// dungeon's INTENDED-level HP (≈6%·tier of expected maxHP) — flat numbers let bulk eat the
// threat layer and same-tier boss difficulty drifts upward with level. (Against OUTLEVELED
// content the authored numbers stay fixed, so old traps fade — that part is by design.)
const TRAP_SPRING_P = 0.22
const TRAP_HIT = (tier, L) => 6 * TIER_OUT[tier] * (maxHP(L) / 100)
const BOSS_TICK = (L) => 3 * (maxHP(L) / 100)

// ---------- THE DREAD ESCALATION (CRAWL §5.8 — the structural anti-stall) ----------
// One meter (1–10) = depth floor D0 (across-run, capped 5) + a within-fight rise. It drives two
// lanes: DRIFT (soft tension, not modeled here — it's a transmute bounded by the TRAPS §6 ceiling,
// can't touch HP) and a TWO-WAY DAMAGE MULTIPLIER (the hard resolver, modeled below). The multiplier
// is OFF until dread 7, then ramps linearly to foe ×2.0 / player ×1.5 (damage + heals) at dread 10.
// It touches damage both ways + player heals; NOT board verbs (traps/ticks stay lane 1). Folded into
// the telegraph AT REVEAL so the shown ⚔ stays honest (v3 invariant). §7 derives/validates these.
const DREAD_RISE = 0.5 // dread climb per round within a fight
const DREAD_DEPTH_CAP = 5 // depth floor never reaches the damage band alone (always earned by dragging)
const DREAD_MAX = 10
const DMG_ONSET = 7 // the damage multiplier engages here; sits PAST the kill budgets (validated §7)
const DREAD_DMG_FOE_MAX = 2.0 // foe damage scale at dread 10
const DREAD_DMG_PLAYER_MAX = 1.5 // player damage + healing scale at dread 10
// THE GENERIC dread BLEED (split out 2026-06-13): a foe-INDEPENDENT unguardable HP drain past the
// onset, ∝ maxHP, so the anti-stall doesn't depend on the foe's trap kit. Authored traps ride on top.
const DREAD_BLEED_MAX = 0.06 // fraction of maxHP/round drained at dread 10 (0 below the onset)
const dreadAt = (round, D0) => Math.min(DREAD_MAX, Math.max(1, D0 + DREAD_RISE * round))
/** 0..1 ramp fraction across the damage band [onset, max] — drives both the mult and the bleed. */
const dreadBand01 = (dread) => Math.max(0, Math.min(1, (dread - DMG_ONSET) / (DREAD_MAX - DMG_ONSET)))
function dmgMult(dread) {
  if (dread < DMG_ONSET) return { foe: 1, player: 1 }
  const t = (dread - DMG_ONSET) / (DREAD_MAX - DMG_ONSET) // 0..1 across the band
  return { foe: 1 + t * (DREAD_DMG_FOE_MAX - 1), player: 1 + t * (DREAD_DMG_PLAYER_MAX - 1) }
}
/** Depth floor D0 from the cumulative boss-% (the dread bands §2): quiet→1, drums→2.5, stirs→4, near→5. */
const depthFloor = (cumPct) => cumPct >= 80 ? DREAD_DEPTH_CAP : cumPct >= 45 ? 4 : cumPct >= 15 ? 2.5 : 1

/** One combat. skill = sets/round (A2: struggling 1.8 · baseline 3 · competent 5).
 *  guardRule: 'reset' (live code) | 'carry' (§5.7 — persists through windup, capped at telegraph).
 *  Player stats default balanced parity at L; override for the EV tests. */
function fight(foe, L, skill, rng, opts = {}) {
  const guardRule = opts.guardRule ?? 'carry'
  const base = opts.stats ?? { P: parityStat(L), E: parityStat(L), S: parityStat(L) }
  // §12 off-stat affixes add raw P/E/S on top (runs through the contest rate, bounded by the clamp)
  const sb = opts.statBonus
  const pStats = sb ? { P: base.P + (sb.P || 0), E: base.E + (sb.E || 0), S: base.S + (sb.S || 0) } : base
  const pMax = maxHP(L)
  let pHP = pMax, fHP = foe.hp, wounds = 0, guard = 0, charges = 0
  let telegraph = null, strikeRound = foe.strikeEvery // next round a strike lands
  const budget = foeBudget(foe, pStats.E)
  const perSwing = ((budget * foe.strikeEvery) / foe.swings) * (opts.foeDmgMult || 1) // §11 foe-difficulty raise (vs gear-block)
  const atkRate = rate(pStats.P, foe.E) // per card
  const defRate = rate(pStats.E, foe.P)
  const chgRate = moveRate(pStats.S, foe.S)
  const woundQ = pMax / 10
  let dmgTaken = 0, rounds = 0

  for (let round = 1; round <= 40; round++) {
    rounds = round
    // the dread escalation (§5.8): the two-way damage multiplier this round (1× unless dread is on)
    const dmult = opts.dread ? dmgMult(dreadAt(round, opts.D0 ?? 1)) : { foe: 1, player: 1 }
    // telegraph reveal: strike round (rule reset) — or at windup start (rule carry, strikeEvery>1)
    const revealAt = guardRule === 'carry' ? strikeRound - (foe.strikeEvery - 1) : strikeRound
    if (telegraph == null && round >= revealAt) {
      // roll the strike now (deal-time): per-swing dodge checks fold in BEFORE the reveal
      let t = 0
      const pDodge = Math.min(DODGE_MAX, Math.max(DODGE_MIN, DODGE_BASE + DODGE_K * (pStats.S - foe.S)))
      for (let s = 0; s < foe.swings; s++) if (rng() >= pDodge) t += weightedRoll(perSwing, rng)
      telegraph = t * dmult.foe // dread folds in AT REVEAL — the shown ⚔ stays honest
    }
    // --- the round: make sets ---
    const liveScale = Math.pow((15 - wounds) / 15, 1.5) // wounds shrink the board → set rate
    let sets = 0
    const expected = skill * liveScale
    sets = Math.floor(expected) + (rng() < expected % 1 ? 1 : 0)
    let bankedAtk = 0
    for (let i = 0; i < sets; i++) {
      const q = Math.min(4.2, Math.max(2.1, QSUM + (rng() - 0.5) * 1.2)) // quality-sum jitter
      let shape
      if (rng() < 1 / 3) shape = ['atk', 'def', 'mov'][Math.floor(rng() * 3)] // the board forces ~⅓ of picks
      else {
        const needGuard = telegraph != null && guard < telegraph
        shape = needGuard ? 'def' : rng() < 0.18 ? 'mov' : 'atk'
      }
      if (opts.turtle && shape === 'atk') shape = 'def' // the pure-turtle stall model: refuses all offense
      // §7 GEAR RIDERS — flat, post-contest, per-card (×3 a set): weapon → +dmg/Attack card, armor → +Block/Defend card
      if (shape === 'atk') bankedAtk += atkRate * q + 3 * (opts.gearRider || 0)
      else if (shape === 'def') {
        const cap = guardRule === 'carry' && telegraph != null ? telegraph : Infinity
        guard = Math.min(cap, guard + defRate * q + 3 * (opts.gearBlock || 0)) // sated guard: overbank is waste either way
      } else charges = Math.min(15, charges + chgRate * q)
      if (rng() < TRAP_SPRING_P) { // the trap tax: bypasses guard; severity ∝ intended-level HP
        const trap = TRAP_HIT(foe.tier, foe.L) * dmult.foe // UNGUARDABLE damage rides the dread ramp
        pHP -= trap
        dmgTaken += trap
        if (pHP <= 0) return { win: false, rounds, dmgTaken, pHP: 0 }
      }
    }
    if (foe.tier === 'boss') { // ambient boss dread tick — also rides the ramp (unguardable, §5.8)
      const tick = BOSS_TICK(foe.L) * dmult.foe
      pHP -= tick; dmgTaken += tick
      if (pHP <= 0) return { win: false, rounds, dmgTaken, pHP: 0 }
    }
    if (opts.dread) { // the GENERIC dread bleed — foe-independent unguardable drain past the onset
      const bleed = dreadBand01(dreadAt(round, opts.D0 ?? 1)) * DREAD_BLEED_MAX * pMax
      if (bleed > 0) { pHP -= bleed; dmgTaken += bleed; if (pHP <= 0) return { win: false, rounds, dmgTaken, pHP: 0 } }
    }
    // sustain (the stall lever, §7): a heal-over-time build — scaled by the PLAYER dread mult
    if (opts.heal) pHP = Math.min(pMax, pHP + opts.heal * dmult.player)
    // §11 ability-VALUE injection: per-round flat add of ONE effect type (measure its marginal win-rate impact)
    if (opts.bonusHeal) pHP = Math.min(pMax, pHP + opts.bonusHeal)
    if (opts.bonusDmg) bankedAtk += opts.bonusDmg
    if (opts.bonusBlock) guard += opts.bonusBlock
    if (opts.bonusCharge) charges = Math.min(15, charges + opts.bonusCharge)
    // --- the exchange ---
    fHP -= bankedAtk * dmult.player // player offense rides the player-side ramp
    if (fHP <= 0) return { win: true, rounds, dmgTaken, pHP }
    if (round >= strikeRound && telegraph != null) {
      const bite = Math.max(0, telegraph - guard)
      pHP -= bite
      dmgTaken += bite
      if (pHP <= 0) return { win: false, rounds, dmgTaken, pHP: 0 }
      let w = Math.min(WOUND_CAP - wounds, Math.floor(bite / woundQ))
      while (w > 0 && charges >= 3) { charges -= 3; w-- } // SG bank wards wounds at 3 (the banker)
      wounds += Math.max(0, w)
      telegraph = null
      strikeRound = round + foe.strikeEvery
      guard = 0 // the guard drops after a strike RESOLVES (both rules)
    } else if (guardRule === 'reset') guard = 0 // live rule: the guard zeroes every rollover regardless
    if (wounds > 0) wounds-- // 1 knits per deal
  }
  return { win: false, rounds: 40, dmgTaken, pHP } // timeout = loss (anti-stall reading)
}

function mc(foe, L, skill, opts, n = 3000, seed = 1234) {
  const rng = mulberry32(seed)
  let wins = 0, ttk = 0, ttkN = 0, dmg = 0
  for (let i = 0; i < n; i++) {
    const r = fight(foe, L, skill, rng, opts)
    if (r.win) { wins++; ttk += r.rounds; ttkN++ }
    dmg += r.dmgTaken / r.rounds
  }
  return { winrate: wins / n, ttk: ttkN ? ttk / ttkN : NaN, dmgPerRound: dmg / n }
}

/** Like mc but separates a TIMEOUT (the 40-round stall) from a resolved loss — the anti-stall metric.
 *  Also tracks mean rounds-to-resolution (the "drag") and damage-taken/round (the "danger"). */
function mcStall(foe, L, skill, opts, n = 4000, seed = 1234) {
  const rng = mulberry32(seed)
  let wins = 0, stalls = 0, rounds = 0, dmg = 0
  for (let i = 0; i < n; i++) {
    const r = fight(foe, L, skill, rng, opts)
    if (!r.win && r.rounds >= 40) stalls++
    if (r.win) wins++
    rounds += r.rounds
    dmg += r.dmgTaken / r.rounds
  }
  return { winrate: wins / n, stall: stalls / n, rounds: rounds / n, dmgPerRound: dmg / n }
}

// ---------- §3 BUDGET CONFORMANCE ----------
function section3() {
  console.log('\n════ §3 MONTE CARLO — BUDGET CONFORMANCE (winrate · mean TTK rounds · dmg-in/round) ════')
  console.log('Model excludes abilities/consumables/passives (pure card play) → real winrates run HIGHER. Guard rule: carry.')
  const skills = [['struggling', 1.8], ['baseline  ', 3], ['competent ', 5]]
  for (const L of [3, 12, 20]) {
    console.log(`\n  — player level ${L} (parity ${parityStat(L)}, HP ${maxHP(L)}) vs same-tier content —`)
    for (const tier of ['minion', 'elite', 'boss']) {
      const foe = makeFoe(tier, L, tier === 'boss' ? 'heavy' : 'steady')
      const cells = skills.map(([name, s]) => {
        const r = mc(foe, L, s, {}, 3000, 42 + L)
        return `${name}: ${(r.winrate * 100).toFixed(0).padStart(3)}% ttk ${isNaN(r.ttk) ? ' —' : r.ttk.toFixed(1)} in ${r.dmgPerRound.toFixed(1)}`
      })
      console.log(`    ${tier.padEnd(6)} (hp ${String(foe.hp).padStart(3)}, ${foe.strikeEvery > 1 ? `every ${foe.strikeEvery}` : `${foe.swings} swing`}): ${cells.join('  ·  ')}`)
    }
  }
  console.log(`\n  CONFORMANCE READ: rows should be ~level-invariant (difference math) — that's the check.
  TARGETS: baseline ≳90% vs minions, ~60–80% vs elites, ~40–60% vs boss (pre-ability headroom).`)
}

// ---------- §4 GUARD CARRY vs strikeEvery ----------
function section4() {
  console.log('\n════ §4 THE SAVINGS TEST — guard rule A (reset, live) vs B (carry, §5.7), same budget ════')
  const L = 3
  for (const arch of ['swift', 'steady', 'heavy', 'giant']) {
    const foe = makeFoe('elite', L, arch)
    const a = mc(foe, L, 3, { guardRule: 'reset' }, 4000, 77)
    const b = mc(foe, L, 3, { guardRule: 'carry' }, 4000, 77)
    console.log(`  elite/${arch.padEnd(6)} (S−P ${String(foe.S - foe.P).padStart(3)} → ${foe.strikeEvery > 1 ? `every-${foe.strikeEvery} ×${(foeBudget(foe, parityStat(L)) * foe.strikeEvery).toFixed(0)}` : `${foe.swings} swings`}):  ` +
      `A win ${(a.winrate * 100).toFixed(0)}% in/rnd ${a.dmgPerRound.toFixed(1)}  →  B win ${(b.winrate * 100).toFixed(0)}% in/rnd ${b.dmgPerRound.toFixed(1)}`)
  }
  console.log('  READ: under A the slow archetypes should out-punish their budget (the felt skew); B should level the row.')
}

// ---------- §5 DODGE EV PARITY ----------
function section5() {
  console.log('\n════ §5 DODGE EV — marginal value of +6 points in one stat (baseline skill, BOSS, L3) ════')
  console.log('  (the boss cell is the discriminator; metric = winrate Δ and damage-in/round Δ)')
  const L = 3, p = parityStat(L)
  for (const k of [0.01, 0.015, 0.02]) {
    DODGE_K = k
    const foe = makeFoe('boss', L, 'heavy')
    const base = mc(foe, L, 3, {}, 4000, 99)
    const dP = mc(foe, L, 3, { stats: { P: p + 6, E: p, S: p } }, 4000, 99)
    const dE = mc(foe, L, 3, { stats: { P: p, E: p + 6, S: p } }, 4000, 99)
    const dS = mc(foe, L, 3, { stats: { P: p, E: p, S: p + 6 } }, 4000, 99)
    const f = (r) => `${(r.winrate * 100).toFixed(1)}%/${r.dmgPerRound.toFixed(1)}`
    console.log(`  DODGE_K ${k}: base ${f(base)} → +6P ${f(dP)} · +6E ${f(dE)} · +6S ${f(dS)}` +
      `   (Δwin ${(100 * (dP.winrate - base.winrate)).toFixed(1)} / ${(100 * (dE.winrate - base.winrate)).toFixed(1)} / ${(100 * (dS.winrate - base.winrate)).toFixed(1)})`)
  }
  DODGE_K = 0.015
  console.log(`  READ: in the pure-card model ΔS runs ~half of ΔE — the gap is the CHARGE AGENCY the model
  can't price (board control, wards, the Maneuver tide). Pick the K where dodge alone carries
  ~half a P/E point and let agency carry the rest; flag for playtest re-read.
  PROPOSAL: DODGE_BASE ${DODGE_BASE} · DODGE_K 0.015 · clamp [${DODGE_MIN}, ${DODGE_MAX}] · per swing, rolled at the deal.`)
}

// ---------- §6 XP LAW + CURVE ----------
const XP_TIER = { minion: 1, elite: 2, boss: 4 }
const xpFor = (foe) => Math.round((foe.hp / 10 + foe.P + foe.E + foe.S) * (1 + 0.15 * foe.traps) * XP_TIER[foe.tier])
function section6() {
  console.log('\n════ §6 XP LAW + THE CURVE ════')
  const at = (L) => ({ m: xpFor(makeFoe('minion', L)), e: xpFor(makeFoe('elite', L)), b: xpFor(makeFoe('boss', L, 'heavy')) })
  for (const L of [3, 8, 12, 16, 20]) {
    const x = at(L)
    const clear = 7 * x.m + 2.5 * x.e + x.b
    console.log(`  L${String(L).padEnd(2)} content: minion ${x.m} · elite ${x.e} (=${(x.e / x.m).toFixed(1)} minions) · boss ${x.b} · full clear ≈ ${Math.round(clear)}`)
  }
  const x3 = at(3)
  console.log(`\n  Anchors: first warren minion (${x3.m} XP) must reach L2 → need(1→2) ≤ ${x3.m}.
  "a few more minions or an elite" to L3 → need(2→3) ≈ ${Math.round(x3.m * 2.5)}±.`)
  console.log('\n  Curve scan — clears-to-cap (clearing tier-appropriate content as you level):')
  const need = (L, kind, base, r) => kind === 'geo' ? Math.round(base * Math.pow(r, L - 1)) : Math.round(base * Math.pow(L, r))
  for (const [kind, base, r, label] of [
    ['geo', x3.m, 1.45, 'geometric ×1.45 (the doc first-cut)'],
    ['poly', x3.m, 1.5, 'polynomial base×L^1.5'],
    ['poly', x3.m, 1.6, 'polynomial base×L^1.6'],
    ['poly', x3.m, 1.7, 'polynomial base×L^1.7'],
    ['poly', x3.m, 1.8, 'polynomial base×L^1.8'],
  ]) {
    let clears = 0, lvl = 1, xpBank = 0
    let guard = 0
    while (lvl < 21 && guard++ < 10000) {
      const L = Math.min(20, Math.max(3, lvl)) // you fight content near your level (floor: the warren)
      const x = at(L)
      xpBank += 7 * x.m + 2.5 * x.e + x.b // one full clear
      clears++
      while (lvl < 21 && xpBank >= need(lvl, kind, base, r)) { xpBank -= need(lvl, kind, base, r); lvl++ }
    }
    const n2 = need(1, kind, base, r), n3 = need(2, kind, base, r)
    console.log(`    ${label.padEnd(36)} need 1→2: ${String(n2).padStart(4)} · 2→3: ${String(n3).padStart(4)} · clears to ★: ${clears}`)
  }
  console.log(`  READ: geometric needs XP sources growing geometrically too — ours grow ~linearly with the parity line,
  so the geometric tail walls off (and its early steps undershoot the 2→3 anchor). The shape is polynomial L^1.7.
  SHIPPED (steepened 2026-06-14): need(L→L+1) = 110 × L^1.7 — see §8 for the retune to the 50–60-clear
  target (base 55→80→110; the L3-minion XP and the curve base were coincidentally both 55, now DECOUPLED).
  Onboarding holds via teaching xp overrides re-tuned to need(1→2)=110 / need(2→3)=355.`)
}

// ---------- §7 THE DREAD ESCALATION (the structural anti-stall) ----------
function section7() {
  console.log('\n════ §7 THE DREAD ESCALATION — the structural anti-stall (CRAWL §5.8) ════')
  console.log(`Dread = clamp(D0 + ${DREAD_RISE}·round, 1, ${DREAD_MAX}); damage mult OFF below ${DMG_ONSET}, → foe ×${DREAD_DMG_FOE_MAX} / player ×${DREAD_DMG_PLAYER_MAX} at ${DREAD_MAX}.`)
  console.log(`Depth floor D0 (across-run, capped ${DREAD_DEPTH_CAP}): quiet 1 · drums 2.5 · stirs 4 · near ${DREAD_DEPTH_CAP}. Drift (soft lane) not modeled — it can't touch HP.`)

  // (1) the calibration curve — the damage band must sit PAST the kill budgets
  console.log('\n  — calibration: dread by round (with the foe/player mult once it engages) —')
  for (const D0 of [1, 2.5, 5]) {
    const cells = [1, 5, 8, 10, 12, 15, 18, 20].map((r) => {
      const d = dreadAt(r, D0), m = dmgMult(d)
      return `r${String(r).padStart(2)}:${d.toFixed(1)}${d >= DMG_ONSET ? `→f${m.foe.toFixed(2)}/p${m.player.toFixed(2)}` : ''}`
    })
    console.log(`    D0 ${String(D0).padEnd(3)}: ${cells.join('  ')}`)
  }
  const onset = (D0) => Math.ceil((DMG_ONSET - D0) / DREAD_RISE)
  console.log(`    damage ONSET round: shallow D0=1 → round ${onset(1)} · mid D0=2.5 → ${onset(2.5)} · deep D0=5 → ${onset(5)}`)
  console.log(`    kill budgets (rounds): minion ${KILL_BUDGET.minion} · elite ${KILL_BUDGET.elite} · boss ${KILL_BUDGET.boss}` +
    ` — all below the shallow onset (${onset(1)}). ✓ a normally-paced fight never sees the teeth; only a drag does.`)

  // (2) normal-play perturbation — a backstop must NOT tax normal fights
  console.log('\n  — normal-play perturbation (dread OFF vs ON, shallow D0=1; baseline skill, L12) —')
  for (const tier of ['minion', 'elite', 'boss']) {
    const L = 12, foe = makeFoe(tier, L, tier === 'boss' ? 'heavy' : 'steady')
    const off = mc(foe, L, 3, { dread: false }, 4000, 7)
    const on = mc(foe, L, 3, { dread: true, D0: 1 }, 4000, 7)
    const dW = (on.winrate - off.winrate) * 100
    console.log(`    ${tier.padEnd(6)}: OFF win ${(off.winrate * 100).toFixed(0)}% ttk ${off.ttk.toFixed(1)}  →  ON win ${(on.winrate * 100).toFixed(0)}% ttk ${on.ttk.toFixed(1)}  (Δwin ${dW >= 0 ? '+' : ''}${dW.toFixed(1)})`)
  }
  console.log('    READ: ON should ≈ OFF for normal fights — they end before the onset, so the backstop is inert until you overstay.')

  // (3) the anti-stall — what the DAMAGE lane does and does NOT own (a real boundary the sim found).
  const L = 12, boss = makeFoe('boss', L, 'heavy')
  const baseIn = foeBudget(boss, parityStat(L) + 12) // ≈ a tanky build's incoming/round (its E is +12)
  const tanky = { ...boss, hp: Math.round(boss.hp * 2.5) } // an OUTSCALED target → forces a long, dragging fight
  const stats = { P: parityStat(L), E: parityStat(L) + 12, S: parityStat(L) } // a sturdy sustain build

  // (3a) the realistic degenerate: PRODUCTIVE safe-grinding (low-but-positive offense + sustain).
  console.log('\n  — anti-stall (3a): SAFE-GRINDING a tanky target (sustain build, heal 1.0×base, vs a 2.5×HP foe) —')
  console.log('    the real degenerate: win slowly in near-perfect safety. The ramp should COMPRESS the drag + raise the danger.')
  const gOff = mcStall(tanky, L, 3, { stats, heal: baseIn, dread: false }, 4000, 23)
  const gOn = mcStall(tanky, L, 3, { stats, heal: baseIn, dread: true, D0: 5 }, 4000, 23)
  console.log(`    OFF: ${gOff.rounds.toFixed(1)} rnds · ${gOff.dmgPerRound.toFixed(1)} dmg-in/rnd · win ${(gOff.winrate * 100).toFixed(0)}% · stall ${(gOff.stall * 100).toFixed(0)}%`)
  console.log(`    ON : ${gOn.rounds.toFixed(1)} rnds · ${gOn.dmgPerRound.toFixed(1)} dmg-in/rnd · win ${(gOn.winrate * 100).toFixed(0)}% · stall ${(gOn.stall * 100).toFixed(0)}%`)
  console.log(`    READ: ON cuts the drag ${(gOff.rounds / gOn.rounds).toFixed(1)}× and lifts incoming ${(gOn.dmgPerRound / Math.max(0.1, gOff.dmgPerRound)).toFixed(1)}× — safe-grinding becomes a timed, risky proposition.`)

  // (3b) the SUSTAIN THRESHOLD — at what heal/round does the (unguardable) ramp stop breaking a pure turtle?
  console.log('\n  — anti-stall (3b): the SUSTAIN THRESHOLD — a pure idle turtle (zero offense) vs the ramp, by heal/round —')
  console.log(`    the foe ramp rides the UNGUARDABLE lane (trap/tick + the generic ${(DREAD_BLEED_MAX * 100).toFixed(0)}%/rnd dread BLEED), so guard can't neutralize it.`)
  for (const pct of [0.05, 0.1, 0.2, 0.3]) {
    const heal = pct * maxHP(L)
    const on = mcStall(boss, L, 3, { stats, heal, turtle: true, dread: true, D0: 5 }, 4000, 11)
    const off = mcStall(boss, L, 3, { stats, heal, turtle: true, dread: false }, 4000, 11)
    console.log(`    heal ${(pct * 100).toFixed(0).padStart(2)}%/rnd (${heal.toFixed(0)} HP): OFF stall ${(off.stall * 100).toFixed(0).padStart(3)}%  →  ON stall ${(on.stall * 100).toFixed(0).padStart(3)}% · falls ~rnd ${on.rounds.toFixed(0)}`)
  }
  console.log(`    READ: the ramp breaks REALISTIC sustain (≤~20%/rnd) — only absurd out-healing (≳ the foe's whole
    budget, ~24%/rnd here) survives, and THAT is a sustain-number cap, not the anti-stall's job. A zero-offense
    turtle wins/farms nothing regardless; the DRIFT lane + depth floor + economic XP ×2/×4 own the idle-sitter.
    Conclusion: every PRODUCTIVE fight resolves and any dragged fight gets dangerous (3a) — no farm-stall survives.`)
}

// ---------- §8 DUNGEON DIFFICULTY · LEVEL-EQUIVALENCE · THE OUTLEVEL PENALTY · the clear-target retune ----------
const DUNGEON_LEVEL = (D) => 3 + 4 * (D - 1) // difficulty 1–5 → the parity-authoring level of its foes
const foeLevelEquiv = (foe) => Math.round(1 + ((foe.P + foe.E + foe.S) / 3 - 10) / 2) // invert parity 10+2(L−1)
const OUTLEVEL_GRACE = 2, OUTLEVEL_K = 0.15, OUTLEVEL_FLOOR = 0.1
const outlevelMult = (pL, fL) => Math.max(OUTLEVEL_FLOOR, Math.min(1, 1 - OUTLEVEL_K * Math.max(0, pL - fL - OUTLEVEL_GRACE)))
function section8() {
  console.log('\n════ §8 DUNGEON DIFFICULTY (1–5) · LEVEL-EQUIVALENCE · OUTLEVEL PENALTY · the 50–60-clear retune ════')
  console.log('Dungeon difficulty 1–5 → dungeon LEVEL (the parity-authoring level of its foes), ±2 ramp within each:')
  console.log('  ' + [1, 2, 3, 4, 5].map((D) => `D${D}→L${DUNGEON_LEVEL(D)}`).join(' · ') + '   (D5 = the "18+" endgame; you climb D1→D5 as you level)')
  console.log('Foe level-equivalent (SELF-rated from the statline, inverting parity): L ≈ 1 + (avgStat−10)/2')
  console.log(`  check — minion@L3: ${foeLevelEquiv(makeFoe('minion', 3))} · elite@L11: ${foeLevelEquiv(makeFoe('elite', 11))} · boss@L19: ${foeLevelEquiv(makeFoe('boss', 19, 'heavy'))} ✓`)
  console.log(`Outlevel XP penalty (anti-backtrack-farm): mult = clamp(1 − ${OUTLEVEL_K}·max(0, pL − fL − ${OUTLEVEL_GRACE}), ${OUTLEVEL_FLOOR}, 1)`)
  console.log('  gap pL−fL:  ' + [0, 2, 4, 6, 8, 10].map((g) => `+${g}: ×${outlevelMult(10, 10 - g).toFixed(2)}`).join(' · '))
  console.log(`  → within ${OUTLEVEL_GRACE} levels = full XP; one tier down (gap~4) ×${outlevelMult(10, 6).toFixed(2)}; two tiers (gap~8) floors at ×${OUTLEVEL_FLOOR} (farming trivial content is pointless). Above-level = ×1.0 (optional bonus is a lever).`)

  const need = (L, base) => Math.round((base * Math.pow(L, 1.7)) / 5) * 5
  const clearsToCap = (base) => {
    let lvl = 3, xp = 0, c = 0, g = 0
    while (lvl < 21 && g++ < 100000) {
      const L = Math.min(20, Math.max(3, lvl)) // a level-MATCHED dungeon (difficulty climbs with you → gap 0, no penalty)
      xp += 7 * xpFor(makeFoe('minion', L)) + 2.5 * xpFor(makeFoe('elite', L)) + xpFor(makeFoe('boss', L, 'heavy'))
      c++
      while (lvl < 21 && xp >= need(lvl, base)) { xp -= need(lvl, base); lvl++ }
    }
    return c
  }
  console.log('\nCurve base retune — target 50–60 level-matched DUNGEON clears to ★ (income rises with dungeon level,')
  console.log('so the need-base must rise to match; L^1.7 keeps need outpacing income → clears/level grows with level):')
  for (const b of [80, 95, 110, 125]) console.log(`  base ${String(b).padStart(3)}×L^1.7 → ${clearsToCap(b)} clears`)
  console.log(`  PICK: 110×L^1.7 → ~${clearsToCap(110)} clears (hits 50–60; a first warren clear still ≈ 1 level).`)
  console.log(`  steps: need(1→2)=${need(1, 110)} · (2→3)=${need(2, 110)} · (3→4)=${need(3, 110)} (teaching overrides re-tuned to the first two).`)
}

// ---------- §9 GOLD ACCUMULATION → THE CHARACTER-SLOT COST CURVE ----------
// Faithful to loot.ts: gold = foeValue × GOLD_K × depthMult × (1±0.3, avg 1); per-tier drop counts,
// guaranteed-gold WAGES, and the category P(gold) after the disabled gear/spellbook weight redistributes.
const GOLD_K_SIM = 0.12
const fval = (f) => f.hp / 10 + f.P + f.E + f.S
const DEPTH_BY_TIER = { minion: 1.2, elite: 1.4, boss: 1.6 } // avg depthMult within a clear (minions early, boss deep)
const LOOT = { minion: { drops: 1, wage: 0, pGold: 60 / 90 }, elite: { drops: 2.5, wage: 2, pGold: 45 / 80 }, boss: { drops: 5, wage: 4, pGold: 30 / 70 } }
const goldPerFoe = (f) => { const g = LOOT[f.tier], unit = fval(f) * GOLD_K_SIM * DEPTH_BY_TIER[f.tier]; return unit * g.wage + unit * g.drops * g.pGold }
const goldPerClear = (L) => 7 * goldPerFoe(makeFoe('minion', L)) + 2.5 * goldPerFoe(makeFoe('elite', L)) + goldPerFoe(makeFoe('boss', L, 'heavy'))

// character-slot cost curve: slot N (N≥2; slot 1 free). Cheap to ~10, steep 11→20.
const slotCost = (N) => N <= 10 ? Math.round(40 * N * N / 50) * 50 : Math.round((40 * 100 + 120 * (N - 10) * (N - 10)) / 50) * 50

function section9() {
  console.log('\n════ §9 GOLD ACCUMULATION → CHARACTER-SLOT COST CURVE ════')
  console.log(`Gold/clear by dungeon level (loot.ts model, GOLD_K ${GOLD_K_SIM}, depth-weighted):`)
  for (const L of [3, 7, 11, 15, 19]) console.log(`  L${String(L).padStart(2)} (D${(L - 3) / 4 + 1}): ${Math.round(goldPerClear(L))}g/clear`)
  const need = (L) => Math.round((110 * Math.pow(L, 1.7)) / 5) * 5
  let lvl = 3, xp = 0, gold = 0, clears = 0, g = 0
  while (lvl < 21 && g++ < 100000) {
    const L = Math.min(20, Math.max(3, lvl))
    xp += 7 * xpFor(makeFoe('minion', L)) + 2.5 * xpFor(makeFoe('elite', L)) + xpFor(makeFoe('boss', L, 'heavy'))
    gold += goldPerClear(L); clears++
    while (lvl < 21 && xp >= need(lvl)) { xp -= need(lvl); lvl++ }
  }
  console.log(`\nLIFETIME GOLD 1→★ (gross, ${clears} clears, level-matched): ~${Math.round(gold).toLocaleString()}g (${(gold / 1000).toFixed(1)}k)`)
  console.log('  net-of-sinks (a char spends some on consumables/spellbooks) is lower → slot costs want headroom under gross.')
  console.log('\nCHARACTER-SLOT cost curve (slot 1 free; cumulative to own N slots):')
  let cum = 0
  for (const N of [2, 5, 8, 10, 12, 15, 18, 20]) { /* show milestones */ }
  cum = 0
  const cumAt = (n) => { let s = 0; for (let i = 2; i <= n; i++) s += slotCost(i); return s }
  for (const N of [5, 10, 12, 15, 20]) console.log(`  slot ${String(N).padStart(2)}: ${String(slotCost(N)).padStart(6)}g  ·  cumulative to ${N} slots: ${cumAt(N).toLocaleString()}g`)
  console.log(`\n  AFFORDABILITY INVARIANT: lifetime gold (~${(gold / 1000).toFixed(1)}k) vs the single most-expensive slot (#20 = ${slotCost(20).toLocaleString()}g):`)
  console.log(`    one 1→★ run ${gold >= slotCost(20) ? 'CLEARS' : 'FALLS SHORT OF'} slot #20 (margin ×${(gold / slotCost(20)).toFixed(1)}) — you can always fund the next slot by leveling one more hero.`)
  console.log(`  Targets: first 10 slots ${(cumAt(10) / 1000).toFixed(0)}k (intuition 10–30k) · slots 11–20 +${((cumAt(20) - cumAt(10)) / 1000).toFixed(0)}k (intuition +100k) · all-20 ${(cumAt(20) / 1000).toFixed(0)}k`)
}

// ---------- §10 DREAD DRIFT (the soft lane) — curve validation before the engine build ----------
function section10() {
  console.log('\n════ §10 DREAD DRIFT (soft lane) — curve validation: bounded by the TRAPS §6 ceiling (CRAWL §5.8) ════')
  const DRIFT_BASE = 0.14 // c/s — the shipped Ember Drift (1 card / 7s)
  const CEILING = 0.4 // TRAPS §6 net-transmute ceiling (c/s) — the makeable-FLOOR + composition guarantee
  // gentle through the knee (dread 5), then steepens toward the ceiling at dread 10
  const driftCurve = (d) => d <= 5 ? DRIFT_BASE * (1 + 0.1 * (d - 1)) : DRIFT_BASE * (1.4 + 0.22 * (d - 5))
  const reshape = (sets) => (sets * 3) / 20 // player reshape c/s = sets/round × 3 cards / 20s round
  console.log(`drift = base(${DRIFT_BASE} c/s) × curve(dread), knee@5 → ceiling@10. Player reshape: baseline 3 sets/rnd (${reshape(3).toFixed(2)} c/s) · struggling 1.8 (${reshape(1.8).toFixed(2)}):`)
  for (const d of [1, 3, 5, 7, 9, 10]) {
    const dr = driftCurve(d)
    const sb = reshape(3) / (reshape(3) + dr), ss = reshape(1.8) / (reshape(1.8) + dr)
    console.log(`  dread ${String(d).padStart(2)}: drift ${dr.toFixed(3)} c/s (${(dr * 20).toFixed(1)}/rnd) · reshape share — baseline ${(sb * 100).toFixed(0)}% · struggling ${(ss * 100).toFixed(0)}%${dr > CEILING ? '  ⚠ OVER CEILING' : ''}`)
  }
  const max = driftCurve(10)
  console.log(`  CEILING ${CEILING} c/s: max drift (dread 10) = ${max.toFixed(3)} → ${max <= CEILING ? 'WITHIN ceiling ✓' : 'OVER ceiling ✗'}`)
  console.log(`  READ: reshape share glides ~76%→~56% (baseline) over the arc — the INTENDED soft tension (the board rots`)
  console.log(`  faster the longer you drag), still player-majority; a struggling player feels it harder (~44% at max), as designed.`)
  console.log(`  Because drift stays ≤ the ceiling, the makeable FLOOR holds (TRAPS §6: ≤ceiling IS the floor guarantee, on top`)
  console.log(`  of the engine's per-reform floor invariant). Quantize to the rollover: N pulls/round off the curve. SAFE TO BUILD.`)
}

// ---------- §11 THE COUPLED BALANCE PASS — gear riders × ability values × the foe-difficulty raise ----------
const RARITY = ['grey', 'white', 'green', 'blue', 'purple', 'orange']
const GEAR_RIDER = [0, 1, 2, 3, 4, 5] // §7 weapon base rider: +dmg per ATTACK card by rarity (first-cut)
const expectedRider = (L) => Math.min(5, Math.max(0, Math.floor((L - 3) / 3.4))) // rarity climbs ~1 tier / 3.4 levels
function section11() {
  console.log('\n════ §11 THE COUPLED BALANCE PASS — gear riders × ability values × the foe-difficulty raise (CRAWL §7) ════')
  const BARE_SET = RATE_BASE * QSUM // ~24.8: one attack set at parity

  // ── Part 1: gear RIDERS → the ~⅓ power share ──
  console.log('\n── Part 1: gear RIDERS (flat +dmg/Attack card, ×3 a set) → the gear power share ──')
  console.log(`  bare attack set ≈ ${BARE_SET.toFixed(1)}; gear share = 3·rider / (bare + 3·rider):`)
  RARITY.forEach((r, i) => {
    const gear = 3 * GEAR_RIDER[i]
    console.log(`    ${r.padEnd(7)} +${GEAR_RIDER[i]}/card → +${gear}/set · set ${(BARE_SET + gear).toFixed(0)} · gear share ${String(Math.round((100 * gear) / (BARE_SET + gear))).padStart(2)}%`)
  })
  console.log('  → orange ≈ ⅓ of attack power (the target); +0..+5/card is the magnitude. Armor mirrors it (+Block/Defend card).')

  // ── Part 2: the FOE-DIFFICULTY RAISE (the "combat too easy" fix) ──
  const gearFactor = (L) => (BARE_SET + 3 * expectedRider(L)) / BARE_SET
  console.log('\n── Part 2: the FOE-DIFFICULTY RAISE — foes balanced vs the rarity-current GEARED baseline ──')
  console.log('  expected rarity by level: ' + [3, 7, 11, 15, 19].map((L) => `L${L}→${RARITY[expectedRider(L)]}(×${gearFactor(L).toFixed(2)})`).join(' · '))
  console.log('  Foe HP + telegraph rise by that factor so the kill budget holds against geared output.\n')
  console.log('  winrate % / TTK rounds (baseline skill 3, balanced parity):')
  for (const L of [11, 19]) {
    const f = gearFactor(L), r = expectedRider(L)
    console.log(`  — L${L} (expected ${RARITY[r]}, ×${f.toFixed(2)}) —`)
    for (const tier of ['minion', 'elite', 'boss']) {
      const foe = makeFoe(tier, L, tier === 'boss' ? 'heavy' : 'steady')
      const G = { gearRider: r, gearBlock: r } // a FULL kit: attack (weapon) AND defense (armor) riders
      const bare = mc(foe, L, 3, {}, 3000, 50)
      const gOld = mc(foe, L, 3, G, 3000, 50)
      const raised = { ...foe, hp: Math.round(foe.hp * f) }
      const gNew = mc(raised, L, 3, { ...G, foeDmgMult: f }, 3000, 50)
      const skill = mc(raised, L, 5, { ...G, foeDmgMult: f }, 3000, 50)
      console.log(`    ${tier.padEnd(6)}: bare ${(bare.winrate * 100).toFixed(0)}/${bare.ttk.toFixed(1)} · geared-vs-OLD ${(gOld.winrate * 100).toFixed(0)}/${gOld.ttk.toFixed(1)} · geared-vs-RAISED ${(gNew.winrate * 100).toFixed(0)}/${gNew.ttk.toFixed(1)} · skilled-vs-RAISED ${(skill.winrate * 100).toFixed(0)}/${skill.ttk.toFixed(1)}`)
    }
  }
  console.log("  READ: 'geared-vs-OLD' = the too-easy problem (free gear power). 'geared-vs-RAISED' should ≈ 'bare' (intended")
  console.log("  curve restored). 'skilled-vs-RAISED' over-performs — the build/card-skill reward, by design.")

  // ── Part 3: ability EFFECT VALUES (empirical) → throughput-neutral pricing ──
  console.log('\n── Part 3: ability effect VALUES (marginal win-rate impact) → the pricing currency ──')
  const refFoe = makeFoe('boss', 11, 'heavy') // a mid-winrate fight so marginals are visible
  const base = mc(refFoe, 11, 3, {}, 8000, 60).winrate
  const dWin = (opts) => mc(refFoe, 11, 3, opts, 8000, 60).winrate - base
  const U = 6
  const perUnit = { damage: dWin({ bonusDmg: U }) / U, block: dWin({ bonusBlock: U }) / U, heal: dWin({ bonusHeal: U }) / U, charge: dWin({ bonusCharge: 3 }) / 3 }
  console.log(`  reference: boss L11, baseline skill, base winrate ${(base * 100).toFixed(0)}%; relative value = Δwin-per-unit ÷ damage's:`)
  for (const [k, v] of Object.entries(perUnit)) console.log(`    ${k.padEnd(7)}: ${(v / perUnit.damage).toFixed(2)} × damage   (Δwin/unit ${(v * 100).toFixed(2)}pp)`)
  console.log(`  closed-form predicted: block ~1.0 · heal ~1.0 · charge ~3.5. VPM anchor: 15-mana burst ≈ 60 dmg → VPM ≈ 4 dmg/mana.`)
  console.log(`  ability cost = (effect value in dmg-equiv) ÷ VPM(4): 40-dmg spell → 10 mana · 40-HP heal → ~10 · 3-charge grant → ~3.`)
}

// ---------- §12 THE AFFIX POWER LAYER (chunk ② — affixes = UNPRICED upside, must stay BOUNDED) ----------
// Affixes are NOT counted in foe tuning (§7) → they push winrate ABOVE the geared baseline. The job
// here is to bound that push: a full affix loadout is a REWARD (build/luck), never mandatory or
// trivializing. We derive: the affix magnitude (AFFIX_DMG), the loot-tier scalar (LOOTTIER_K), the
// off-stat patch amount, and the curse severity — the numbers §7 left open.
const PER_AFFIX_POWER = { white: 1.4, green: 1.0, blue: 0.7, purple: 0.6, orange: 0.5 } // §7 inverse budget
const MAX_AFFIX = { white: 1, green: 2, blue: 3, purple: 4, orange: 5 }
const avgCount = (r) => (1 + MAX_AFFIX[r]) / 2 // random 1..max → mean count
const AFFIX_DMG = 0.55 // PROPOSED: dmg-equiv/round per 1.0 perAffixPower-unit, per affix (best-case offensive proc)
const LOOTTIER_K = 0.02 // PROPOSED: affix magnitude × (1 + lootTier·k); lootTier ≈ foe L + dungeon L
function section12() {
  console.log('\n════ §12 THE AFFIX POWER LAYER — unpriced upside, BOUNDED (CRAWL §7 still-open numbers) ════')

  // ── Part A: the inverse-budget curve (per-affix DOWN, total gently UP, count = variance) ──
  console.log('\n── Part A: the inverse budget — per-affix power vs total (the cross-rarity texture) ──')
  for (const r of ['white', 'green', 'blue', 'purple', 'orange']) {
    const total = avgCount(r) * PER_AFFIX_POWER[r]
    console.log(`    ${r.padEnd(7)} maxAffix ${MAX_AFFIX[r]} · per-affix ×${PER_AFFIX_POWER[r].toFixed(1)} · avg count ${avgCount(r).toFixed(1)} · avg TOTAL ${total.toFixed(2)} units`)
  }
  console.log('  → per-affix FALLS (white ×1.4 → orange ×0.5) while the TOTAL stays ~FLAT (1.4–1.5): the intended')
  console.log('    cross-rarity affix PARITY (white\'s 1 strong affix ≈ blue\'s 3 diluted). Rarity\'s real edge is the')
  console.log('    base RIDER + the affix COUNT (more slots = build flexibility), NOT raw affix power.')

  // ── Part B: the full-kit winrate BUMP (the reward band) — vs the §11 RAISED-foe reference ──
  console.log('\n── Part B: full affix loadout → winrate bump (must REWARD, not trivialize) ──')
  console.log(`  model: a built kit picks proc affixes ≈ perAffixPower × AFFIX_DMG(${AFFIX_DMG}) × lootScale, ×5 slots, /round.`)
  console.log('  winrate: geared baseline (no affix) → +full affixes (baseline skill 3) → +full affixes (skilled 5):')
  for (const L of [11, 19]) {
    const r = expectedRider(L), rar = RARITY[r], f = (RATE_BASE * QSUM + 3 * r) / (RATE_BASE * QSUM)
    const lootScale = 1 + (2 * L) * LOOTTIER_K // lootTier ≈ foe L + dungeon L ≈ 2L (level-matched)
    const kitDmg = 5 * avgCount(rar) * PER_AFFIX_POWER[rar] * AFFIX_DMG * lootScale
    for (const tier of ['elite', 'boss']) {
      const raised = { ...makeFoe(tier, L, tier === 'boss' ? 'heavy' : 'steady'), hp: Math.round(makeFoe(tier, L, tier === 'boss' ? 'heavy' : 'steady').hp * f) }
      const G = { gearRider: r, gearBlock: r, foeDmgMult: f }
      const noAff = mc(raised, L, 3, G, 4000, 70).winrate
      const aff = mc(raised, L, 3, { ...G, bonusDmg: kitDmg }, 4000, 70).winrate
      const affSkill = mc(raised, L, 5, { ...G, bonusDmg: kitDmg }, 4000, 70).winrate
      console.log(`    L${L} ${tier.padEnd(6)} (${rar}, kit +${kitDmg.toFixed(0)} dmg/rnd): ${(noAff * 100).toFixed(0)}% → ${(aff * 100).toFixed(0)}% (base) → ${(affSkill * 100).toFixed(0)}% (skilled)`)
    }
  }
  console.log('  TARGET: a full kit makes the boss winnable at baseline (~55–65%, build is a real gate-opener) while')
  console.log('  skilled stays < ~88% (affixes reward, never auto-win); bare/under-affixed holds the §11 ~36% gate.')

  // ── Part C: the off-stat PATCH amount (a raw-stat affix's value) ──
  console.log('\n── Part C: off-stat affix (raw +P) — pick the patch amount (meaningful, bounded by the clamp) ──')
  const cf = makeFoe('boss', 11, 'heavy'), f11 = (RATE_BASE * QSUM + 3 * expectedRider(11)) / (RATE_BASE * QSUM)
  const raised11 = { ...cf, hp: Math.round(cf.hp * f11) }
  const Gp = { gearRider: expectedRider(11), gearBlock: expectedRider(11), foeDmgMult: f11 }
  const b0 = mc(raised11, 11, 3, Gp, 6000, 80).winrate
  for (const amt of [2, 3, 4]) {
    const w = mc(raised11, 11, 3, { ...Gp, statBonus: { P: amt } }, 6000, 80).winrate
    console.log(`    +${amt} P → ${(w * 100).toFixed(0)}% (Δ ${((w - b0) * 100).toFixed(1)}pp vs ${(b0 * 100).toFixed(0)}% base)`)
  }
  console.log('  → an off-stat affix ≈ +2–3 to a stat is a real patch but bounded (a rider out-values it — §7 intent).')

  // ── Part D: the loot-tier scalar (warren vs deep) ──
  console.log('\n── Part D: loot-tier scalar — same rarity, shallow vs deep dungeon ──')
  for (const lt of [6, 14, 24]) console.log(`    lootTier ${String(lt).padStart(2)} → affix ×${(1 + lt * LOOTTIER_K).toFixed(2)} magnitude`)
  console.log(`  → k=${LOOTTIER_K}: a deep (lt24) drop's affixes ≈ ×1.3 a shallow (lt6) one's — chase depth, stays bounded.`)

  // ── Part E: curse severity (the risk/reward equalizer) ──
  console.log('\n── Part E: cursed affix — the offset that makes "strong+curse" ≈ "clean+weaker" ──')
  const cleanBump = mc(raised11, 11, 3, { ...Gp, bonusDmg: 8 }, 6000, 80).winrate - b0
  for (const curse of [{ P: -2 }, { P: -3 }]) {
    const w = mc(raised11, 11, 3, { ...Gp, bonusDmg: 12, statBonus: curse }, 6000, 80).winrate
    console.log(`    +12 dmg/rnd WITH curse ${JSON.stringify(curse)} → ${(w * 100).toFixed(0)}% (clean +8 dmg ≈ +${(cleanBump * 100).toFixed(1)}pp)`)
  }
  console.log('  → a curse worth ~−2/−3 stat offsets a fatter proc → the cursed item competes, never dominates (§7).')
}

// ---------- §13 THE COMBO/CRIT CURVE — chains + combos per skill tier → fit crit to the targets ----------
// Model: a ROUND_S round, `sets` matches; gaps ~ exponential(mean ROUND_S/sets) — captures BURSTY play
// (many fast matches + the occasional scan pause). A 3s GRACE links matches: a CHAIN = a maximal run of
// gaps ≤3s (highestChain = the longest run, the skill-shine, UNnormalized); COMBOS = matches landing in
// grace (= matches − run-starts), NORMALIZED by any round extension so stall-stretching can't farm it.
const GRACE_S = 3
const SKILL_TIERS = [['floor', 3], ['competent', 5], ['good', 8], ['great', 10], ['excellent', 12], ['peak', 15]]
function comboMetrics(sets, rng, roundS = 20) {
  let t = 0; const times = []
  for (let i = 0; i < sets * 2 && times.length < sets; i++) { t += -(roundS / sets) * Math.log(1 - rng()); if (t > roundS) break; times.push(t) }
  let run = 1, highest = times.length ? 1 : 0, combos = 0
  for (let i = 1; i < times.length; i++) { if (times[i] - times[i - 1] <= GRACE_S) { run++; combos++ } else run = 1; if (run > highest) highest = run }
  return { highest, combos }
}
// the fitted curve (S-shaped: flat-low so floor≈competent, steep mid, diminishing toward the soft cap):
// score = highestChain + COMBO_W·normalizedCombos; crit = SOFT_CAP / (1 + e^(−A(score−M))). + gear(Keen).
// Gear (Keen) and Vorpal feed the SAME score, so the diminishing curve caps EVERYTHING (play+gear) at
// SOFT_CAP — the "practical cap" is the asymptote, no hard clamp needed (KEEN_MAX_SCORE = a maxed Keen).
const CRIT_SOFT_CAP = 0.25, CRIT_A = 0.42, CRIT_M = 7.0, COMBO_W = 0.5, KEEN_MAX_SCORE = 3
function critCurve(score) { return CRIT_SOFT_CAP / (1 + Math.exp(-CRIT_A * (score - CRIT_M))) }
function critFromPlay(highest, combos, keenScore = 0) { return critCurve(highest + COMBO_W * combos + keenScore) }
function section13() {
  console.log('\n════ §13 THE COMBO/CRIT CURVE — chains+combos per skill tier → crit chance (CRAWL §7) ════')
  console.log('  model: ROUND 20s, gaps ~ exp(mean 20/sets), 3s grace. TARGETS: competent ≈ 5% · peak ≈ ~25% ·')
  console.log('  floor ≈ competent (flat low) · diminishing returns up top. crit = play-curve + gear(Keen).')
  console.log('  tier         sets · highestChain · combos · → crit% (play only)')
  for (const [name, sets] of SKILL_TIERS) {
    let H = 0, C = 0
    const N = 20000
    for (let i = 0; i < N; i++) { const m = comboMetrics(sets, mulberry32(i + sets * 131), 20); H += m.highest; C += m.combos }
    H /= N; C /= N
    const crit = critFromPlay(H, C)
    const critKeen = critFromPlay(H, C, KEEN_MAX_SCORE) // + a maxed Keen (gear feeds the SAME score)
    console.log(`  ${name.padEnd(11)} ${String(sets).padStart(2)}  · chain ${H.toFixed(1)} · combos ${C.toFixed(1)} · → ${(crit * 100).toFixed(1)}% play · ${(critKeen * 100).toFixed(1)}% +maxKeen`)
  }
  console.log(`  → soft cap ${(CRIT_SOFT_CAP * 100).toFixed(0)}% is the asymptote: even peak + maxed Keen stays ≤ ~25% (diminishing, never reliable).`)
  console.log('  NORMALIZE note: combos ÷= (actualRoundMs / ROUND_MS) live (stall-stretch can\'t farm combos); the')
  console.log('  UNnormalized highestChain still lets a stretched round SHINE via a couple of long chains.')
}

// ---------- run ----------
console.log('SET.crawl — the numbers workshop (progression package derivation + conformance)')
section1(); section2(); section3(); section4(); section5(); section6(); section7(); section8(); section9(); section10(); section11(); section12(); section13()
console.log('\nDone. Constants marked PROPOSED are the sim-backed picks for TUNING.md.')
