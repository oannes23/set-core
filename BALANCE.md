# BALANCE.md — the combat economy, diagnosis, targets & sim plan

*Written 2026-06-17. Companion to `TUNING.md` (live constants), `CRAWL-DESIGN.md`
§5–§5.7 (combat spec), and `sim/progression-sim.mjs` (the existing workshop).
This file is the **plan**: a single currency for every mechanic (expected damage
per round), a diagnosis of the current imbalance, the difficulty targets we tune
against, prescribed values, and the multi-skill-tier sim we build to verify it.*

> **Status of the numbers below.** Combat numbers are deliberately "vibes" until
> this pass (per `CLAUDE.md`). Anchors (the 25-quantum, the contest law) are
> *settled* and confirmed in code. The **prescribed values** in §4 are first-cut
> targets to be finalised by the §5 sim — not yet committed to YAML. The
> generation-invariant sweep is unaffected and unrelated.

---

## 0. Executive summary

The combat engine is sound; the **content numbers were authored in three
different denominations at three different times and never reconciled to one
economy.** Five concrete consequences:

1. **Damage abilities are under-costed ~2–3×.** Firebolt and Cleave both literally
   `dealRolled(s, 45)` for 4 mana (`abilities.ts:54,153`) — mean ~30, max 45,
   i.e. **7.5–11 dmg/mana** against an intended **~4 dmg/mana** (sim §11 VPM).
2. **Enemies die too fast to a skilled player.** Kill budgets (A6) were anchored
   to the *lowest* skill tier (one attack set/round ≈ 25 dmg). A typical player
   does 2–3× that; an excellent player 4–6×. Real kill times collapse to ~1 round
   (minion) / ~3–4 (boss). The "attack rush" the user flagged is the symptom.
3. **Enemy threat is fully blockable + dodgeable**, so it evaporates for anyone
   competent. Telegraph ≤ ~25/Defend-set; minion/elite traps are mostly
   non-damage (lock/drain/timer) or opt-in. Nothing forces a bad round to *hurt*.
4. **The "too easy" fix (`gearFactor`) is inert for the entire early game**
   (×1.0 at ≤ L6, `foe.ts:48–52`) — it never touches the D1 warren a player
   actually starts in.
5. **Gear barely scales with item level** (`LOOTTIER_K = 0.02`,
   `affixes.ts:86`; integer affix mags floored at 1) and innate stat allocation
   dwarfs it (+120 innate over the arc vs ~+8 native gear stat). So gear can
   *never* become "more important at high level" — the opposite of the goal.

The fix is one currency — **expected damage per round (EDR)** — applied four
ways: reprice abilities to it (§4.1), re-anchor enemy HP/threat to *typical*
play (§4.2–4.3), make gear scale with item level so it overtakes innate by the
late game (§4.4), and price the under-valued levers (Speed/charges/round-time,
§4.5). Then verify with a **multi-axis skill sim** (§5) that the difficulty
curve holds across player-skill tiers.

---

## 1. The unit: Expected Damage per Round (EDR)

**One round = 20 s** (`ROUND_MS`, `state.ts:134`). Everything is priced in **EDR
— HP of damage dealt (or prevented) per 20-second round, at stat parity, for a
reference player.** Damage prevented = damage dealt (net HP swing is the same
currency). This lets mana, Speed, round-time, block, and raw damage all be
compared on one axis.

### 1.1 The settled anchor (confirmed in code, do not move)

- **Contest law** (`resolve.ts:31–37`):
  `contestRate(yours, theirs) = clamp(8 + 0.2·(yours − theirs), 2, 20)`
  (`RATE_BASE 8`, `RATE_K 0.2`, clamp `[2, 20]`).
- **Quality tiers** `[0.7, 1.0, 1.4]` (`resolve.ts:19`); a magnitude-6 set
  (one card of each tier) has quality-sum **3.1**.
- **At parity (10 v 10):** one Attack card = `8 × q`; a full mag-6 Attack set =
  `8 × 3.1 ≈ 25 HP`. **This 25 is the even-exchange quantum** (A4) — the
  reference for everything below.
