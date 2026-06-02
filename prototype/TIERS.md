# SET.core — Difficulty Tier Ladder

A named difficulty / flow ladder for tuning the Set minigame, grounded in
Monte-Carlo simulation of the real generation core. All numbers below come from
`prototype/sim-tiers.mjs` (300 generated boards per config: `genInitial` plus
5-patch replenish chains, across F∈{3,4}, N∈{8,10,12,14,16}, camo depth 1..F,
escape routes ∈ {1,2,3,4,6}). Re-run with `node prototype/sim-tiers.mjs`.

The ladder is **anchored at the f=3 / n=12 tuning base** (PROJECT.md §5). That
base is the **Standard / BASE** tier — the middle of the human-playable band, so
tiers radiate easier below it and harder above it.

---

## 1. The ladder

| # | Tier | F | N | Camo depth (target easiest-k) | Escape routes | Timer | DI | Realized easiest-k | Avg sets/board | Feel |
|---|------|---|---|---|---|---|---|---|---|------|
| 1 | **Trivial / Warmup** | 3 | 12 | k1 | 6 | 120s | 3.6 | 1.0 (100% achievable) | 10.5 | Gimmes everywhere; teaches the verb. You cannot lose. |
| 2 | **Easy / Stroll** | 3 | 12 | k1 | 3 | 90s | 4.6 | 1.0 (100%) | 9.1 | A pop-out gimme is always sitting there; relaxed. |
| 3 | **Standard / BASE** | 3 | 12 | k2 | 3 | 60s | 14.5 | 2.0 (100%) | 6.9 | **The f=3/n=12 anchor.** Moderate sets, comfortable density. |
| 4 | **Brisk / Pressed** | 3 | 12 | k2 | 1 | 60s | 15.5 | 2.0 (100%) | 6.2 | One lone moderate set as the best out; less slack. |
| 5 | **Tricky / Texture** | 3 | 8 | k2 | 1 | 45s | 18.0 | 2.0 (100%) | 1.7 | Small, tense board — the "duel" texture. Sparse, so misses cost. |
| 6 | **Hard / Step Up** | 4 | 12 | k2 | 3 | 60s | 23.7 | 2.0 (100%) | 4.1 | The F-step: 4 axes to verify, the invisible k4 tier now exists. |
| 7 | **Severe / Camo** | 4 | 12 | k3 | 2 | 45s | 34.7 | 3.0 (100%) | 2.6 | Best set is deeply camouflaged; no preattentive cue. |
| 8 | **Brutal / Mastery** | 4 | 14 | k3 | 1 | 30s | 39.0 | 3.0 (100%) | 1.9 | A lone camo set on a busy board, on a 30s clock. |

DI ordering (monotone up the ladder, by construction validated against the sim):
`3.6 → 4.6 → 14.5 → 15.5 → 18.0 → 23.7 → 34.7 → 39.0`.

Every tier above is **100% achievable** — the generator actually delivers the
listed easiest-k essentially every board. That was a deliberate selection
constraint: we did not put a tier on a target the core cannot reach (see §3).

### Optional headroom (above the named ladder)
The sim shows the realistic ceiling sits higher if you want it:
`F4 / N12 / k4 / routes 1` measures **DI 46.8** (the all-different "invisible"
tier, 99% achievable). It is intentionally left off the main ladder as a
boss/secret tier — it is a pure serial-verification grind with no Gestalt cue
anywhere, which is more "endurance" than "skill expression."

---

## 2. Methodology — how each signal is measured & the difficulty index

### Signals measured per config (Monte-Carlo, 300 boards each)
- **avg sets/board** — mean total sets present (availability). `boardKInfo().count`.
- **realized easiest-k** — the honest difficulty number: mean of the *minimum* k
  across sets on the board (`boardKInfo().minK`). This is what the prototype's
  "easiest-k gauge" shows; it is the findability floor a player actually faces.
- **achievability %** — fraction of boards whose realized easiest-k landed
  *exactly* on the camo-depth target. Low values flag depth saturation.
