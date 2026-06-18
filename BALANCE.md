# BALANCE.md — the combat economy, the unified verb model, targets & sim plan

*Written 2026-06-17. Companion to `TUNING.md` (live constants), `CRAWL-DESIGN.md`
§5–§5.7 (current combat spec), and `sim/progression-sim.mjs` (the existing
workshop). This file is the **plan**: a single currency (expected damage per
round), the unified verb↔stat↔defense model that aligns A/D/M with P/E/S, the
difficulty targets we tune against, prescribed values, and the multi-axis sim
that proves it.*

> **Status.** Combat numbers are deliberately "vibes" until this pass (`CLAUDE.md`).
> The anchors in §1.1 are *settled and in code*. The **unified model** (§2) and
> the **prescribed values** (§5) are a proposed redesign — specced here, to be
> proven in the §6 sim **before** any engine change or any edit to the live
> combat spec in `CRAWL-DESIGN.md` §5.6. The generation-invariant sweep is
> unrelated and unaffected.

---

## 0. Executive summary

The engine is sound; the **content numbers were authored in three eras and never
reconciled to one economy**, and the **defensive model lets a skilled player
ignore defense entirely**. Concretely:

1. **Damage abilities are under-costed ~2–3×.** Firebolt and Cleave both literally
   `dealRolled(s, 45)` for 4 mana (`abilities.ts:54,153`) — mean ~30, max 45,
   i.e. **7.5–11 dmg/mana** vs an intended **~4** (sim §11 VPM).
2. **Enemies die in ~1 round to skilled play.** Kill budgets (A6) were anchored to
   the *lowest* skill tier (one attack set/round ≈ 25). A typical player does 2–3×
   that; excellent 4–6×. The "attack rush" is the symptom.
3. **Defense is free for the skilled and worthless for the verbs that supply it.**
   Endurance *passively* shrinks the foe telegraph even if you never Defend; Block
   *carries across rounds* so many small blocks nullify a haymaker. Result: you
   rarely *need* Defend, and **Move is purely circular** (Move → charges →
   Maneuver → churns the board toward Attack — "yo dawg, I put Move in your Move").
   Speed's only real payoff (dodge) isn't even fed by Move sets and **isn't shown
   in the UI at all**.
4. **The "too easy" fix (`gearFactor`) is inert for the whole early game** (×1.0 at
   ≤ L6, `foe.ts:48`).
5. **Gear can't overtake innate** — `LOOTTIER_K = 0.02` (`affixes.ts:86`) freezes
   affix magnitude across item levels, and innate allocation grants +120 stat over
   the arc vs ~+8 native gear stat.

The fix is **one currency** (EDR, §1) and **one structural model** (§2): each
verb pairs with one stat to produce one of {deal / block / avoid}. Then reprice
abilities to the currency (§5.1), re-anchor enemy HP/threat to *typical* play
(§5.2), make gear scale with item level (§5.4), and verify with a multi-axis
skill sim (§6).

---

## 1. The unit: Expected Damage per Round (EDR)

**One round = 20 s** (`ROUND_MS`, `state.ts:134`). Everything is priced in **EDR —
HP dealt (or prevented) per 20-second round, at stat parity, for a reference
player.** Damage prevented = damage dealt (the net HP swing is the same currency),
so mana, Speed, round-time, Block, and raw damage all live on one axis.

### 1.1 The settled anchor (in code — do not move)

- **Contest law** (`resolve.ts:31–37`):
  `contestRate(yours, theirs) = clamp(8 + 0.2·(yours − theirs), 2, 20)`
  (`RATE_BASE 8`, `RATE_K 0.2`, clamp `[2, 20]`).
- **Quality tiers** `[0.7, 1.0, 1.4]` (`resolve.ts:19`); a magnitude-6 set (one of
  each tier) has quality-sum **3.1**.
- **At parity (10 v 10):** one Attack card = `8 × q`; a mag-6 Attack set =
  `8 × 3.1 ≈ 25 HP`. **This 25 is the even-exchange quantum** (A4) — the reference
  for everything below.

