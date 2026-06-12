# TUNING.md — live engine constants (code is the source of truth)

**The numbers below live in code; this file is a mirror, not an authority.**
Design docs should cite `TUNING.md` instead of inlining numbers — when a
constant changes in code, update it here (one place) rather than chasing prose
across the design docs. Verified against `src/` on 2026-06-11 (the ROUNDS v3 +
Resolution v3 contests build). ⚠ Every contest/tier constant is a **first cut**
pending the derivation-sheet sim — directionally settled, numerically sim-fodder.

## The derivation sheet — axioms (CRAWL §5.6; the sim validates against these)

| # | Axiom | Value |
|---|---|---|
| A1 | The round is THE pacing constant | `ROUND_S` 20 · rollover ≤ ~2.5s diegetic, never a modal |
| A2 | Baseline play = **6/6/6** | one magnitude-6 set per verb per round (~a match / 6–7s); competent ≈ ×2 (measured 4–6 sets/round) |
| A3 | The decimal rebase | HP 100 · stats 10 (both combatants carry P/E/S) |
| A4 | Even = average | at stat parity + baseline play the exchange is even: a mag-6 Defend set ≈ neutralizes the average telegraph (~25); a mag-6 Attack set ≈ 25 |
| A5 | Tiers are output multipliers | minion ×1.0 · elite ×1.5 · boss ×2.0 of baseline output (skill and gear are interchangeable against the ladder) |
| A6 | Kill budgets per tier | **OPEN** — rounds-to-kill targets, set with the headless budget-conformance sim |

## Rounds v3 — the round grammar (LIVE)

| Constant / law | Value | File | Meaning |
|---|---|---|---|
| `ROUND_MS` | 20 000 | `src/engine/state.ts` | Round length (A1) |
| Rollover order | swing → counter → dump → deal → telegraph | `src/engine/combat.ts` (`rollover`) | Player swing FIRST; **lethal cancels** (the kill-race, symmetric) |
| Wound inflict | `floor(bite / (maxHP/10))` per EXCHANGE, cap 5 | `src/engine/triggers.ts` (`inflictWounds`) | Computed, never authored; Defend is the primary prevention |
| Wound repair | `ceil(heal / (maxHP/10))` | `src/engine/ops.ts` (`healPlayer`) | Any heal knits wounds; keyed to the heal's SIZE (full-HP heals still repair) |
| Wound recovery | 1 per draw phase; all at combat end | `src/engine/combat.ts` | Wound pendings never time-reform |
| Ward cost (SG, live) | board verb 1 · wound `WOUND_WARD_COST` 3 | `src/engine/ops.ts` (`tryWard`) | Stand Ground intercepts live; bank carries across rollovers |
| `CHARGE_CAP` | 15 | `src/engine/state.ts` | Exact both ways: a max 5-wound haymaker (5×3) or a whole-board dump |
| Maneuver dump | ALL charges at rollover → ⌊bank⌋ deadest NOT-matching cards → bias; bank zeroes | `src/engine/tactics.ts` (`rolloverDump`) | No-bias holds (no waste); overflow past available cards burns |
| Stance lock | `setTactic`/`setBias` QUEUE; lock at the deal | `src/engine/tactics.ts` | The round-lock IS the commitment (spin-up retired) |
| Block reset | accumulators + Maneuver bank → 0 at the exchange; mana + SG bank + HP carry | `src/engine/combat.ts` | Excess block = **pure loss** (no trickle — settled 2026-06-11); Sentinel's Overflow passive is the paid exception |
| `ROUND_EXTEND_CAP_S` | 10 | `src/engine/state.ts` | ⚠ INTERIM stall re-anchor: clock-push verbs stretch the round, capped (uncapped potions bypass) |
| `MANA_CAP` | 15 / color | `src/engine/state.ts` | Gains past it are pure loss |
| `DEFAULT_PLAYER_MAX` | 100 | `src/engine/state.ts` | A3; the save layer migrates HP-30 saves in proportion |
| `START_GRACE_MS` | 3000 | `src/engine/state.ts` | UI freezes the round after Engage |

## Resolution v3 — the stat contests (LIVE, first-cut)

Per card: `rate(yourStat, theirOpposed) × QUALITY[mag]`, QUALITY = ①×0.7 ②×1.0 ③×1.4.

