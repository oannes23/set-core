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
| Rollover order | swing → counter (strike round only) → deal → telegraph | `src/engine/combat.ts` (`rollover`) | Player swing FIRST; **lethal cancels** (the kill-race, symmetric). §5.7: the Maneuver dump is gone (live-burn), the strike fires only on the strike round (block carries through windups). UI plays it as the `EXCHANGE_BEATS` table (`src/ui/app.ts`): entry thunk 0 · swing drain 800 · counter drain 1950 · tide+knit 3150 · release/stamp 4150, hitstop 4500 (reduced-motion: 2250) |
| Wound inflict | `floor(bite / (maxHP/10))` per EXCHANGE, cap 5 | `src/engine/triggers.ts` (`inflictWounds`) | Computed, never authored; Defend is the primary prevention |
| Wound repair | `ceil(heal / (maxHP/10))` | `src/engine/ops.ts` (`healPlayer`) | Any heal knits wounds; keyed to the heal's SIZE (full-HP heals still repair) |
| Wound recovery | 1 per draw phase; all at combat end | `src/engine/combat.ts` | Wound pendings never time-reform |
| Ward cost (SG, live) | board verb 1 · wound `WOUND_WARD_COST` 3 | `src/engine/ops.ts` (`tryWard`) | Stand Ground intercepts live; bank carries across rollovers |
| `CHARGE_CAP` | 15 | `src/engine/state.ts` | Exact both ways: a max 5-wound haymaker (5×3) or a whole-board dump |
| Maneuver LIVE-BURN | `MANEUVER_GATHER_MS` 1800 · `MANEUVER_BURN_MS` 1000 | `src/engine/state.ts` · `tactics.ts` (`liveBurn`) · `combat.ts` (tick) | §5.7: enter Maneuver → gather, then burn ~1 charge/s, each churning the single deadest NOT-matching card → bias. No-bias / no-target holds the bank. Replaced the rollover dump |
| Stance switching | LIVE (no queue) — `setTactic`/`setBias` apply instantly | `src/engine/tactics.ts` | §5.7: entering Maneuver pays the gather (damps wheel-drumming); bailing to Stand Ground is INSTANT and keeps the bank. The round-lock/queue retired |
| Block reset | accumulators → 0 only AFTER a strike RESOLVES (carries through windup rounds); mana + SG bank + HP carry | `src/engine/combat.ts` | §5.7 guard-carry: a slow foe is a savings test. Excess block past the strike = **pure loss** (settled 2026-06-11); Sentinel's Overflow is the paid exception |
| Early reveal | telegraph shows `strikeEvery−1` rounds early (from round 1), HELD until the strike round | `src/engine/combat.ts` (`rollover`) | §5.7: pairs with guard-carry — you see the slow strike coming and bank against it |
| Dodge | `DODGE_BASE` 0.10 · `DODGE_K` 0.015 · clamp `[0.03, 0.40]`, per SWING, rolled at the deal | `src/engine/state.ts` · `resolve.ts` (`dodgeChance`) · `combat.ts` (`rollStrike`) | §5.7: each swing independently evades (your Speed vs theirs); dodged swings vanish from the telegraph (incoming 0 + dodged>0 = full whiff → the DODGED! card / free round). Strikes only |
| `ROUND_EXTEND_CAP_S` | 10 | `src/engine/state.ts` | ⚠ INTERIM stall re-anchor: clock-push verbs stretch the round, capped (uncapped potions bypass) |
| `MANA_CAP` | 15 / color | `src/engine/state.ts` | Gains past it are pure loss |
| `DEFAULT_PLAYER_MAX` | 100 | `src/engine/state.ts` | A3; the save layer migrates HP-30 saves in proportion |
| `START_GRACE_MS` | 3000 | `src/engine/state.ts` | UI board-read freeze after Engage — STRETCHED by Speed edge (~+150ms/pt, cap +2.5s; §5.7 Speed rider) |

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