- **Telegraph budget** (incoming) = `contestRate(foeP, yourE) × 3.1 × tierMult`,
  `tierMult = {minion 1, elite 1.5, boss 2}` (`resolve.ts:55–58`). At parity:
  **25 / 37.5 / 50 per round**, level-invariant (difference math).

### 1.2 Skill expressed as sets/round

The single biggest EDR multiplier is **how many sets the player finds per round.**
Per the user's brief, the canonical skill ladder:

| Tier | Sets/round | Notes |
|---|---|---|
| **Floor** (low skill) | **3** | A2 "6/6/6" baseline — ~one set per verb |
| **Typical** | **5–8** (use 6.5) | the median player; **tune the curve here** |
| **Good** | **8–10** (use 9) | |
| **Excellent** | **10–15** (use 12.5) | ceiling of human play |

Sets shrink as wounds eat the board: `liveScale = ((15−wounds)/15)^1.5`
(sim `fight()`), so effective sets/round drops mid-fight — already modelled.

**Verb mix** (reference for pricing; the player chooses freely): ~40 % Attack,
~35 % Defend, ~25 % Move. An "attack rush" pushes Attack toward ~80 %+.

### 1.3 Per-round offensive EDR by skill (parity, attack-focused mix)

Attack sets/round ≈ `setsPerRound × 0.40` (rush ≈ ×0.8). Each attack set ≈ 25.

| Skill | Sets/rd | Attack sets/rd (40 %) | **Attack EDR** | Rush EDR (80 %) |
|---|---|---|---|---|
| Floor | 3 | 1.2 | **~30** | ~60 |
| Typical | 6.5 | 2.6 | **~65** | ~130 |
| Good | 9 | 3.6 | **~90** | ~180 |
| Excellent | 12.5 | 5.0 | **~125** | ~250 |

This table is the heart of the problem: **enemy HP (60/110/200) was set against
the Floor "1 attack set" column, so every tier above Floor melts the content.**

---

## 2. The master stat economy (per-point EDR at parity)

All values are marginal EDR per +1 of the lever, at parity, for the **Typical**
reference (6.5 sets/round). Multiply by the skill ratio for other tiers.

| Lever | Mechanism | EDR per +1 (Typical) | Skill-scaling | Notes |
|---|---|---|---|---|
| **Power** | `+0.2 rate/attack-card` → `+0.62/attack-set` | **~+1.6 EDR** (2.6 atk sets) | ∝ attack sets/rd | Pure offense. `resolve.ts:34` |
| **Endurance (block)** | `+0.62/defend-set` | **~+1.4 EDR-blocked** | ∝ defend sets/rd | Realised only when there's incoming to block |
| **Endurance (telegraph)** | `−0.62 × tier` of incoming, **automatic** | **~+0.6 / +0.9 / +1.2** (min/elite/boss) | flat (no play needed) | Foe budget uses your E directly. The reliable half of E. |
| **Speed (dodge)** | `+1.5 %` dodge → `−0.015 × telegraph` | **~+0.4 / +0.6 / +0.75** EDR-prevented | ∝ telegraph (tier) | `state.ts:186–189` |
| **Speed (charge)** | `+0.078 charge/move-set` | **~+0.01 EDR** (current) | — | **Broken — see §4.5.** Charge agency is unpriced. |
| **Mana** | converts at VPM | **~4 EDR/mana** (target) | ∝ ability use | Currently abilities pay 7.5–11; reprice. |
| **Round time** | `+1 s = +1/20 of your EDR` | **~+3 EDR/sec** (Typical) | **∝ your total EDR** | Slowdown is a *win-more* lever; scales hardest for experts. |
| **Block (raw)** | direct mitigation, capped, overflow lost | **~0.2–0.4 EDR per block point** | realisation-limited | sim §11 measured 0.21; depends on incoming. |
| **Heal** | direct + knits wounds | **~1.0–1.3 EDR per HP** | flexible timing | sim §11. Slightly > damage (wound knit + agency). |

### 2.1 Three things this table makes obvious

- **Endurance is the most reliable stat** — it pays twice (block on demand +
  automatic telegraph reduction). Power pays only when you choose to attack.
  Matches the sim's marginal-EV read (E +20pp > P +16pp > S +10pp on the boss
  bench).
