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
| A1 | The round is THE pacing constant | `ROUND_S` 20 · rollover ≈ 4.5s staged diegetic beat (playtest-raised from 2.5 — it must be FELT), never a modal |
| A2 | Baseline play = **6/6/6** | one magnitude-6 set per verb per round (~a match / 6–7s); competent ≈ ×2 (measured 4–6 sets/round) |
| A3 | The decimal rebase | HP 100 · stats 10 (both combatants carry P/E/S) |
| A4 | Even = average | at stat parity + baseline play the exchange is even: a mag-6 Defend set ≈ neutralizes the average telegraph (~25); a mag-6 Attack set ≈ 25 |
| A5 | Tiers are output multipliers | minion ×1.0 · elite ×1.5 · boss ×2.0 of baseline output (skill and gear are interchangeable against the ladder) |
| A6 | Kill budgets per tier | **SETTLED (sim, 2026-06-12):** rounds-to-kill at baseline 6/6/6 — minion **2.5** · elite **5** · boss **10** (50s/100s/200s; competent ≈ ×2 halves them). Foe HP derives from the budget: **60 / 110 / 200, level-invariant** (difference math) |

## Rounds v3 — the round grammar (LIVE)

| Constant / law | Value | File | Meaning |
|---|---|---|---|
| `ROUND_MS` | 20 000 | `src/engine/state.ts` | Round length (A1) |
| Rollover order | swing → counter → dump → deal → telegraph | `src/engine/combat.ts` (`rollover`) | Player swing FIRST; **lethal cancels** (the kill-race, symmetric). UI plays it as the `EXCHANGE_BEATS` table (`src/ui/app.ts`): entry thunk 0 · swing drain 800 · counter drain 1950 · tide+knit 3150 · release/stamp 4150, hitstop 4500 (reduced-motion: 2250) |
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

> ✅ **Re-denominated + data rebase SHIPPED 2026-06-12** (foes author P/E/S directly; the legacy
> bridge is gone). The contest constants below are the new LIVE values; the foe-stat bridge,
> `DMG_BUDGET_K`, and the `LEGACY_*` scales are RETIRED.

Per card: `rate(yourStat, theirOpposed) × QUALITY[mag]`, QUALITY = ①×0.7 ②×1.0 ③×1.4.

| Constant | Value | File | Meaning |
|---|---|---|---|
| `BASE_STATS` | P/E/S 10/10/10 | `src/engine/state.ts` | Player L1 = the parity line `10+2(L−1)` at L1 (A3) |
| `RATE_BASE` / `RATE_K` | 8 / **0.2** | `src/engine/resolve.ts` | Attack/Defend lanes: `clamp(8 + 0.2·(A−B), 2, 20)`; parity mag-6 set ≈ 25 (A4). Re-denominated 0.8→0.2 for the level arc |
| `MOVE_RATE_*` | base 1 · k **0.025** · clamp 0.2–3 | `src/engine/resolve.ts` | Move lane, in charge POINTS (fractional; gauge floors into pips). Re-denominated 0.1→0.025 |
| Telegraph law | `telegraphRoundBudget = rate(P_foe, E_player) × TELEGRAPH_QSUM 3.1 × TIER_BUDGET_MULT` (minion 1 / elite 1.5 / boss 2) | `src/engine/resolve.ts` | Foe round budget = the Attack contest × tier (parity → 25×tier, LEVEL-INVARIANT). Finalized vs the live player E in `createCombat`; packaged per-swing by the tempo law. **Replaced `DMG_BUDGET_K`** |
| Tempo law | diff = S−P: ≥+4 → 3 swings · −1..+3 → 2 · −4..−2 → 1 · −7..−5 → every 2nd ×2 · ≤−8 → every 3rd ×3 | `src/engine/foe.ts` (`tempoFromStats`) | UNCHANGED (sim-confirmed); reads the foe's OWN S−P. Per-foe `tempo` override available |
| Foe authoring | P/E/S authored on the parity line `10+2(L−1)` + role spreads (swift −2P/+5S · steady · heavy +2P/−5S · giant +4P/−9S) + tier E bumps (elite +4 / boss +8) | `src/data/game-data.ts` | The data rebase: stats are DATA now, not derived. HP authored ~60/110/200; XP computed (`foe.ts computeXP`) |
| Player numbers sweep | abilities/potions/passives ×3 | `abilities.ts` / `consumables.ts` / `passives.ts` | ⚠ Mechanical first cut for HP-100 — re-derive in the sim (still open) |

## Board generation (unchanged)