**Status:** the FOE-MODEL rows shipped in the data rebase; the COMBAT-AMENDMENTS batch (dodge,
guard-carry, Maneuver live-burn, start-grace rider) shipped next; **LEVELS & XP SHIPPED
(2026-06-13)** (`save.ts` + the level-up modal); and **LOOT TABLES SHIPPED (2026-06-13)** — ✅
gold (the shared vault `bank.ts` + run-purse), category-first rolls, guaranteed elite/boss wages,
depth scaling, the death tithe are LIVE (`loot.ts`). The **progression package is now fully built**
except the items it depends on: **GEAR (B3)** and **spellbooks (B4)** — their loot categories are
scaffolded-off until those systems exist. (The PARTING-BLOW Speed rider waits on the flee parting
blow, a deferred B2 item; `GOLD_K` recalibrates once the shop sink lands.)

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
| ✅ Level cap (LIVE) | **21** (numeric to 20, then ★) | `LEVEL_CAP` in `save.ts`; the cap badge |
| ✅ HP / level (LIVE) | **+5** (`HP_PER_LEVEL`) | 100 → 200 at cap (`maxHpForLevel`); gear/passives ~+100 → ~300 ceiling |
| ✅ Stat points / level (LIVE) | **+3/+2/+1, player-allocated** (level-up modal) | +6/level, +120 arc; effective stats = BASE + alloc (`effectiveStats`) |
| ✅ Re-denomination (LIVE) | `RATE_K` **0.2** (was 0.8) · `MOVE_RATE_K` **0.025** (was 0.1) · tempo bands **UNCHANGED** · clamps keep [2,20] / [0.2,3] | +1 main-stat level = +7.5% lane at parity · focused-vs-balanced (±20) = +48% · full kit (+12/stat) = +30% · clamp binds at ±60 diff |
| ✅ Parity line (LIVE) | foe parity stat = **10 + 2·(intended level − 1)** → L3=14 · L12=32 · L20=48 | endgame foes 40–80 ✓; the data rebase authors against this line |
| ✅ Role spreads (LIVE) | swift −2P/+5S · steady 0 · heavy +2P/−5S · giant +4P/−9S, **level-invariant** · elite/boss E bump **+4/+8** | spreads land each tempo band; never widen with level (that's why the bands survive) |
| ✅ Telegraph law (LIVE) | foe budget = `rate(P_f, E_p) × 3.1 × tierOut` (parity → 25×tier at every level) | replaces raw `P × DMG_BUDGET_K` (which breaks A4 over the arc) |
| ✅ Foe HP (LIVE) | minion **60** · elite **110** · boss **200** — level-invariant, derived from A6 | the live rebased warren minions already sit on this line |
| Trap severity *(sim)* | author ∝ intended-level HP: ≈ **6% · tierOut of expected maxHP** per hit | flat numbers let bulk eat the threat layer (boss row drifted 37→90% before this) |
| ✅ XP law (LIVE) | `(hp/10 + P + E + S) × (1 + 0.15·traps) × tierMult` | `foe.ts computeXP`; computed — except a teaching-foe `xp` override (dummy/gauntlet, for the onboarding curve) |
| ✅ XP tier mult (LIVE) | **×1 / ×2 / ×4** | deliberately above the stat ladder (×1/×1.5/×2) — risk beats grinding |
| ✅ XP curve (LIVE; base STEEPENED 2026-06-14, sim §8) | **polynomial: need(L→L+1) = 110 × L^1.7** (`xpForLevel`) — base 55→80→**110** to hit **~50–60 level-matched dungeon clears to ★** (110→~56; base rises because foe XP rises w/ dungeon level). need(1→2)=110 · (2→3)=355 · (3→4)=710 | anchored dummy→L2 · gauntlet→L3 (teaching `xp` overrides: dummy 110, gauntlet 95/170/90=355) · first clear still ≈ 1 level · XP always banks |
| Dungeon difficulty 1–5 *(PLANNED, sim §8)* | **dungeon LEVEL = 3 + 4(D−1)** → D1 L3 · D2 L7 · D3 L11 · D4 L15 · **D5 L19 ("18+")**, ±2 ramp | the parity-authoring level of a dungeon's foes; you climb D1→D5 as you level. `schema.ts` already has `difficulty` |
| Foe level-equivalent *(PLANNED, sim §8)* | **`L_foe ≈ 1 + (avgStat − 10)/2`** (self-rated, inverts parity) | no authoring — strength IS level; elites/bosses read ~1 higher via the E-bump (within the grace band) |
| Outlevel XP penalty *(PLANNED, sim §8)* | **`clamp(1 − 0.15·max(0, L_player − L_foe − 2), 0.1, 1)`** | full XP within 2 levels; one tier down (gap~4) ×0.70; two tiers (gap~8) floors ×0.1. Makes "level-matched clears" real (anti-backtrack-farm). Above-level ×1.0 (bonus = a lever). Engine wiring: `computeXP(foe, playerLevel?)` |
| Gear stat share | **~25%** of endgame stats (~+30–40 pts/kit, ≈+5–7/slot) | gear's identity = per-card riders + slot mechanics (§7), not stats |
| ✅ Drop count (LIVE) | minion **1** · elite **2–3** · boss **5** | `loot.ts` TABLES; plus a guaranteed gold WAGE ×2 / ×4 (elite/boss) |
| ✅ Category weights (LIVE) | minion **60/30/10** · elite **45/35/20** · boss **30/40/30** (gold/cons/gear) | elites+bosses roll consumable quality with ADVANTAGE; **gear/spellbook DISABLED (B3/B4)** → their weight redistributes to the live categories (`ENABLED`) |
| ✅ Consumable sub-table (LIVE) | ~60% tiered potion (tier by depth, advantage keeps the better roll) · ~20% special potion · ~20% scroll | `loot.ts rollConsumable`; spellbooks (the 5% slice) wait on B4 |
| ✅ Gold scale (LIVE) | `gold = foeValue × GOLD_K 0.12 × depth × ±30%` (minion drop ~4–8g) · **full warren clear ≈ 210g** (depth-inflated) | `loot.ts`; foeValue shared with XP (`foe.ts`). Moderate player banks hundreds; ⚠ runs ~40% over the 100–150 first-cut — recalibrate `GOLD_K` once the shop sink exists |
| ✅ Depth scaling (LIVE) | **+7%/room** (`DEPTH_RATE`) gold + consumable tier | greed aligns with dread; kills shallow cash-out farming |
| Gear pity | gear weight ticks up per gear-less drop, resets on hit | ⏳ lands WITH gear (B3) — inert while gear is disabled |
| ✅ Death tithe (LIVE) | **12%** of banked gold (`bank.ts DEATH_TITHE`) | a run-ending death also loses the run's carried gold |
| ✅ Dodge (LIVE) | base **10%** · `DODGE_K` **0.015**/pt of S edge · clamp **[3%, 40%]** · per **swing** · rolled AT THE DEAL, folded into the ⚔ | strikes only; at K 0.015 dodge alone ≈ half a P/E point (ΔS 10.3 vs ΔE 20.3 winrate pts on the boss bench) — the charge agency the model can't price carries the rest; playtest re-read flagged |
| ✅ Guard carry (LIVE) | Block persists through windups, **capped at the revealed telegraph** | strikeEvery>1 foes reveal ⚔ at windup start; guard drops only after a strike resolves |
| ✅ Maneuver live-burn (LIVE) | **~1 charge/sec**, gather **~1.5–2s** to enter, bail-out to SG instant (keeps remainder) | replaces the rollover dump; burn rate = the scan-stability dial |
| Speed riders | ✅ start grace ↑ with Speed edge (LIVE) · ⏳ parting blow ↓ with Speed edge (waits on the flee parting blow) | the escape stat |
| Crits | **deferred** to gear/abilities (deterministic hooks only) | set output stays exact |
| Loadout caps *(settled 2026-06-13)* | **6 active + 3 passive** (the **signature passive counts** → 2 free passive slots) | build-tension vs a ~10-deep list; each class has ~5 passives, begins with 1 fixed signature; a class = `{X abilities, Y passives, Z gear}` (counts class-defined) |
| Ability gating *(settled 2026-06-13)* | **mana `cost` and/or `cooldown` (rounds)** | cooldowns join mana as a 2nd gating dimension — a variety + balance lever; either/both/neither per ability |
| Slot-unlock cadence *(SETTLED 2026-06-14)* | **active slots L3·L6·L10·L14** (2-start → 6 by L14) · **passive L8·L16** (signature+2 → 3 by L16) | level-up unlocks a slot + grants a pick (**supersedes the boss-gated pick**); surplus grants (kit-heavy or **prestige** packages) → a REPLACE from the (prestige) set |
| Per-level BUNDLE + cadence *(SETTLED 2026-06-14; full table CRAWL §3)* | **auto each level:** +5 HP · +6 stats (≤3/stat) · +mana cap (15→~35). **scheduled (fixed):** satchel +1 ×5 → **15** (L2/4/9/12/17) · consumable loadout +1 ×2 → **5** (L5/13). **picked:** exploration approach-up ×10 → all 5 maxed by ★ (L3/7/10/11/13/15/18-21) | capacity is FIXED (no real choice), approaches are the PICK (order = identity); all OFF the combat-power curve. **Excluded:** charge cap (stays 15 — board invariant) · Storage (gold-bought `N²`) |
| Creation facets *(settled 2026-06-14)* | **Class × Background**, both achievement-gated | start = **Adventurer** only (generic/balanced); tutorial unlocks a few classes; prestige = the deep end of the same gate. **Background** = 1 permanent NEUTRAL passive in a **dedicated 4th slot** (powerful vs normal, broadly useful, never changed) — racial/signature-item/size/career flavor; Background × Class is the long-tail unlock space |
| Spellbook prices *(settled 2026-06-13)* | active **1000g** · passive **2500g** | pricey — enables twinking *to a limited degree*; keeps the class-hall shop a **pity backstop** to the drop lottery, not a shortcut. Spellbooks **REPLACE** (never raise the 6/3 cap — any ceiling bump is *earned, not bought*) |
| Storage-slot upgrade *(settled 2026-06-13)* | **`cost(N) = N²`**, 10-slot steps off base 20: 30=900g · 40=1600g · 50=2500g · … · 100=10,000g (~38k all-in) | the steady always-useful gold sink; square = cheap early, a real long-game dump at the top |
| Character-slot cost *(settled 2026-06-14, sim §9)* | slot 1 free; **N≤10: ~40·N²** (cum to 10 ≈ **15k**) · **N>10: 4000+120·(N−10)²** (slot 20 = **16k**, cum 11–20 ≈ **86k**, all-20 ≈ **102k**) | shared account; **PEGGED to lifetime gold ~23k/char (1→★)** — invariant: cost(#20) ≤ one char's lifetime gold (×1.4 margin) so you can never get slot-locked. Rescale with `GOLD_K` if it recalibrates |
| Sell-back rate *(settled 2026-06-13)* | **~20% of value** (a town amenity raises it later) | low by default so flipping shop stock is never arbitrage |
| Class-hall level metric *(OPEN)* | highest level of any owned char of that class | top tiers stock that class's spellbooks; a maxed (★) char opens the full catalog to the whole roster |
| Dungeon-clear marquee roll *(settled 2026-06-13)* | 1 guaranteed high-quality roll: **spellbook** (if consumable) / **rare+** (if gear) | the boss's growth feel now that ability picks moved to the level cadence; the **lottery-primary** spellbook faucet |

## Delve encounter schema (LIVE, first cut — CRAWL §2)

| Constant | Value | File | Meaning |
|---|---|---|---|
| boss law | `cum(n) = n(n+1)/2 %`, inverse-CDF (one `R ∈ [0,100)` at delve start) | `src/engine/delve.ts` (`bossCumulative`) | Boss at first room where `cum(n) > R` — median 10, guaranteed 14; rooms count encounters ENTERED (cleared or fled); throne room stays found |
| `ELITE_STEP` | 0.10 | `src/engine/delve.ts` | Elite sawtooth: chance = step × rooms since last elite; resets on an elite AND on a flee |
| `RUN_BAG_CAP` | 10 | `src/engine/delve.ts` | The run consumable satchel (the 10-slot run inventory's seed) |
| dread bands | 15 / 45 / 80 (% cum, next room) | `src/engine/delve.ts` (`dreadBand`) | quiet → drums → throne stirs → he is near → throne room found |
| room loot | 1 random consumable (¾ potion / ¼ scroll) | `src/engine/delve.ts` (`rollDelveLoot`) | ⚠ PLACEHOLDER — real loot tables (gold/XP/gear by loot_tier) replace it |

## Dread escalation — PLANNED (settled 2026-06-13; the structural anti-stall; CRAWL §5.8)

The unified `dread` meter (1–10) drives two lanes: **drift = soft tension** (can't touch HP),
**a two-way damage multiplier = the hard anti-stall**. **SIM-VALIDATED 2026-06-13**
(`sim/progression-sim.mjs` §7): the damage band sits past the A6 kill budgets (onset round 12
shallow vs budgets 2.5/5/10), ON ≈ OFF for normal fights (inert backstop), and the ramp breaks
realistic sustain (10%/rnd heal: 69% stall → 1%). **Key finding: the foe ramp must ride the
UNGUARDABLE lane** (trap/tick), not the telegraph — sated guard neutralizes a pure strike multiplier.

| Constant | Value (first cut) | Meaning |
|---|---|---|
| `DREAD_SCALE` | **1 – 10** | the meter; extends the existing dread bands (§2) into a numeric driver |
| Depth floor `D₀` | bands → **1 / 2.5 / 4 / 5**, **cap 5** | from the cumulative boss-total; set per room, resets at Town. Capped at 5 so depth never reaches the damage band alone |
| `DREAD_RISE` | **~0.5 / round** | within-fight climb: `dread = clamp(D₀ + RISE×round, 1, 10)`; resets to `D₀` at fight end |
| `DREAD_KNEE` | **5** | below = near-flat gentle drift; above = drift steepens toward the ceiling |
| Drift ceiling | **≤ ~0.3–0.4 c/s** (TRAPS §6) | even max dread respects the net-transmute budget → the makeable-FLOOR holds; drift quantized to the **rollover** (no continuous clock) |
| `DMG_ONSET` | **dread 7** | the two-way damage multiplier is OFF below this; ramps linearly to max at dread 10 |
| `DREAD_DMG_FOE_MAX` | **×2.0** at dread 10 | foe damage scale at max |
| `DREAD_DMG_PLAYER_MAX` | **×1.5** at dread 10 | player damage **+ healing** scale at max — sustain scales 1.5 vs incoming 2.0 → equilibrium breaks to the house |
| `DREAD_BLEED_MAX` *(generic, split out 2026-06-13)* | **6%·maxHP/round** at dread 10 (0 below onset) | a foe-INDEPENDENT unguardable drain so the anti-stall doesn't depend on the foe's trap kit; authored traps/ticks ride on top. This is the clean primitive (a universal dread bleed, not a per-foe DoT) |
| Multiplier scope | foe ×: **all foe DAMAGE incl. unguardable trap/tick + the bleed** · player ×: **damage + heals**; NEITHER touches **drift** (the transmute, no HP) | the unguardable lane is what bites (sated guard caps a pure telegraph ×); folds in AT REVEAL so the ⚔ stays honest; dodge/guard/SG still apply to the bigger numbers |
| Goal / cap behavior *(reframed 2026-06-13)* | **capped at dread 10**; goal = ACCELERATE to a resolution + the dread swing-moment, NOT force-kill the turtle | sim §7: breaks realistic sustain ≤~20%/rnd, normal fights inert (ON≈OFF). An indefinite-heal build wins nothing → needs no force-kill; absurd out-healing is a sustain-NUMBER cap, fix at source |

## Between-rooms approaches — PLANNED (settled 2026-06-13; CRAWL §2)

Pick ONE at the fork, free, resets per room. Universal (all start usable); leveled via the per-level
horizontal pick, **cap 3**. Buys map to the five run currencies (info/tempo/loot/HP/mana).

| Approach | Buys | L1 / L2 / L3 |
|---|---|---|
| **Scout** | information | **tier** / +foe / +traps (Scout 1 is a FREE baseline for everyone; depth scales) |
| **Lurk** | tempo | **+3 / +6 / +9s on round 1** (initiative vs the fixed foe telegraph; stacks with Speed) |
| **Scavenge** | reward | next loot roll **+2 / +4 / +6 effective-depth** (reuses `DEPTH_RATE` ≈ +14/28/42%) |
| **Recover** | HP | **+5% / +10% / +15% maxHP** — hard-capped low (a choice vs the attrition spine, not sustain) |
| **Prepare** | mana | start round 1 with **~20% / 35% / 50% of mana cap** (rest rebuilds in-fight, §6) |
| **Investigate** *(DEFERRED)* | encounter type | bias the next room toward EVENTS — lands with the non-combat room system; Scout then reads room type too |

| Constant | Value | Meaning |
|---|---|---|
| Round-1 length | **`clamp(20 + (playerS − foeS), 15, 25)`s**; every other round flat **20s** | Speed = initiative; per-round scaling REJECTED (universal multiplier triple-dipping dodge+charges, breaks the 20s constant + kill budgets, re-couples scan speed). Lurk stacks. **Supersedes the §5.7 start-grace rider** |
| Board preview | **voluntary-activation**: untimed; the **first set you complete starts the round** | baseline every fight (not just Lurk); supersedes the fixed 3s start-grace; kills opening-scan pressure |

## Gear + the coupled balance pass — PLANNED (DERIVED 2026-06-15, sim §11; full design CRAWL §7)

| Constant | Value (first-cut, sim-backed) | Meaning |
|---|---|---|
| Gear rider (weapon base) | **+0/+1/+2/+3/+4/+5 dmg per Attack card** (grey→orange) | the gear-power channel: 0→38% of attack power (orange ≈ ⅓); armor mirrors (+Block/Defend card) |
| Gear share | **~⅓ of effective combat power** at rarity-current | up from the old ¼; safe because foes are tuned against it (the expected baseline) |
| ⭐ Foe-difficulty raise | **foe HP + telegraph × `(25 + 3·expectedRider(L))/25`** (×1.0 grey → ~×1.6 orange) | THE "combat too easy" fix — accounts for gear so the geared baseline hits the kill budget; expectedRider ≈ 1 tier / 3.4 levels. Fold into authored foe HP/telegraph at B3 |
| Ability effect values | **damage ≈ heal ≈ 1.0 · block ~0.2 · charge ~0** (context-dependent) | empirical marginal win-rate; price abilities off throughput (damage:heal ≈1; block/charge cheaper) |
| Ability VPM | **≈ 4 dmg/mana** | 15-mana burst ≈ 60 dmg ≈ 2.4 sets; ability cost = effect-value ÷ VPM. Abilities = CONTESTED + throughput-neutral redirect |
| ⚠ Tactics under-value | marginal charges ≈ 0 win-value | the Speed-under-buys issue, now empirical — needs richer charge sinks / Maneuver payoff / Speed gear hooks |

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