- **P(easiest set = k)** — distribution of the board's easiest-k (Pk1..Pk4),
  i.e. how often the *best* set is a gimme vs camo.
- **avg easy escape routes** — mean count of sets sitting at the easiest k
  (`hist[minK]`). Few = a needle; many = you trip over one.

These reuse the validated core functions copied verbatim from
`sim-invariants.mjs` (`randCard`, `third`, `findSets`, `boardKInfo`,
`boardFindDist`, `genInitial`, `patch`, plus the `state.camoDepth /
state.escapeRoutes` two-knob best-of-N model). No core logic was changed.

### The difficulty index (DI) — transparent formula
```
DI = 10·(easiestK − 1)        // CAMO term: how hidden the BEST set is (dominant)
   +  9·(F − 3)               // LOAD term: per-card cognitive load + the k4 tier
   +  8 / sqrt(routes)        // ROUTE term: fewer easy outs = harder (saturating)
   +  4·max(0, N − 12) / 4    // SCAN term: raw scan-load tax above the base
```
DI is computed **per board from realized signals** (not from the target dials)
and averaged, so it reflects what the generator actually produced.

Reasoning for each term (see PROJECT.md §2, §4):
1. **CAMO — realized easiest-k dominates.** k is the purest findability axis: a
   k=1 set pops out preattentively; a k=4 set has no shared cue and must be
   serially verified. Each step of easiest-k is worth a big, readable +10.
2. **LOAD — F.** f=4 means verifying a candidate triple over 4 axes not 3, *and*
   unlocks the entirely cue-less k=4 tier — the "second independent reason f=4 ≫
   f=3." Weighted just under a full camo step (+9 per feature).
3. **ROUTE — escape routes, saturating.** `1/sqrt(routes)` makes 1→2 routes
   matter far more than 6→7; a lone easy set plays much harder than five of them,
   but past a handful it stops mattering. This is the fine interpolator between
   integer k-steps.
4. **SCAN — N tax above base.** Raw scan-load is monotone in N, but we add it
   *only* above the n=12 base. The U-shape in NET difficulty is reconstructed
   automatically: at high N the abundance pushes the realized easiest-k *down*
   (CAMO term falls) while SCAN rises — the index doesn't hard-code the U, it
   emerges from the measured easiest-k. See §4.

Weights make CAMO the spine, F a strong secondary, routes the fine-tune, and
scan a gentle high-N nudge. Only the **ordering and gaps** matter — DI is in
arbitrary units for laddering, not an absolute "win rate."

---

## 3. Achievability — respecting what the core can actually generate

The sim's achievability heatmap (PROJECT.md §5 corner case, now re-measured):

```
F3 depth=k2   N8:100%  N10:100%  N12:100%  N14: 80%  N16: 14%
F3 depth=k3   N8:100%  N10: 74%  N12:  2%  N14:  0%  N16:  0%
F4 depth=k4   N8:100%  N10:100%  N12:100%  N14: 80%  N16: 25%
```

Key consequences baked into the ladder:
- **At the f=3 / n=12 base, the depth knob tops out at k2.** k3 (full f=3 camo)
  is reachable only **2%** of the time at N=12 — abundance forces incidental easy
  sets. So **no f=3 tier above k2 exists**; deeper f=3 camo would be a lie.
- **Real f=3 camo lives at low N.** k3 is 100% achievable at N=8 and ~74% at
  N=10. The *Tricky / Texture* tier deliberately drops to N=8 to access the
  tense, sparse end (though we keep it at k2 there for a clean 100% hit;
  N8/k3/routes1 is available at DI 28 if you want a harder texture variant).
- **f=4 keeps the full depth range** up to ~N=12 (k3 is 100% at every N≤16; k4 is
  100% up to N=12, 80% at N=14, 25% at N=16). The high tiers can safely live at
  f=4 / N≤14 without saturation.

---

## 4. Surprising findings in the data