### 1.2 Skill as sets/round (the master EDR multiplier)

| Tier | Sets/round | Role |
|---|---|---|
| **Floor** (low) | **3** | one set per verb (A2 "6/6/6") |
| **Typical** | **5–8** (use 6.5) | **the player we tune the curve for** |
| **Good** | **8–10** (use 9) | |
| **Excellent** | **10–15** (use 12.5) | ceiling of human play |

Sets shrink as wounds eat the board: `liveScale = ((15−wounds)/15)^1.5`
(sim `fight()`) — already modelled.

### 1.3 Offensive EDR by skill (parity, attack-focused mix)

Attack sets ≈ `setsPerRound × 0.40` (rush ≈ ×0.8); each attack set ≈ 25.

| Skill | Sets/rd | Attack sets/rd (40%) | **Attack EDR** | Rush EDR (80%) |
|---|---|---|---|---|
| Floor | 3 | 1.2 | **~30** | ~60 |
| Typical | 6.5 | 2.6 | **~65** | ~130 |
| Good | 9 | 3.6 | **~90** | ~180 |
| Excellent | 12.5 | 5.0 | **~125** | ~250 |

Enemy HP (60/110/200) was set against the Floor "1 attack set" column — which is
why every tier above Floor melts the content.

---

## 2. The unified model — one verb, one stat, one defense

The organizing principle of the whole rebalance. **Each verb pairs with one stat
to produce one of {deal, block, avoid}.** This aligns the A/D/M and P/E/S triads
*by construction*, not by number-fiddling.

| Verb | Stat | Produces | Character | Strong vs |
|---|---|---|---|---|
| **Attack** | Power | damage dealt (banked → rollover) | — | everything |
| **Defend** | Endurance | **Block** — deterministic, *partial*, **this round only** | reliable, in-the-moment | frequent moderate hits |
| **Move** | Speed | **Dodge** — probabilistic, *full negation*, **banked** | planned, all-or-nothing | rare huge hits |

And because the player plays the minigame while the **foe is an automaton**, the
two stat blocks are deliberately asymmetric — and that's correct, not a wart:

- **Player stats scale agency** (they multiply what your *sets* produce).
- **Foe stats are flat traits:** foe Power → telegraph size; foe Endurance →
  reduces your Attack (`contestRate(P, foeE)`); foe Speed → tempo (swings/round)
  + your dodge floor.

> **Axiom (new):** *the side that finds sets gets multipliers; the side that
> doesn't gets flat traits.* This is why removing player-E's passive mitigation
> (§2.2) while keeping foe-E's passive mitigation is consistent, not lopsided.

### 2.1 Defend — deterministic, partial, **no cross-round carry**

Block is produced **only** by Defend sets (× Endurance) plus gear riders/abilities.
**Removing guard-carry:** you may bank Block only within the round the hit lands.
Against a fast every-round foe (strikeEvery 1) you Defend each round as now;
against a slow haymaker (strikeEvery 2–3) you get **one** round of Block — capped
at ~one Defend-set's worth — so a 100+ haymaker *cannot* be blocked away. That's
the hole Dodge fills.

> Removing carry reverses the sim §4 "guard-carry" fix. It's the right reversal
> *now* (enemies are too weak and Block was too forgiving), but it must be
> re-simmed, not blind-flipped.

### 2.2 Endurance is purely set-based (telegraph decoupled from player E)

Today Endurance does two jobs: (a) scales Block per Defend card, and (b)
*passively* shrinks the foe telegraph even if you never Defend. **Cut (b).** The
foe telegraph becomes a function of the **foe's own Power × tier** against a fixed
reference — your only mitigation is **Block (Defend × E)** and **Dodge (Move × S)**.

`telegraphBudget = contestRate(foeP, REF=10) × 3.1 × tierMult`,
`tierMult = {minion 1, elite 1.5, boss 2}`.

So **zero Defend → full damage**; Endurance is the *slope* that decides how few
Defend sets it takes to reach zero (§4, Report A). This is what makes the attack
rush a real gamble: rush in, eat the whole telegraph.