- **Speed is mispriced.** Its only well-defined value is dodge (~0.4–0.75 EDR/pt)
  + round-time-via-tempo; the charge/Maneuver/Primed agency that's supposed to be
  its payoff prices at ~0. Either we make charges worth real EDR (§4.5) or we
  accept Speed as "the dodge + tempo + time stat" and price it honestly.
- **Round-time is the sleeper.** `+5 s` (e.g. Frostbolt) is worth ~**+15 EDR**
  to a Typical player and ~**+30 EDR** to an Excellent one — *more than its 24
  nominal damage.* Symmetrically, an enemy `−4 s` timer-advance (cowardly,
  `variants.yaml:41`) **costs a skilled player ~12–30 EDR** — it's the one enemy
  tool whose bite *grows* with player skill. We are under-using it.

---

## 3. Targets — the difficulty curve we tune against

### 3.1 Principles (from the brief)

1. **Tune the curve at the Typical player.** Floor players should win minions and
   sweat elites/bosses; Excellent players should win comfortably but not
   instantly. The *spread* between skill tiers should be felt, not flattened.
2. **One bad round must not doom you.** A single worst-case round (few sets, full
   telegraph, a trap) should cost **≤ 40 % of max HP** at the relevant tier, and
   wound recovery (1 knit/draw) + HP buffer must absorb it. Streaks of 2–3 bad
   rounds should be *losable* against elites/bosses but survivable against
   minions.
3. **The attack rush should cost something.** Pure-Attack play should kill faster
   but leave you exposed (no block banked), so a rush into a hitter is a real
   gamble — not a free win. Today it's a free win because enemies die in ~1 round.
4. **Stats > gear early, even mid, gear > stats late** (§3.3).

### 3.2 Target win-rate & kill-time band (single fight, level-matched, no consumables)

Win-rate is *without* consumables (the panic button) — real play runs higher.
Kill time = rounds-to-kill for that skill tier.

| Foe tier | Floor win / rounds | Typical win / rounds | Excellent win / rounds |
|---|---|---|---|
| **Minion** | 85 % / 2–3 | **97 % / ~2** | 99.5 % / 1–1.5 |
| **Elite** | 50–60 % / 5–6 | **80 % / 3–4** | 95 % / ~2 |
| **Boss** | 35–45 % / — | **65–75 % / ~6** | 90 % / ~4 |

The current sim reports baseline **minion 100 % / elite ~99 % / boss ~30 %** —
i.e. trivial trash, trivial elites, and a boss that's only "hard" because gear/
abilities (untuned) are meant to carry it. The target band above deliberately
**lowers minion/elite win-or-speed for skilled play** (more HP/threat) and
**raises the boss floor** (so a competent player can actually win one).

### 3.3 Gear-vs-innate power share (the requested curve)

| Band | Levels | Innate share | Gear share | Lever |
|---|---|---|---|---|
| Early | 1–6 | **~80 %** | ~20 % | small native stat only; `gearFactor` inert |
| Mid | 7–13 | **~50 %** | ~50 % | crossover ~L11 |
| Late | 14–21 | **~35 %** | **~65 %** | item-level-scaled affixes + procs dominate |

**Current reality is ~85 % innate at *all* levels** — innate allocation grants
+120 effective stat over the arc; a full kit grants ~+8 native stat plus a
handful of +1–3 affixes that *don't grow with item level*. To hit the curve, gear
contribution must scale with item/dungeon level (§4.4); innate stays as-is.

---

## 4. Prescribed values (first cut — finalise in §5 sim)

### 4.1 Reprice damage abilities to VPM ≈ 4

Mean delivered = `⅔ × max` (triangular `weightedRoll`). To hit a **target mean
= 4 × mana**, set **`max = 6 × mana`**. Discount hybrids (damage + utility) by
the EDR of the rider (round-time ≈ 3 EDR/s, etc.).