1. **N's U-shape is real and visible — and it flips sign with F.** Holding depth
   k2 / routes 3 and sweeping N:
   - **F4:** DI = 24.9 → 24.2 → **23.7 (min at N=12)** → 25.6 → 27.6. A clean U:
     the dip at the base, rising both ways. At f=4 scan-load binds, so big boards
     read as harder *and* the easiest-k stays pinned at the target (depth holds),
     so the SCAN term wins — exactly the "N reads as difficulty only when F is
     high enough that scan-load is the binding constraint" claim.
   - **F3:** DI = 14.7 → 14.6 → 14.5 → 13.4 → **9.3 (falls off a cliff at N=16)**.
     At f=3 the camo target *can't hold* at high N — depth saturates, the realized
     easiest-k collapses toward 1 (avg e-k 1.09 at N=16), so abundance makes the
     board *easier* despite more cards. f=3 is availability-bound, f=4 is
     scan-bound. Same knob, opposite behavior — the U-shape is conditional on F.
2. **Depth saturation is sharp, not gradual, at f=3.** k3 achievability goes
   100% (N8) → 74% (N10) → **2%** (N12) → 0% (N14). It is a near-cliff between
   N=10 and N=12, which is precisely why the base sits at the k2 ceiling.
3. **The f=4 k=4 tier is the only true "no-cue" content.** Across all f=3
   configs, at least 23% of sets are always k=1 gimmes by combinatorics, so a
   fully camouflaged f=3 board is impossible. Only f=4 reaches the invisible tier
   — confirming F is the difficulty *spine*, not just a density knob.
4. **Escape-routes barely moves DI compared to a depth or F step.** Going
   routes 6→1 at the base adds ~+1 DI (14.5→15.5), while one depth step adds
   ~+10 and one F step adds ~+9. Routes is correctly a *fine* interpolator that
   fills the continuum between integer k-steps, not a tier-changer.

---

## 5. Which lever to reach for (moving between adjacent tiers)

From PROJECT.md §4: the dials are not peers on one scale. Use them by intent.

- **F (3 ↔ 4): the difficulty SPINE — use it for the big jumps.** It moves
  findability *and* availability at once (one F-step ≈ ×3.16 density) and is the
  only lever that unlocks a whole new camo tier. It is the gap between *Tricky*
  (DI 18) and *Hard* (DI 23.7) and underwrites everything above. The marquee
  skill expression is "high skill drops the encounter's effective F by one" —
  big and readable precisely *because* F dominates.
- **Camo depth (easiest-k): the next-coarsest findability step.** Each depth
  step is ~+10 DI. Use it to climb within an F band — e.g. *Hard* → *Severe*
  (f=4, k2→k3). **But check achievability first** (§3): at f=3/n=12 you cannot go
  past k2.
- **Escape routes: the fine-tune between depth steps.** ~+1 DI from 6→1 at the
  base. Use it to nudge a tier harder without changing its *character* — e.g.
  *Standard* → *Brisk* (k2, routes 3→1): same set difficulty, fewer outs, more
  pressure. This is how you fill the continuum.
- **N: TEXTURE, not difficulty (mostly).** Reach for N to change *personality* —
  low N = tense duel (few sets, every miss stings), high N = frantic melee — at
  roughly the same difficulty *while F is low*. At f=3, raising N actually makes
  things **easier** (depth saturates), so do not use N to push f=3 harder. Only
  at f=4 (scan-bound) does raising N add genuine difficulty (the *Brutal* tier
  uses N=14 for exactly this). Treat N as a knob you turn for feel, then verify
  DI didn't move the wrong way.
- **Timer: PRESSURE, the character-skill axis.** It does not change the board, so
  it is not in DI; it is layered on top as composure. The ladder shortens the
  clock as it climbs (120s → 30s) to model the encounter getting more frantic.
  In the eventual RPG this is the opposite-sign lever a skilled character pushes
  back with — buy time, or effectively buy −F.

**Rule of thumb:** big step → change **F**. Medium step within an F band →
change **camo depth** (if achievable). Fine-tune → change **escape routes** or
**timer**. Change **N** only to restyle feel, and re-check DI because its effect
depends on F.