### 2.3 Move — banks Dodge directly, capped by foe cadence

**Decision: a Move set feeds the dodge pool directly** (not via a Tactics spend).
A Move set increments **both** the Tactics charge bank (Stand Ground warding /
Maneuver, unchanged) **and** a new **banked dodge pool**; Speed scales the dodge
increment and sets a base floor (the existing `dodgeChance` differential). Two
payoffs for the weakest verb is corrective, not excessive. *(Charge income may be
trimmed to compensate — sim to tune.)*

The pool **persists across rounds**, is rolled at each incoming swing, and
**resets to the Speed floor on a successful dodge** ("build up until the next time
you dodge"). Its ceiling is set by the **foe's cadence** (the tempo law,
`foe.ts:19`) — rarer-but-bigger hits let you invest all the way to certainty;
frequent chip can't be fully dodged, so Block has to carry it:

| Foe tempo (S−P) | Cadence | Dodge cap |
|---|---|---|
| ≤ −8 (giant) | 1 hit / 3 rounds | **100%** |
| −7..−5 (heavy) | 1 hit / 2 rounds | **90%** |
| −4..−2 (clean) | 1 hit / round | **80%** |
| −1..+3 (steady) | 2 hits / round | **70%** |
| ≥ +4 (swift) | 3 hits / round | **60%** |

**The complementarity is the point:** Block is *strong vs chip / weak vs
haymakers* (no carry, one round to block); the Dodge cap is the **exact inverse**
(100% vs the 3-round haymaker, 60% vs the 3-swing swarm). The two defenses tile
the entire tempo spectrum with no overlap and no gap. A boss can even be built as
a pure dodge-check ("one-shots you unless you keep the pool up") — we deliberately
do **not** cap boss dodge lower; the gimmick is allowed.

**Dodge scope** (already correct in code, preserve it): dodge rolls on **strikes
only** — it does **not** avoid traps or dread bleed (those are the unblockable,
play-around pressure), but it **does** avoid the flee parting blow (`combat.ts:497`).

### 2.4 No unblockable telegraph fraction

Considered and **rejected**: it conflicts with the core promise that **Defend is
the safe answer if you can play it hard enough**. §2.2 (full damage by default
unless you Defend/Dodge) already supplies all the pressure we need; layering
unblockable damage on top would punish the very build that's supposed to be the
reliable one, and would threaten the doom cap (§3.1).

---

## 3. The master stat economy (per-point EDR at parity)

Marginal EDR per +1 of the lever, at parity, for the **Typical** reference (6.5
sets/round). Under the unified model all three primary stats are play-realized
(no passive freebies), which is what finally lets them be *equal*.

| Lever | Mechanism | EDR per +1 (Typical) | Skill-scaling |
|---|---|---|---|
| **Power** | `+0.62 / attack-set` | **~+1.6** (offense) | ∝ attack sets/rd |
| **Endurance** | `+0.62 block / defend-set` | **~+1.4** (blocked) | ∝ defend sets/rd |
| **Speed** | bigger dodge increment / Move-set + base floor | **~+1.2–1.6** (prevented) | ∝ Move sets/rd |
| **Mana** | converts at VPM | **~4 EDR/mana** (target) | ∝ ability use |
| **Round time** | `+1 s = +1/20 of your EDR` | **~+3 EDR/sec** (Typical) | **∝ your total EDR** |
| **Block (raw)** | direct, capped, no carry | **~0.3–0.5 EDR/pt** | realization-limited |
| **Heal** | direct + knits wounds | **~1.0–1.3 EDR/HP** | flexible timing |

Three reads:

- **P/E/S now align by design.** Each is a multiplier on one verb's output, with
  no passive component to over- or under-weight one. The remaining gap is
  *content*: E (block) pays vs frequent hits, S (dodge) pays vs haymakers — so
  they're only *equally* valuable if a dungeon's roster exercises **both**
  defensive modes. **P/E/S balance is partly an encounter-variety problem**, not
  just a constant — every dungeon should field a mix of chip and haymaker foes.