| Ability | Mana | Current max (mean) | **New max (mean)** | Rationale |
|---|---|---|---|---|
| Firebolt | 4 | 45 (30) | **24 (16)** | pure nuke → VPM 4 |
| Cleave | 4 | 45 (30) | **24 (16)** | pure nuke → VPM 4 |
| Venom Strike | 4 | 36 (24) | **24 (16)** | pure nuke → VPM 4 |
| Thorn Vines | 4 | 30 (20) | **15 (10)** | nuke + 5 s → discount ~6 dmg for time |
| Cold Blade | 3 | 30 (20) | **9 (6)** | nuke + 4 s → heavy time discount |
| Frostbolt | 5 | 24 (16) | **9 (6)** | nuke + 5 s + transmute → mostly utility |
| Fireball | 7 | scales (6/9/12·n) | **cap at mean ~28** | AoE; cap per-cast EDR |
| Rampage | 6 | scales (6/9/12·n) | **cap at mean ~24** | board-dependent; cap |
| Quick Strike | 3 | scales | **cap at mean ~12** | |
| Heal | 5 | 45 (30) | **~22 (heal)** | heal priced ~1.1 EDR; 5·4/1.1 ≈ 18–22 |
| Riposte | 4 | 24 (16) dmg +18 blk | **12 (8) dmg + 18 blk** | hybrid discount |
| Time Warp | 6 | 18 (12) + round-cap | **~9 (6) + round-cap** | round-cap is the real value |

**Method, not gospel:** the table assumes VPM 4 and the EDR prices in §2. The
sim (§5) will confirm VPM 4 is the right anchor (it may land 3.5–4.5) and adjust
the round-time discount once round-time EDR is measured per skill tier. Pure
non-damage abilities (Block, Bulwark, the Call-* shapers, Berserk, Rally) are
re-priced by their EDR effect, not damage — deferred to the sim because their
value is play-dependent.

> **Sequencing note:** the user's "45 for 4 feels overpowered" is the headline.
> Firebolt/Cleave/Venom → max 24 is the single highest-impact change and can ship
> ahead of the full sim with low risk.

### 4.2 Re-anchor enemy HP to *Typical* play

The A6 budget (`rounds_to_kill × 25`) was built on the Floor column (1 attack
set ≈ 25/rd). Re-anchor it to the **Typical** column (~65 attack EDR/rd) so the
*target rounds* in §3.2 hold for the player we tune for:

`new HP = target_rounds(Typical) × Typical_attack_EDR`

| Foe tier | Target rounds (Typical) | Typical attack EDR | **New HP** | Current | ×|
|---|---|---|---|---|---|
| Minion | ~2 | ~65 | **~120** | 55–65 | ~1.9× |
| Elite | ~3.5 | ~65 | **~220** | 110–130 | ~1.8× |
| Boss | ~6 | ~65 | **~380** | 200 | ~1.9× |

This is the user's "more enemy HP relatively" — roughly **×1.8–1.9 across the
board.** It makes the attack rush meaningfully longer (a rush still beats a
balanced approach on speed, but no longer in a single round), and it buys the
*time* that Defend, dodge, Tactics, and abilities need in order to matter.

**Reward coupling:** `foeValue = hp/10 + P + E + S` feeds XP and gold
(`foe.ts:33`). Raising HP by ~×1.9 lifts the `hp/10` term — e.g. a 60→120 HP
minion gains +6 foeValue (~+13 % XP/gold). Acceptable, or decouple by pricing
XP/gold off `(P+E+S)` only. **Decision needed** (see §6).

### 4.3 Give enemy threat a floor that survives competent play

Telegraph is fully blockable + dodgeable, so it vanishes for skilled players.
Add threat that *can't* be fully neutralised, while respecting the "one bad round
≤ 40 % HP" cap:

1. **Unblockable fraction.** A small slice of each telegraph (e.g. **15–20 %**)
   bypasses Block (it can still be dodged). At a parity boss (50/rd) that's
   ~8–10 guaranteed/round — pressure without doom.