| Constant | Value | File | Meaning |
|---|---|---|---|
| `COMBAT_GEN.n` | 15 | `src/engine/combat.ts` | Board size (5×3 grid) |
| `COMBAT_GEN.active` | `[0, 1, 3]` | `src/engine/combat.ts` | Active axes: color, shape, number — shading (axis 2) dropped/pinned |
| `COMBAT_GEN.camoDepth` | 1 | `src/engine/combat.ts` | Target easiest-k (gimmes always present) |
| `COMBAT_GEN.escapeRoutes` | 6 | `src/engine/combat.ts` | Sets at the easiest k |
| `COMBAT_GEN.floor` | 1 | `src/engine/combat.ts` | Minimum makeable sets, always (⚠ assert vs worst-case wounds+locks in the sim) |
| `BIAS_W` | 8 | `src/engine/select.ts` | Transmute favour weight (mid-round regen is NEUTRAL — bias expresses only via the dump) |

## Progression & loot — PLANNED (settled 2026-06-12; **SIM-DERIVED same day**, NOT yet in code)

The full design: `CRAWL-DESIGN.md` §3 (progression/loot) + §5.7 (combat amendments). The
budget-conformance sim (**`sim/progression-sim.mjs`** — deterministic, run `node sim/progression-sim.mjs`)
confirmed/derived the numbers below; ⚠ rows marked **sim** changed from the first-cut guesses.

**Status:** the FOE-MODEL rows (✅ below — re-denomination, parity line, role spreads, telegraph
law, foe HP) **SHIPPED in the data rebase (2026-06-12)** and are now LIVE in the Resolution v3
table above. The rest (levels/HP/stat-points, XP curve, loot, dodge/guard-carry/Maneuver
live-burn) are still PLANNED — they land in the levels/loot build + the combat-amendments batch.

**Sim findings (2026-06-12):**
1. **The telegraph law re-anchors on the contest** *(sim)*: foe round budget =
   `rate(P_foe, E_player) × 3.1 × tierOut` — at parity 25×tier at EVERY level. The raw-P form
   (`P × 2.5`) breaks A4 past the narrow band (parity mitigation is level-invariant in a
   difference system; raw-P budgets would grow ~5×). **`DMG_BUDGET_K` retires** with the rebase.
2. **Tempo bands survive UNCHANGED** *(sim — kills the "×6 bands" guess)*: they read the foe's
   OWN S−P, and role spreads author level-invariant (±9 around the parity line).
3. **Geometric XP is rejected** *(sim)*: XP income grows ~linearly with the parity line, so a
   geometric requirement walls off (~70 clears to cap) AND undershoots the 2→3 anchor. The
   curve is **polynomial**.
4. **The guard-carry fix is confirmed**: under the live reset rule, slow archetypes push
   **+30–55% more damage** through than their budget peers (the felt "slow foes feel harder",
   quantified); the carry rule levels the row without making giants free.
5. **Conformance is level-invariant** ✓ (same-tier winrates hold across L3/L12/L20 at every
   skill) — provided **trap/tick severity authors ∝ intended-level HP** (≈6%·tier of expected
   maxHP); flat numbers let bulk eat the threat layer.
6. **The floor-stress test caught a real engine bug** (fixed in `triggers.ts`, live): blind
   wound picks broke the makeable-set floor in ~13% of locks-then-wounds exchanges.
   `inflictWounds` is now floor-aware (prefer floor-keeping slots → consume a locked card →
   only then break; `floor-stress.test.ts` asserts both orders across 600 seeds).