- **Round-time is the sleeper.** `+5 s` (e.g. Frostbolt) ≈ **+15 EDR** for a
  Typical player, **+30** for an Excellent one — *more than its nominal damage*.
  Symmetrically, an enemy **−4 s** timer-advance costs a skilled player ~12–30 EDR
  — the one enemy tool whose bite *grows* with player skill. We under-use it; lean
  in (§5.3).
- **Block raw is cheap per point** (no carry lowers realization further), so Block
  *abilities* can hand out a lot of it without breaking VPM (§5.1).

---

## 4. The comparison reports (reference tables)

Illustrative under the proposed model; the §6 sim produces the skill-tiered
finals. These belong in the modder wiki once locked.

### Report A — Defend sets/round → damage taken (scaled by Endurance)

Block/Defend-set = `contestRate(yourE, foeP) × 3.1`, vs a **boss** telegraph ≈ 64
(foe P22, ×2 tier). Damage taken = `max(0, 64 − sets × blockPerSet)`:

| Defend sets/rd → | 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| **Low E (10)** — ~17/set | 64 | 47 | 29 | 12 | 0 |
| **Mid E (30)** — ~30/set | 64 | 34 | 4 | 0 | 0 |
| **High E (50)** — ~42/set | 64 | 22 | 0 | 0 | 0 |

Exactly the spec: **0 Defend = full damage; Endurance is the slope** to zero.
Low-E needs ~4 sets to fully soak a boss; high-E ~1.5. (Skill sets the *budget* of
sets you can split across verbs — a Floor player can't afford 4 Defend sets *and*
kill anything; an Excellent player can.)

### Report B — Speed differential → dodge & foe tempo

Base dodge floor (per swing): `clamp(0.10 + 0.015·ΔS, 0.03, 0.40)`

| ΔS (you − foe) | −20 | −10 | 0 | +10 | +20 |
|---|---|---|---|---|---|
| dodge floor | 3% | 3% | 10% | 25% | 40% |

Foe tempo (foe S−P → packaging), per-swing dmg = `budget × strikeEvery / swings`:

| Foe S−P | strikeEvery | swings | per-swing (of 50 budget) | dodge cap (§2.3) |
|---|---|---|---|---|
| ≥ +4 | 1 | 3 | ~17 (swarm) | 60% |
| −1..+3 | 1 | 2 | 25 | 70% |
| −4..−2 | 1 | 1 | 50 (clean) | 80% |
| −7..−5 | 2 | 1 | 100 (windup) | 90% |
| ≤ −8 | 3 | 1 | 150 (haymaker) | 100% |

The bottom two rows (100–150 haymakers) are precisely what Block-without-carry
can't cover — the rows where banked Dodge must be the answer, and exactly where
its cap is highest. The model and the tempo law were built for each other.

> **Note on "attacks per round":** the *player* banks **one** exchange/round; your
> attack count = **sets found = skill**, not Speed. "Attacks per round + damage per
> swing" is a **foe** property (the table above). Letting Speed grant the *player*
> extra swings would break the one-exchange-per-round model — rejected; Speed owns
> avoidance instead.

### Report C — what each Set match gets you (the three axes)

| Axis | Controls | Detail |
|---|---|---|
| **Shape (verb)** | the **lane** | Attack→damage(`roundAttack`) · Defend→Block · Move→charges **+ Dodge** |
| **Magnitude** | **how much** | each card's quality `[0.7, 1.0, 1.4]` multiplies its lane output; set total = sum. Primed (+1 tier) and the crit score (combo/chain) ride on top. |
| **Color** | the **resource** | mono → **3 mana** of that color; rainbow → **1/1/1**. Plus color-keyed class passives (Flameshield all-red +9 Block, Photosynthesis all-green +9 HP…) and gear color-riders. |

**Shape = which lane · magnitude = how much · color = what resource** — three
independent axes on every card. The full skill-scaled numeric version (per-skill
sets/round × per-axis output) is a §6 sim deliverable.

---

## 5. Prescribed values (first cut — finalise in §6 sim)

