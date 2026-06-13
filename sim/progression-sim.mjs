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
  console.log(`Arc: +3/+2/+1 per level, cap 21 → +120 points; focused main +60, balanced +40/stat.
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

/** One combat. skill = sets/round (A2: struggling 1.8 · baseline 3 · competent 5).
 *  guardRule: 'reset' (live code) | 'carry' (§5.7 — persists through windup, capped at telegraph).
 *  Player stats default balanced parity at L; override for the EV tests. */
function fight(foe, L, skill, rng, opts = {}) {
  const guardRule = opts.guardRule ?? 'carry'
  const pStats = opts.stats ?? { P: parityStat(L), E: parityStat(L), S: parityStat(L) }
  const pMax = maxHP(L)
  let pHP = pMax, fHP = foe.hp, wounds = 0, guard = 0, charges = 0
  let telegraph = null, strikeRound = foe.strikeEvery // next round a strike lands
  const budget = foeBudget(foe, pStats.E)
  const perSwing = (budget * foe.strikeEvery) / foe.swings
  const atkRate = rate(pStats.P, foe.E) // per card
  const defRate = rate(pStats.E, foe.P)
  const chgRate = moveRate(pStats.S, foe.S)
  const woundQ = pMax / 10
  let dmgTaken = 0, rounds = 0

  for (let round = 1; round <= 40; round++) {
    rounds = round
    // telegraph reveal: strike round (rule reset) — or at windup start (rule carry, strikeEvery>1)
    const revealAt = guardRule === 'carry' ? strikeRound - (foe.strikeEvery - 1) : strikeRound
    if (telegraph == null && round >= revealAt) {
      // roll the strike now (deal-time): per-swing dodge checks fold in BEFORE the reveal
      let t = 0
      const pDodge = Math.min(DODGE_MAX, Math.max(DODGE_MIN, DODGE_BASE + DODGE_K * (pStats.S - foe.S)))
      for (let s = 0; s < foe.swings; s++) if (rng() >= pDodge) t += weightedRoll(perSwing, rng)
      telegraph = t
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
      if (shape === 'atk') bankedAtk += atkRate * q
      else if (shape === 'def') {
        const cap = guardRule === 'carry' && telegraph != null ? telegraph : Infinity
        guard = Math.min(cap, guard + defRate * q) // sated guard: overbank is waste either way
      } else charges = Math.min(15, charges + chgRate * q)
      if (rng() < TRAP_SPRING_P) { // the trap tax: bypasses guard; severity ∝ intended-level HP
        pHP -= TRAP_HIT(foe.tier, foe.L)
        dmgTaken += TRAP_HIT(foe.tier, foe.L)
        if (pHP <= 0) return { win: false, rounds, dmgTaken, pHP: 0 }
      }
    }
    if (foe.tier === 'boss') { // ambient dread tick
      pHP -= BOSS_TICK(foe.L)
      dmgTaken += BOSS_TICK(foe.L)
      if (pHP <= 0) return { win: false, rounds, dmgTaken, pHP: 0 }
    }
    // --- the exchange ---
    fHP -= bankedAtk
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
  so the geometric tail walls off (and its early steps undershoot the 2→3 anchor). PROPOSAL:
  need(L→L+1) = ${x3.m} × L^1.7 (display-rounded to 5s) — first minion → L2 exactly, 2→3 ≈ an
  elite + a minion, the first boss kill ≈ a full level, ~29 tier-appropriate clears to ★.`)
}

// ---------- run ----------
console.log('SET.crawl — the numbers workshop (progression package derivation + conformance)')
section1(); section2(); section3(); section4(); section5(); section6()
console.log('\nDone. Constants marked PROPOSED are the sim-backed picks for TUNING.md.')