| Constant | Value | Meaning |
|---|---|---|
| Level cap | **21** (numeric to 20, then ★) | the cap badge |
| HP / level | **+5** | 100 → 200 at cap; gear/passives ~+100 → ~300 practical ceiling |
| Stat points / level | **+3/+2/+1, player-allocated** | +6/level, +120 arc; focused main ≈ +60 |
| ✅ Re-denomination (LIVE) | `RATE_K` **0.2** (was 0.8) · `MOVE_RATE_K` **0.025** (was 0.1) · tempo bands **UNCHANGED** · clamps keep [2,20] / [0.2,3] | +1 main-stat level = +7.5% lane at parity · focused-vs-balanced (±20) = +48% · full kit (+12/stat) = +30% · clamp binds at ±60 diff |
| ✅ Parity line (LIVE) | foe parity stat = **10 + 2·(intended level − 1)** → L3=14 · L12=32 · L20=48 | endgame foes 40–80 ✓; the data rebase authors against this line |
| ✅ Role spreads (LIVE) | swift −2P/+5S · steady 0 · heavy +2P/−5S · giant +4P/−9S, **level-invariant** · elite/boss E bump **+4/+8** | spreads land each tempo band; never widen with level (that's why the bands survive) |
| ✅ Telegraph law (LIVE) | foe budget = `rate(P_f, E_p) × 3.1 × tierOut` (parity → 25×tier at every level) | replaces raw `P × DMG_BUDGET_K` (which breaks A4 over the arc) |
| ✅ Foe HP (LIVE) | minion **60** · elite **110** · boss **200** — level-invariant, derived from A6 | the live rebased warren minions already sit on this line |
| Trap severity *(sim)* | author ∝ intended-level HP: ≈ **6% · tierOut of expected maxHP** per hit | flat numbers let bulk eat the threat layer (boss row drifted 37→90% before this) |
| XP law | `(hp/10 + P + E + S) × (1 + 0.15·traps) × tierMult` | computed, never authored; retires the `xp` field |
| XP tier mult | **×1 / ×2 / ×4** | deliberately above the stat ladder (×1/×1.5/×2) — risk beats grinding |
| XP curve *(sim — geometric REJECTED)* | **polynomial: need(L→L+1) = 55 × L^1.7** (display-rounded to 5s), anchored dummy→L2 · gauntlet→L3 · warren = fresh L3 | first warren minion (55 XP) → L2 exactly · 2→3 ≈ an elite + a minion · first boss ≈ a full level · **~29 tier-appropriate clears to ★** · XP always banks, even on death |
| Gear stat share | **~25%** of endgame stats (~+30–40 pts/kit, ≈+5–7/slot) | gear's identity = per-card riders + slot mechanics (§7), not stats |
| Drop count | minion **1** · elite **2–3** · boss **5** | plus guaranteed gold ×2 / ×4 (elite/boss) |
| Category weights | minion **60/30/10** · elite **45/35/20** · boss **30/40/30** (gold/cons/gear) | elites+bosses roll quality with ADVANTAGE (2×, keep better) |
| Consumable sub-table | **60% potion / 35% scroll / 5% spellbook** | entries stage in as systems land (gear B3, books B4) |
| Gold scale | minion drop ~3–8g · full warren clear ≈ 100–150g | moderate player banks hundreds; chase items in thousands |
| Depth scaling | **~+5–10%/room** loot-quality/gold weight | greed aligns with dread; kills shallow cash-out farming |
| Gear pity | gear weight ticks up per gear-less drop, resets on hit | the elite-sawtooth pattern as bad-luck protection |
| Death tithe | **~12%** of banked gold | the exit ladder's last number |
| Dodge *(sim)* | base **10%** · `DODGE_K` **0.015**/pt of S edge · clamp **[3%, 40%]** · per **swing** · rolled AT THE DEAL, folded into the ⚔ | strikes only; at K 0.015 dodge alone ≈ half a P/E point (ΔS 10.3 vs ΔE 20.3 winrate pts on the boss bench) — the charge agency the model can't price carries the rest; playtest re-read flagged |
| Guard carry | Block persists through windups, **capped at the revealed telegraph** | strikeEvery>1 foes reveal ⚔ at windup start; guard drops only after a strike resolves |
| Maneuver live-burn | **~1 charge/sec**, gather **~1.5–2s** to enter, bail-out to SG instant (keeps remainder) | replaces the rollover dump; burn rate = the scan-stability dial |
| Speed riders | parting blow ↓ with Speed edge · start grace ↑ with Speed edge | the escape stat |
| Crits | **deferred** to gear/abilities (deterministic hooks only) | set output stays exact |

## Delve encounter schema (LIVE, first cut — CRAWL §2)

| Constant | Value | File | Meaning |
|---|---|---|---|
| boss law | `cum(n) = n(n+1)/2 %`, inverse-CDF (one `R ∈ [0,100)` at delve start) | `src/engine/delve.ts` (`bossCumulative`) | Boss at first room where `cum(n) > R` — median 10, guaranteed 14; rooms count encounters ENTERED (cleared or fled); throne room stays found |
| `ELITE_STEP` | 0.10 | `src/engine/delve.ts` | Elite sawtooth: chance = step × rooms since last elite; resets on an elite AND on a flee |
| `RUN_BAG_CAP` | 10 | `src/engine/delve.ts` | The run consumable satchel (the 10-slot run inventory's seed) |
| dread bands | 15 / 45 / 80 (% cum, next room) | `src/engine/delve.ts` (`dreadBand`) | quiet → drums → throne stirs → he is near → throne room found |
| room loot | 1 random consumable (¾ potion / ¼ scroll) | `src/engine/delve.ts` (`rollDelveLoot`) | ⚠ PLACEHOLDER — real loot tables (gold/XP/gear by loot_tier) replace it |

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