### 5.1 Reprice damage abilities to VPM ≈ 4

Mean delivered = `⅔ × max` (triangular `weightedRoll`) → target **`max = 6 ×
mana`**. Discount hybrids by the EDR of their rider (round-time ≈ 3 EDR/s, etc.).

| Ability | Mana | Current max (mean) | **New max (mean)** | Rationale |
|---|---|---|---|---|
| Firebolt | 4 | 45 (30) | **24 (16)** | pure nuke → VPM 4 |
| Cleave | 4 | 45 (30) | **24 (16)** | pure nuke → VPM 4 |
| Venom Strike | 4 | 36 (24) | **24 (16)** | pure nuke → VPM 4 |
| Thorn Vines | 4 | 30 (20) | **15 (10)** | nuke + 5 s → time discount |
| Cold Blade | 3 | 30 (20) | **9 (6)** | nuke + 4 s → heavy discount |
| Frostbolt | 5 | 24 (16) | **9 (6)** | nuke + 5 s + transmute → mostly utility |
| Fireball | 7 | scales | **cap mean ~28** | AoE; cap per-cast EDR |
| Rampage | 6 | scales | **cap mean ~24** | board-dependent; cap |
| Quick Strike | 3 | scales | **cap mean ~12** | |
| Heal | 5 | 45 (30) | **~22 heal** | heal ≈ 1.1 EDR; 5·4/1.1 ≈ 18–22 |
| Riposte | 4 | 24 (16) + 18 blk | **12 (8) + 18 blk** | hybrid discount |
| Time Warp | 6 | 18 (12) + round-cap | **~9 (6) + round-cap** | round-cap is the value |

Non-damage abilities (Block/Bulwark/Call-*/Berserk/Rally) are repriced by EDR
effect, not damage — deferred to the sim (their value is play-dependent). **Block
abilities can stay generous** (Block raw ≈ 0.3–0.5 EDR/pt, §3).

> **Ship-now candidate:** Firebolt/Cleave/Venom → max 24 is the single
> highest-feel change and directly answers the "45-for-4 is overpowered" report.

### 5.2 Re-anchor enemy HP to *Typical* play

**Decision: HP 100 / 250 / 400** (minion / elite / boss) — your call, ~1.6× /
~2.1× / ~2.0× over current, a healthily wide tier spread. Kill-times at parity
(Typical ~65 attack EDR/rd, *before* the rush is de-valued by opportunity cost):

| Foe | HP | Typical kill | Excellent kill |
|---|---|---|---|
| Minion | 100 | ~1.5 rd | ~1 rd |
| Elite | 250 | ~4 rd | ~2 rd |
| Boss | 400 | ~6 rd | ~3–4 rd |

Once players split sets into D/M (instead of all-Attack) these stretch further —
the rush gets punished by the defense it forgoes. **Reward coupling** to settle:
`foeValue = hp/10 + P + E + S` feeds XP/gold (`foe.ts:33`), so the HP raise lifts
rewards ~+13% — *recommend decoupling* (price XP/gold off `P+E+S` only) so rewards
track threat, not the HP sponge.

### 5.3 Threat that survives competent play (no unblockable — §2.4)

The HP raise + the §2.2 "full damage unless you Defend/Dodge" already create
pressure. Add only:

1. **Make damage traps bite** — minion/elite traps are mostly lock/drain/timer or
   opt-in; raise the damage ones (war_cry_lesser ~17 → ~25) and let reflect-style
   traps scale with the player's *attack* output (punish the rush specifically).
2. **Lean on timer-advance** (cowardly −4 s etc.) on more elites — it scales with
   player skill (§3) and is the cleanest anti-rush tool. Traps & dread stay
   **undodgeable** (§2.3) so they're the reliable pressure floor.

**Doom cap (hard constraint):** worst-case unblocked/undodged round (full
telegraph × dread × a trap) ≤ **40% of max HP** at each tier. The banked dodge
pool is the formal "bad-round insurance" — investing Move carries protection into
a round where your Attacks whiff. The sim enforces the cap.

### 5.4 Make gear scale with item level (overtake innate late)