| Constant | Value | File | Meaning |
|---|---|---|---|
| `BASE_STATS` | P/E/S 10/10/10 | `src/engine/state.ts` | Parity statline, both sides (A3) |
| `RATE_BASE` / `RATE_K` | 8 / 0.8 | `src/engine/resolve.ts` | Attack/Defend lanes: `clamp(8 + 0.8·(A−B), 2, 20)`; parity mag-6 set ≈ 25 (A4) |
| `MOVE_RATE_*` | base 1 · k 0.1 · clamp 0.2–3 | `src/engine/resolve.ts` | Move lane, in charge POINTS (fractional; gauge floors into pips) |
| `DMG_BUDGET_K` | 2.5 | `src/engine/foe.ts` | Foe round damage budget = `Power × 2.5` (parity → 25) |
| Tempo law | diff = S−P: ≥+4 → 3 swings · −1..+3 → 2 · −4..−2 → 1 · −7..−5 → every 2nd ×2 · ≤−8 → every 3rd ×3 | `src/engine/foe.ts` | Packaging derives from the statline; per-swing budget conserves the round rate |
| Foe stat bridge | tier P anchor 8/11/13 ± heft(±3 from legacy per-hit) · E = 10 + 2 elite / + 4 boss · S from band (6/8/10/12/14) | `src/engine/foe.ts` | ⚠ FIRST-CUT bridge from legacy data — the data rebase authors P/E/S directly and retires it |
| `LEGACY_HP_SCALE` / `LEGACY_DMG_SCALE` | ×10/3 | `src/engine/foe.ts` / `src/engine/triggers.ts` | Legacy creature HP + trap damage → HP-100 world (retired by the data rebase) |
| Player numbers sweep | abilities/potions/passives ×3 | `abilities.ts` / `consumables.ts` / `passives.ts` | ⚠ Mechanical first cut for HP-100 — re-derive in the sim |

## Board generation (unchanged)

| Constant | Value | File | Meaning |
|---|---|---|---|
| `COMBAT_GEN.n` | 15 | `src/engine/combat.ts` | Board size (5×3 grid) |
| `COMBAT_GEN.active` | `[0, 1, 3]` | `src/engine/combat.ts` | Active axes: color, shape, number — shading (axis 2) dropped/pinned |
| `COMBAT_GEN.camoDepth` | 1 | `src/engine/combat.ts` | Target easiest-k (gimmes always present) |
| `COMBAT_GEN.escapeRoutes` | 6 | `src/engine/combat.ts` | Sets at the easiest k |
| `COMBAT_GEN.floor` | 1 | `src/engine/combat.ts` | Minimum makeable sets, always (⚠ assert vs worst-case wounds+locks in the sim) |
| `BIAS_W` | 8 | `src/engine/select.ts` | Transmute favour weight (mid-round regen is NEUTRAL — bias expresses only via the dump) |

## Trap severity law (unchanged)

| Rule | Value | File | Meaning |
|---|---|---|---|
| `scale: 'set_mag'` | `max(1, totalMagnitude − 4)` | `src/engine/triggers.ts` (`scaledBySetMag`) | Severity scales with the springing set's weight (1·1·1 → 1 … 3·3·3 → 5); seconds-valued effects act on the ROUND now |

## Retired by v3 (for the record)

`CLOCK_CAP` + `clockCapMs` + excess-timer income (no clock) · `SWAP_SPINUP_MS` (the
draw-phase lock is the commitment) · `CHURN_MS` (serial churn → the rollover dump) ·
`DMG_REGEN_MS` (wounds knit per draw phase / by heals) · `DEFAULT_WINDUP_S` + per-foe
`windup` (the telegraph reveals at the deal) · speed bands as cadence (→ the Speed stat
+ the tempo law) · **Defend overflow → charges** (both the 1:2 rollover trickle and the
live overcap conversion — excess block is pure loss; Sentinel is the paid exception).

## Dev-instrument design targets (measured live in the combat dev panel)

| Instrument | Target | Source |
|---|---|---|
| Reshape share (player-driven board change vs drift/trap/trick) | **65–70% player** | TRAPS.md §5.5 — ⚠ re-read post-v3 (the dump changes who moves the board, when) |
| Trap-spring rate (hostile traps sprung per match) | **~30%** | TRAPS.md §2 master tuning law |
| Sets/round | ~3 = baseline (A2) · 4–6 = competent | NEW — add to the dev row in the wheel batch |