2. **Make traps bite.** Minion/elite traps are mostly lock/drain/timer or opt-in.
   Raise the damage traps (war_cry_lesser ~17 → ~25; spiked_hide reflect to scale
   with the player's attack output) and add **timer-advance** to more elites — it
   scales with player skill (§2.1) and is the cleanest anti-rush tool.
3. **Foe Power nudge on hitters.** Selected elites/bosses get +2–4 Power so their
   telegraph slightly outpaces incidental Defend (forces *dedicated* defending,
   not free coverage).

**The doom cap:** worst-case unblocked round (full telegraph × dread × a trap)
must stay ≤ 40 % max HP at each tier. The sim enforces this as a hard constraint
— it's the formal version of "one bad round shouldn't doom you."

### 4.4 Make gear scale with item level (so it overtakes innate late)

Root cause: `affixMagUnit = perAffixPower × (1 + lootTier × 0.02)`
(`affixes.ts:109`) — only **+2 %/loot-tier**, and integer mags floor at 1, so a
L19 orange ≈ a L3 orange. Gear is frozen.

**Prescription:** scale affix/rider magnitude with item level so a full late kit
reaches ~65 % of innate power (§3.3):

- Raise `LOOTTIER_K` from `0.02` toward **~0.08–0.12** (steep enough that a L19
  drop carries ~2–3× the magnitude of a L3 drop), **and** lift the integer floor
  so high-item-level affixes round to 2–4, not 1.
- Keep the **rarity** axis as the *texture/proc* axis (how many affixes, which
  proc families) and make **item level** the *magnitude* axis. Rarity = build
  variety; item level = raw power. This cleanly separates "interesting" from
  "strong."
- Keep `gearFactor` (the foe raise) but **extend it below L6** (or set a small
  early-foe HP raise) so the D1 warren isn't unscaled — otherwise early gear has
  nothing to push against and the early "stats > gear" band happens by accident,
  not design.

The exact `LOOTTIER_K` and floor are sim outputs (§5) — the constraint is the
§3.3 share curve.

### 4.5 Fix Speed / price the under-valued levers

- **Charges (~0 EDR today).** Two options the sim should A/B:
  (a) raise charge EDR by making **Maneuver Priming** stronger (Primed = +1
  *and a half* quality tier, or Primed cards also +1 to the set's mana) and
  **Warding cheaper** (wound ward 3 → 2 charges); or
  (b) accept Speed as the **dodge + tempo + round-time** stat and rebalance its
  point-value via `DODGE_K` (currently 0.015) upward so dodge alone makes Speed
  competitive with P/E. Recommendation: **(a) first** — charges are the design's
  signature agency; making them worth ~0.5–1 EDR/charge restores Speed's identity.
- **Round-time** is already valuable (§2.1) — just price abilities/consumables
  that grant it correctly (§4.1) and lean on enemy timer-advance as anti-skill
  pressure (§4.3).
- **The rate clamp `[2, 20]`.** A high-stat/geared player pins `RATE_MAX 28`/attack
  card and foe Endurance stops mattering (the deferred asymptotic floor-curve,
  CRAWL §6). With §4.2's bigger HP pools and §4.4's scaling gear this clamp will
  bind more often; the sim must check whether the floor-curve is now needed to
  keep foe E relevant in the late game.

---

## 5. The verification sim (build this)

Extend `sim/progression-sim.mjs` (reuse its `fight()`/`mc()` harness, contest
law, and injection points) into a **multi-axis skill sim**, `sim/balance-sim.mjs`.

### 5.1 Skill becomes a vector, not a scalar

Today skill = sets/round only (1.8/3/5). Model **four axes** the user named:

1. **Finding** — sets/round: `{3, 6.5, 9, 12.5}` (Floor/Typical/Good/Excellent).
2. **Tactics efficiency** `0–1` — fraction of charges spent well (warding the
   right wounds, Maneuver-priming live attack sets).
3. **Ability efficiency** `0–1` — VPM realised vs ideal (does the player spend
   mana on-curve and time bursts into telegraphs / kills).
4. **Gear-choice efficiency** `0–1` — how well equipped stats/procs match the
   fight (right colour weapon, defensive vs offensive build).

### 5.2 Correlated player profiles (run these end-to-end)

| Profile | Finding | Tactics | Ability | Gear | Maps to |
|---|---|---|---|---|---|
| Novice | 3 | 0.2 | 0.3 | 0.3 | Floor row of §3.2 |
| Average | 6.5 | 0.5 | 0.6 | 0.6 | **Typical — the tuning target** |
| Good | 9 | 0.7 | 0.8 | 0.8 | Good row |
| Expert | 12.5 | 0.9 | 0.95 | 0.95 | Excellent row |

Also run the **off-diagonal** cases the user cares about: high-finding/low-tactics
(the "set-rush" player) and low-finding/high-tactics (the grinder) — the curve
should reward *balanced* skill, not let one axis trivialise content.

### 5.3 Matrix & outputs

For each profile × dungeon `D1–D5` (level-matched and ±2) × foe tier
(minion/elite/boss), Monte-Carlo and report:

- **Win-rate** and **avg rounds-to-kill** → check against §3.2.
- **Avg & p10 HP remaining** → the streak-survival read.
- **Worst-case single-round HP loss** → enforce the **≤ 40 % doom cap** (§3.1).
- **EDR attribution** — split each profile's damage into set-carry / abilities /
  procs / crit, and damage-prevented into block / dodge / ward, to **validate the
  §2 economy** (do the levers actually pay what the table says?).
- **Gear-vs-innate share** by level → check the §3.3 crossover (~L11).

### 5.4 Conformance gates (the sim passes when)

1. Typical profile sits in every §3.2 band.
2. Skill tiers are *separated*: win-rate and kill-time monotone in Finding, with a
   meaningful spread (no tier trivialises or walls the content).
3. No profile ever takes a single-round hit > 40 % max HP at its tier.
4. The attack-rush profile kills faster **but** finishes elites/bosses with
   materially lower HP than the balanced profile (rush = real risk).
5. Gear share crosses 50 % near L11 and reaches ~65 % by L18.
6. Measured per-lever EDR matches §2 within tolerance (else re-price).

### 5.5 Re-evaluation of existing work (don't duplicate)

- The contest/denomination math (sim §1–2), guard-carry (§4), dodge-K (§5),
  XP curve (§6), dread anti-stall (§7), gold curve (§9) are **still valid** —
  every PROPOSED constant shipped verbatim. Keep them.
- **Invalid for our goal:** the §3 conformance targets are anchored to Floor
  play; re-anchor to Typical (§4.2). The §11 VPM=4 intent is right but **was
  never applied to the abilities** (they still pay 7.5–11) — apply it (§4.1).
- **Missing entirely:** the 4-axis skill vector, the gear-vs-innate share check,
  the doom-cap constraint, and the per-lever EDR attribution. Build these.

---

## 6. Open decisions (need a call before building)

1. **Reward coupling** — decouple XP/gold from the HP raise (price off `P+E+S`
   only), or accept the ~+13 % reward bump from §4.2? *(Recommend: decouple — keep
   rewards tied to the threat statline, not the HP sponge.)*
2. **Speed fix** — buff charge EDR (option a) or re-price Speed as dodge/tempo/
   time (option b)? *(Recommend: a — protect the Tactics identity.)*
3. **Unblockable fraction** — flat 15–20 % of telegraph, or only on elites/bosses?
   *(Recommend: elites/bosses only — keep minions fully counterable.)*
4. **Ability max vs cooldowns** — VPM-4 reprice alone, or also build the planned
   cooldown gate (CRAWL §3) so burst can't be mana-dumped? *(Recommend: reprice
   first, measure, add cooldowns only if burst still spikes.)*
5. **Ship Firebolt/Cleave/Venom → max 24 now**, ahead of the full sim? *(Recommend:
   yes — lowest-risk, highest-feel change; it directly answers the brief.)*

---

## 7. Sequencing

1. **Now:** ship the §4.1 damage-ability reprice (Firebolt/Cleave/Venom → max 24,
   the rest per table). Low risk, directly fixes the reported feel.
2. **Next:** build `sim/balance-sim.mjs` (§5) — the 4-axis skill vector + the
   §5.4 gates.
3. **Then:** drive enemy HP (§4.2), the threat floor (§4.3), gear scaling (§4.4),
   and the Speed/charge fix (§4.5) from the sim until all §5.4 gates pass.
4. **Finally:** commit the tuned constants to YAML + `TUNING.md`, and fold the
   conformance run into CI alongside the generation-invariant sweep.

*Code is the source of truth; cite `TUNING.md` for live constants. Every value in
§4 is a target for the §5 sim to confirm — not a committed number.*