Root cause: `affixMagUnit = perAffixPower × (1 + lootTier × 0.02)` (`affixes.ts:109`)
— only +2%/loot-tier, integer mags floored at 1, so a L19 orange ≈ a L3 orange.

- Raise `LOOTTIER_K` `0.02 → ~0.08–0.12` and lift the integer floor so high-item-
  level affixes round to 2–4, not 1.
- **Separate the axes:** rarity = *texture* (how many affixes, which proc
  families); item level = *magnitude* (raw power). Rarity = build variety, item
  level = strength.
- Keep `gearFactor` but **extend it below L6** (or a small early-foe HP raise) so
  the D1 warren isn't unscaled.

**Target power share** (the requested curve): innate **~80%** early (L1–6) →
**~50%** mid (crossover ~L11) → gear **~65%** late (L14–21). Exact `LOOTTIER_K`
and floor are sim outputs; the constraint is this curve.

### 5.5 Dodge UI (build it — currently absent)

Dodge appears only *reactively* in the exchange cutscene (`app.ts:2262`) and the
round-1 preview; there is **no persistent dodge indicator**. With dodge becoming a
built-up, capped, strategic resource, a **dodge meter is mandatory**: show the
current pool %, its cadence cap (the §2.3 ceiling for the current foe), and a
clear "what each Move set adds" read. Symmetric to the existing Block/charge
readouts. Build it alongside the engine change.

### 5.6 The rate clamp `[2, 20]`

A high-stat/geared player pins `RATE_MAX 28`/attack card and foe Endurance stops
mattering (the deferred asymptotic floor-curve, CRAWL §6). With §5.2's larger HP
pools and §5.4's scaling gear the clamp will bind more often — the sim must check
whether the floor-curve is now needed to keep foe E relevant late.

---

## 6. The verification sim (build `sim/balance-sim.mjs`)

Extend `sim/progression-sim.mjs` (reuse `fight()`/`mc()`, the contest law, the
injection points). The new model needs the harness to add: **no block carry,
telegraph decoupled from player E, and a banked dodge pool capped by foe cadence.**

### 6.1 Skill becomes a 4-axis vector (was: sets/round only)

1. **Finding** — sets/round `{3, 6.5, 9, 12.5}`.
2. **Tactics efficiency** `0–1` — charges spent well (warding, Maneuver priming).
3. **Ability efficiency** `0–1` — VPM realized vs ideal; burst timing.
4. **Gear-choice efficiency** `0–1` — stats/procs matched to the fight.

### 6.2 Correlated profiles (run end-to-end)

| Profile | Finding | Tactics | Ability | Gear | Maps to |
|---|---|---|---|---|---|
| Novice | 3 | 0.2 | 0.3 | 0.3 | Floor |
| Average | 6.5 | 0.5 | 0.6 | 0.6 | **Typical — tuning target** |
| Good | 9 | 0.7 | 0.8 | 0.8 | Good |
| Expert | 12.5 | 0.9 | 0.95 | 0.95 | Excellent |

Also run **off-diagonal** cases: high-finding/low-tactics (the rusher) and
low-finding/high-tactics (the grinder) — the curve should reward *balanced* skill,
not let one axis trivialize content.

### 6.3 Matrix & outputs

Each profile × dungeon `D1–D5` (level-matched and ±2) × foe tier (minion/elite/
boss), Monte-Carlo:

- **Win-rate** + **avg rounds-to-kill** → check §7 band.
- **Avg & p10 HP remaining** → streak survival.
- **Worst single-round HP loss** → enforce the **≤40% doom cap**.
- **EDR attribution** — split damage into set-carry / abilities / procs / crit, and
  prevention into block / dodge / ward → **validate the §3 economy** and the
  **P/E/S equality** goal.
- **Defense-mode demand** — confirm both Block-favoring (chip) and Dodge-favoring
  (haymaker) foes appear so E and S are both rewarded (§3, encounter variety).
- **Gear-vs-innate share** by level → check the §5.4 crossover (~L11).

### 6.4 Conformance gates (passes when)

1. Typical profile sits in every §7 band.
2. Skill tiers are *separated* and monotone in Finding, with a felt spread.
3. No profile takes a single-round hit > 40% max HP at its tier.
4. The rusher kills faster **but** finishes elites/bosses with materially lower HP
   than the balanced profile (rush = real risk).
5. **P/E/S marginal EDR within ~±15% of each other** across the roster (the
   alignment goal) — given the encounter mix in §6.3.
6. Block and Dodge each *dominate* their intended tempo rows (Report B).
7. Gear share crosses 50% near L11, ~65% by L18.

### 6.5 Re-evaluation of existing work (don't duplicate)

- **Still valid:** contest/denomination math (sim §1–2), dodge-K (§5), XP curve
  (§6), dread anti-stall (§7), gold curve (§9) — every PROPOSED constant shipped.
- **Invalid for our goal:** §3 conformance is anchored to *Floor* play → re-anchor
  to Typical (§5.2). VPM=4 was right but **never applied to abilities** → apply it
  (§5.1). The §4 guard-carry result is *reversed* by §2.1 → re-sim.
- **New to build:** the 4-axis skill vector, the no-carry + decoupled-telegraph +
  banked-dodge combat model, the doom-cap constraint, the P/E/S-equality and
  defense-mode-demand checks, the gear-vs-innate share check.

---

## 7. Difficulty targets (the curve we tune against)

Win-rate *without consumables* (the panic button is headroom); kill time =
rounds-to-kill for that skill tier. Single fight, level-matched, geared on-curve.

| Foe tier | Floor win / rounds | Typical win / rounds | Excellent win / rounds |
|---|---|---|---|
| **Minion** | 85% / 2–3 | **97% / ~1.5** | 99.5% / 1 |
| **Elite** | 50–60% / 5–6 | **80% / ~4** | 95% / ~2 |
| **Boss** | 35–45% / — | **65–75% / ~6** | 90% / ~3–4 |

Principles baked in: tune at **Typical**; **one bad round ≤ 40% HP** and a 2–3
bad-round streak is losable vs elites/bosses but survivable vs minions; the
**attack rush is fast but exposed** (forgoing Defend/Dodge is the cost).

**Gear-vs-innate share:** innate ~80% (L1–6) → 50% (~L11) → gear ~65% (L14–21).

---

## 8. Open decisions

1. **Reward coupling** — decouple XP/gold from the HP raise (price off `P+E+S`)?
   *(Recommend: yes — rewards track threat, not the HP sponge.)*
2. **Charge income split** — how much to trim Tactics charge income now that Move
   also feeds dodge? *(Sim output.)*
3. **Dodge reset on success** — full reset to the Speed floor, or partial? *(Sim
   output; spec says full for now.)*
4. **Cooldowns** — VPM-reprice alone, or also build the planned cooldown gate so
   burst can't be mana-dumped? *(Recommend: reprice first, add cooldowns only if
   burst still spikes.)*

---

## 9. Sequencing

1. **Now:** ship the §5.1 damage-ability reprice (Firebolt/Cleave/Venom → max 24).
   Low risk, directly fixes the reported feel.
2. **Spec + sim:** write `sim/balance-sim.mjs` (§6) with the new combat model + the
   4-axis skill vector; iterate until the §6.4 gates pass.
3. **Build:** the engine changes (no block carry, telegraph decoupled from E,
   banked dodge pool + cadence cap, Move→dodge) + the **dodge meter** (§5.5),
   driven by the sim's numbers. Re-run the generation-invariant sweep (unaffected,
   but assert it).
4. **Tune:** enemy HP/threat (§5.2–5.3), gear scaling (§5.4) from the sim.
5. **Commit** tuned constants to YAML + `TUNING.md`; update `CRAWL-DESIGN.md` §5.6
   to the new model **only after** the sim proves it; fold the conformance run into
   CI beside the generation-invariant sweep.

*Code is the source of truth; cite `TUNING.md` for live constants. Every value in
§5 is a target for the §6 sim to confirm — not yet committed.*
