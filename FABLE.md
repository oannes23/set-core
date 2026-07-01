# FABLE.md — full-repo review #2 (Fable 5, 2026-07-01)

A synthesis of a **ten-track parallel review** of SET.core at HEAD `a57cc32`, with every
high/medium finding independently **adversarially verified** by a second agent instructed to
refute it (44 confirmed, 1 refuted, 61 low/info observations recorded unverified). Tracks:
core math & invariants · combat engine · run economy · YAML/data pipeline · net seam &
daily · UI layer · docs-vs-reality · prior-ledger recheck · product/game design · tests &
tooling. Scope: **set-core + the client side of the Embassy seam** (the `crawl-records`
backend is reviewed separately).

Baseline at review time: **370/370 tests passing, `tsc --noEmit` clean**, ~15,250 lines of
TS in `src/` (~11,300 non-test + ~3,950 in 43 test files), 15 YAML content files, a
12-module net layer, 14 dungeons / ~80 foes / 9 classes / 24 affixes. For comparison, the
2026-06-09 review (this document's predecessor) saw 67 tests and ~5,400 lines — the codebase
tripled in three weeks.

**Table of contents**
1. [Executive summary](#1-executive-summary)
2. [The 2026-06-09 ledger, re-verified](#2-the-2026-06-09-ledger-re-verified)
3. [Bugs — engine & core](#3-bugs--engine--core)
4. [Bugs — economy & content semantics](#4-bugs--economy--content-semantics)
5. [Bugs — net seam & the daily](#5-bugs--net-seam--the-daily)
6. [Bugs — UI](#6-bugs--ui)
7. [Hard-rule invariant audit](#7-hard-rule-invariant-audit)
8. [Architecture](#8-architecture)
9. [Data pipeline, CI & tooling](#9-data-pipeline-ci--tooling)
10. [Docs vs reality](#10-docs-vs-reality)
11. [Game design & product](#11-game-design--product)
12. [Tests & performance](#12-tests--performance)
13. [Context for future sessions](#13-context-for-future-sessions)
14. [Prioritized action list](#14-prioritized-action-list)

---

## 1. Executive summary

The project graduated. In June it was a well-theorized combat prototype; today it is a
complete game loop — create → town → delve → fork → boss → loot triage → town — with a
closed economy, twelve authored dungeons, a YAML content pipeline with generated schemas,
a balance model that was actually simulated and ported, and an offline-first network seam
whose daily challenge is deterministic to the card. The fix discipline since the last
review is genuinely unusual: **22 of 27 concrete defects from the June ledger are
verifiably fixed with tests**, most within days, and the fixes carry their ledger IDs in
code comments. The purity architecture (single reducer, injected RNG, events out, pure
tested modules around an untested glue monolith) is not aspirational — it is enforced by
the import graph and proven by a replay-determinism test.

The big themes this time:

- **One real engine bug: the zombie foe.** Rollover-time proc damage (Barbed thorns,
  Overflow spill) can drop the foe to 0 HP with no win check; the dead foe rolls a fresh
  telegraph, its traps keep ticking, and it can kill you at the next exchange — a loss to
  an empty HP bar. Every *other* damage path checks; this one fell through. (§3, E1.)
- **The telemetry corpus is quietly poisoning itself, four ways at once.** Every finished
  fight queues a record whose action log contains **every 60 fps tick** (~350–450 KB per
  2–3 min fight) into an **uncapped localStorage outbox** that the default (offline)
  player never flushes — the origin quota fills within an evening or two, after which new
  records are *silently dropped* and, at the margin, roster/bank saves start silently
  failing too. Meanwhile records aren't replayable outside the daily (selection isn't in
  the action log; delve foes roll from `systemRng`), dev-mode cheat runs upload as
  unmodded, and the pause is invisible to the record so "fastest clear" is free to cheese.
  Four tracks independently converged here. The corpus being collected *now* is the future
  leaderboard's anti-cheat substrate; format decisions get harder after launch. (§5.)
- **The anti-stall was fixed structurally exactly as the last review prescribed — and then
  combo OVERTIME reopened it.** The universal dread bleed is real and unguardable, but
  it's rollover-anchored, and an uncapped OVERTIME hold (any set every <3 s) suspends the
  rollover: no strikes, no dread ramp, no bleed, unbounded banked attack. Top-skill play
  degenerates into a one-exchange boss kill. (§3, E2.)
- **The docs split into two castes.** The banner-annotation convention works — BALANCE.md,
  MODDING.md, UX.md, PROJECT.md are honest — but the three most load-bearing docs missed
  the last two cycles: **CLAUDE.md actively misinstructs sessions** (forbids the balance
  sim that already ran; calls built systems "pending"; omits `src/net/` entirely),
  TUNING.md contradicts its own top banner in ~10 rows still marked ✅ LIVE, and the
  modder wiki documents loot fields that no longer exist. (§10.)
- **The ship pipeline has no gate.** Deploy-to-Pages runs on every master push with no
  test, no typecheck, and no content validation — a dangling YAML ref white-screens prod;
  a schema error ships silently. The 3.5-second suite would cost nothing. (§9.)
- **The two pre-public blockers from *both* prior reviews are still open**: colorblind
  redundant encoding (color is a literal match axis; the palette is still the classic
  deutan confusion pair) and the trademark rename — while the public surface (PWA
  manifest, Pages deploy, Embassy handles) keeps growing under the exposed name. (§11.)
- **The product's weakest surface is the first minute, not the tenth hour.** The loop,
  economy, and daily are built; a fresh boot lands on ten undifferentiated town tiles with
  no route to the (good, built) tutorial, class kits exhaust their unlocks at L3, and the
  daily promises a leaderboard that doesn't exist. Highest-leverage next build: the
  fresh-save funnel, with the daily-integrity batch riding along. (§11.)

---

## 2. The 2026-06-09 ledger, re-verified

Every item from the prior FABLE (§2–§6, §14) and REVIEW-2026-06-16's open list was
dispositioned against HEAD with file:line or commit evidence.

### Engine bugs (old E1–E8)

| Item | Status | Evidence |
|---|---|---|
| E1 clock-cap clamp (HIGH) | **FIXED → OBSOLETE** | Fixed in `e70687f` (clamp the gain, consolidated, +7 regression tests); ROUNDS v3 then replaced the clock model entirely — `extendRound` budgets the gain (`ops.ts:123-131`), `shortenRound` floors at now+1s (`ops.ts:134-142`). Correct by construction, single site each. |
| E2 post-death `lost` re-emit | FIXED | `triggers.ts:275, 300-302` (running guards + effect-loop short-circuit). |
| E3 `highest_mag` no-op | FIXED | Ordered pick takes the top of the sort (`triggers.ts:116, 237, 247`). |
| E4 match-fired traps vs matched trio | **STILL OPEN — regression of REVIEW's "closed" claim** | Re-filed as §3 E6 below with shipped-content hit rates. |
| E5 `completeSet` after combat over | FIXED | `combat.ts:287`. |
| E6 post-death tick upkeep | FIXED | `combat.ts:354, 471`. |
| E7 scrolls bypass ethereal hook | FIXED | `consumables.ts:200-202` ("a cast is a cast — no silent zero"). |
| E8 `patch` crash/hang edges | FIXED | `generate.ts:182, 201, 208` (attempt guards + `anyUnusedCard` sweep). |

### UI bugs (old U1–U9)

| Item | Status | Evidence |
|---|---|---|
| U1 Enter confirms danger modals (HIGH) | FIXED | keydown handles only Escape (`app.ts:2252`); Enter activates the focused button natively. |
| U2 modal stacking leak | FIXED | prior modal's `_cancel` runs (`app.ts:2240-2242`; `router.ts:49`). |
| U3 `V.paused` leak past flee | FIXED | `app.ts:3868-3870`. |
| U4 misread trio lingers | FIXED | selection cleared immediately (`app.ts:2209-2213`). |
| U5 unbounded per-frame tick actions | **STILL OPEN — impact upgraded to the wire** | Re-filed as §5 N1; the daily shipped *without* the coalescing REVIEW named as its prerequisite. |
| U6 selection survives in-place transmute | FIXED | `revalidateSelection` by card key (`select.ts:134`), wired + unit-tested. |
| U7 stray FX timers | FIXED | scene-router contract (`router.ts:16-50`). |
| U8 tooltip timer | FIXED | `router.ts:79`. |
| U9 raw names into innerHTML | **STILL OPEN, surface widened** | now includes server-echoed Embassy handles — §6 U3. |

### Invariant risks (old I1–I4) & architecture (old A1–A6)

- **I1 makeable-floor re-assertion — FIXED**: `reformSlots` excludes locked (`ops.ts:144-151`),
  `lockSlots` enforces incrementally, `patch`/`patchFavor` take `excluded`; proven by
  `floor-stress.test.ts` (600 seeds × both orderings).
- **I2 unbounded transmute `gap` — STILL OPEN** and more relevant now content is
  modder-facing YAML (no `maximum` in any schema; engine uses `gapMs` raw).
- **I3 plant fallback — PARTIAL/accepted**: now lock-aware, weighted path exercised by the
  invariant sweep (old T1 done), guarded by the canary. No action needed.
- **I4 silent below-floor fallback — FIXED**: `floorCanary` (`generate.ts:130-143`)
  counts + dev-warns on every fallback return.
- **A1 presentation in events — open** (§8). **A2 pushClock ×4 — obsolete.**
  **A3 castables-as-code — partial by design** (all *content* is YAML; abilities/passives/
  consumables/tactics are the declared Phase-3 effect-DSL). **A4 serializable CombatState —
  partial** (still Maps, no snapshot/restore; wire record now carries version tokens, and
  the deferred extended-session seam is documented at `capture.ts:12-15`). **A5 run
  reducer — FIXED** (`engine/run.ts`). **A6 — partial** (`START_GRACE_MS` still engine-side;
  `session.ts:41` still hardcodes `COMBAT_GEN`).

### Save & PWA (old §6) and the action list (old §14)

Save envelope/migrations/validation — **FIXED** (SCHEMA_V 4, migration table, per-char
sanitize). sw.js network-first navigations + PROD-only registration — **FIXED**; cache
rotation/eviction and offline fonts — **still open** (`sw.js:8, 29, 43`).

§14 items 1–10, 13, 15: all confirmed done in current code. Item **11 (structural
anti-stall) — FIXED as prescribed** (universal unguardable dread bleed ∝ maxHP,
foe-independent, `state.ts:171-173` / `combat.ts:483-488`) — *but see §3 E2 for the
OVERTIME hole that suspends it*. Item **12 (colorblind) — STILL OPEN**, third review in a
row. Item **14 — done at the stated bar** (every one of 9 kits has ≥1 unique ability;
Cryo≈Chrono thinness stands as commentary). Item **16 (rename) — STILL OPEN**, urgency
rising. Item **17 (daily) — substantially done** (shipped deterministic; the shareable
result card is unbuilt; shipped without U5). Item **18 — partial**:
`prefers-reduced-motion` done and threaded through JS; audio (0 sounds), tap-to-toggle
tooltips, and defeat forensics still open.

REVIEW-2026-06-16's Tier-1 items (run the balance sim; build the Rounds v3 UI) — **both
done**. Its FABLE re-verification was accurate **except E4**, which it wrongly marked
closed.

---

## 3. Bugs — engine & core

All items below were adversarially verified (CONFIRMED) unless noted. Fresh IDs — the old
ledger is dispositioned in §2.

### E1 — Rollover proc damage kills the foe with no win check: the zombie foe (HIGH)

`src/engine/combat.ts:472, 492` — in `rollover()`, after the enemy swing, the wound-proc
block (`fireProcs(s,'wound',…)` — the **Barbed** affix, live blue-rarity armor content,
`affixes.yaml:269-285`) and the lowHP-proc block can deal damage via `dealAbilityDamage`
(`ops.ts:100-106`), which clamps HP to 0 and **never checks for the win**. Every other
damage path checks (`completeSet` :312, the banked swing :441, casts/consumables :536/:545)
— this one falls through: the dead foe rolls a fresh telegraph (:513), its tick traps keep
firing (tick has no `enemyHP > 0` gate, unlike the match path :310), an `enemy_heal` tick
trigger can even *revive* it, and at the next rollover the 0-HP foe's strike lands and can
emit `lost`. Verified end-to-end; one narrowing: if the player banks any attack next round,
the player-swing branch (:441) retroactively fires the win — so the loss window is
exactly the desperate all-defend round where you banked nothing, which is precisely when
you're low enough for Barbed to have fired. **Fix:** an `enemyHP <= 0 → onWin + return`
check after the wound/lowHP proc blocks (or once after the enemy-swing section); consider
gating tick-triggers on `enemyHP > 0` to match the match path.

### E2 — Uncapped COMBO OVERTIME freezes the entire anti-stall lane (MEDIUM)

`src/engine/combat.ts:399-406`, `state.ts:225` — `COMBO_OVERTIME_CAP_MS = 0` makes the
hold unbounded; any player who finds a set every <3 s (FLOOR ≥ 1 guarantees one exists)
holds the round open indefinitely. While held: the foe never strikes (strikes are
rollover-only, :449), `s.round` never advances so `dreadLevel` (keyed to round,
`state.ts:162-164`) is frozen, the **unguardable dread bleed never applies** (rollover-only,
:485), and `roundAttack` banks without limit — any boss dies to one exchange at zero risk.
The uncapped choice is documented as deliberate ("the 3 s grace IS the skill gate",
`state.ts:221-223`) but the dread-freeze interaction is unexamined and directly voids the
§14-item-11 structural anti-stall for exactly the players it was aimed at. Tick-cadence
trap damage still lands but its dread scaling is frozen too, and many foes (including the
daily tier) have no such kit. **Fix:** set a real cap, or derive dread from elapsed time /
count overtime as fractional rounds, or escalate the grace requirement as overtime
stretches.

### E3 — Soak skips `instant_attack` and trap damage (MEDIUM)

`src/engine/triggers.ts:348-357` — the exchange strike subtracts `s.mods.soak` pre-Block
(`combat.ts:460`) and so does the flee parting blow (:79), but `enemyAttack()` (the
`instant_attack` trap effect — diegetically the same foe swing) passes the raw roll to
`hurtPlayer` and computes the wound law off the unsoaked bite; the flat `damage` trap
effect likewise. Dodge's trap exemption is documented (`state.ts:193`); Soak's is not —
Ironhide's copy says "permanent, pre-Block" with no carve-out. Soak 4 vs a roll of 10:
player expects 6, takes 10. **Fix:** subtract soak in `enemyAttack` (decide the flat
`damage` case), or document the exemption beside dodge's.

### E4 — `completeSet` accepts `[i,i,i]`: a full set's value from one card (MEDIUM)

`src/engine/combat.ts:286-294` — no distinctness check on the three slot indices, and
`isSet(c,c,c)` is *always* true (3aᵢ ≡ 0 mod 3). Empirically confirmed: dispatching
`{type:'completeSet', slots:[0,0,0]}` through `runReduce` banks a full attack (0→21),
grants mana, fires the combo/trigger bus, and reforms one slot. The UI can't produce it,
but the reducer is the **declared server-authority anti-cheat seam** (`session.ts:1-8`)
and the wire record is exactly this action shape. Toothless today (the server stores
`actions` opaquely and trusts client `outcome` numbers), a leaderboard exploit the day
replay verification ships. `[i,i,j]` is impossible (would need a duplicate card), so the
distinctness check is the only missing guard. **Fix:** one line at :288.

### E5 — Maneuver's `liveBurn` spends charges into the rule-6 shield and spuriously Primes (MEDIUM)

`src/engine/tactics.ts:56-65` — `liveBurn` picks the deadest non-conforming card without
consulting `protectedSlots`, then *unconditionally* decrements `s.charges`, marks
`s.primed[pick]`, and emits `tacticsBurned`; `transmute()` then silently skips the pick
because `source:'churn'` is shield-filtered (`triggers.ts:136-140`). Two player-visible
wrongs, both verified empirically: Maneuver burns ~1 charge/s into nothing while a partial
selection covers the deadest card (common play), and the untouched card is marked Primed —
matching it within 6 s grants the +1 quality tier (`resolve.ts:148`) for a churn that
never happened. A small free-damage exploit via holding selections in Maneuver. **Fix:**
filter the pool by `protectedSlots` (mirroring the cast exemption), or have `transmute`
report affected slots and only spend/prime on success. Related low: the primed mark also
survives *any* non-match turnover of the slot, so an enemy-reformed card can inherit
primed status (clear `primed[i]` in `transmute`/`inflictWounds`).

### E6 — Match-fired traps vs the matched trio: old-E4, still live (MEDIUM)

`src/engine/combat.ts:310, 317-321` — match triggers fire while the three matched cards
are still on the board; the slots are cleared+refilled after. The matched trio is *not*
covered by rule-6 protection because the UI empties `V.selected` before dispatching
(`app.ts:2204-2205`). Two shipped-content failures: (1) a trap `transmute` with a `gap`
that selects a matched slot marks it pending — `reformSlots` immediately refills and
deletes the pending (`ops.ts:152-154`), silently erasing the trap's hole and bias;
(2) a trap `lock` on a matched slot pre-locks the brand-new reform card the player never
saw. `limbless` (bottom-row lock + gap-5000 transmute *on the very match that triggers
it*) overlaps the trio ~74% of firings; `petrify` ~37%. The makeable floor itself holds
(reformSlots passes `locked` into patch) — the defect is mechanics/feel, and the prior
review's "closed" claim was wrong (no fix commit exists). **Fix:** fire match triggers
after the clear+refill, or pass the matched slots as an exclusion set for board-verb
selectors for that firing.

### E7 — Replay determinism is broken by rule 6 itself (MEDIUM, cross-filed with §5)

`src/engine/session.ts:47` — engine outcomes now depend on `s.selected` (the shield
filter), but selection is UI-ephemeral state injected outside the action system
(`app.ts:2434`); there is no `setSelection` action and the recorded log doesn't carry it.
`runSession` replays with `selected: []` forever, so any sourced transmute whose target
set intersected the live selection resolves differently on replay — different cards
destroyed, divergent RNG stream, cascading state divergence. This falsifies `session.ts`'s
own authority claim and the workspace's "action log + seed is replay-ready" premise.
`seam.test.ts` passes only because its synthetic client never selects. **Fix:** make
selection part of the log (a `setSelection` action on change, or embed the snapshot in
tick/completeSet).

**Refuted for the record:** a claimed "FLOOR suspended during transmute pending gaps →
5-second dead boards from `limbless`" finding was **REFUTED** — limbless is an on-match
trigger and `completeSet`'s trailing refill restores ≥ FLOOR within the same action. The
surviving kernel is narrow: a rare all-three-matched-slots-locked corner can dead-board
for up to 5 s (dev-canary only), and the fuzz test skips its floor assertion whenever
*any* pending exists (wound pendings persist across rounds), so this corner and any future
`gap>0` tick-trigger content are untested. Worth a fuzz tightening, not an invariant
break.

**Engine lows/infos** (unverified, recorded): wound shatters and locks bypass the rule-6
shield entirely (the invariant text scopes itself to transmutes, but the rationale applies
— prefer non-protected slots in `inflictWounds`/`lockSlots`, keeping protection a
*preference* so floor logic stays intact); scroll casts skip `firePassives('ability')` so
Spell Echo never procs off scrolls (the E7-fix reasoning wasn't extended — decide or
document); lifesteal double-dips `dreadPlayerMult` (heal scales with the multiplier
squared past dread onset); `partingBlow` ignores the banked dodge pool (documented match
to the doc comment — a design choice worth revisiting); stale doc-comments in
`tactics.ts:4` / `events.ts:33` still say ward costs 1 (code: 2); `foe.ts:8` header still
says telegraph finalizes against the *live player's* Endurance (decoupled to level-parity
since BALANCE §2.2).

---

## 4. Bugs — economy & content semantics

### C1 — Winning the daily persists the phantom "Daily Challenger" into the roster (HIGH)

`src/ui/app.ts:3902` — `beginDaily` builds an ephemeral standardized hero (`makeChar`,
:659) that "must never enter the persisted roster" (endScreen's own comment gates the HP
write on `!DAILY`, :3878-3881). But `awardXP` — fired on every `won` event (:2447) — calls
`upsertChar(V.char)` **unconditionally**, and `upsert` appends unknown ids
(`save.ts:207-213`). Every won daily inserts a fresh level-1 "Daily Challenger" (new
`freshId` each play, with banked XP) into `setcore.roster.v1`: one phantom hero per win,
visible in the Barracks, feeding `highestCharLevel()`/market stock. Losses don't pollute
(no `won`, no `foeChanged` on the single-foe daily). **Fix:** `if (!DAILY) upsertChar(…)`
in `awardXP` (or an `ephemeral` flag on the View); add a save-level test that a
daily-shaped flow never grows the roster.

### C2 — Enchant-on-white → transfer games the inverse affix budget: ~3× native magnitude (MEDIUM)

`src/engine/smith.ts:99-119` + `src/data/affixes.ts:111-112` — affix magnitude mints at
the *piece's* rarity (`perAffixPower`: white 1.4 vs orange 0.5, ×(1 + lootTier·0.12)),
`transferAffix` keeps the rolled magnitude verbatim, and `canReceiveAffix` checks only
`minRarity ≤ dst`. So: buy a white piece at high lootTier (bands 13–18 still stock white),
enchant FlatPower for 100 g (→ +9), transfer to an orange base for 800 g — vs the native
orange mint of +3. Realized 3× after rounding; capped at 3 of 5 slots by the
duplicate-`sys` refusal (only 3 white-min affixes exist), 2× via green donors for the
rest. Low-rarity minting is strictly optimal crafting, inverting the rarity ladder's
texture-vs-magnitude design; nothing in code/tests/docs acknowledges it. Pure-balance
(single-player, sim-gated economy), but flag it in BALANCE.md **now** so the gated sim
pass tests it. **Fix candidates:** re-mint to the destination's rarity unit on transfer,
or mint enchants at a rarity-independent unit.

### C3 — `drain_mana` with omitted color drains RED, docs say "spread" — the D6 signature hex is broken (MEDIUM)

`src/engine/triggers.ts:224` — omitted `color` silently means index 0 (Fire).
`docs/yaml-content.md` documents "of color, or spread"; the spread form was never
implemented (faithfully ported from the prototype). Two live triggers rely on the default:
`hex_drain` (4 Serpent-Cult creatures) and `hex_lesser` (the boss_mirror on **every**
serpent_cult elite) — both fire on an **all-blue** match and drain **Fire** mana. For a
player whose kit doesn't spend red, the D6 dungeon's signature identity ("hexes bleed your
mana dry") is a near-no-op; for others it punishes an unrelated pool. Content desc, modder
doc, and code all disagree. **Fix:** implement spread, or require `color` in the schema
and set the hexes to blue (the thematically coherent read); update the doc either way.

**Economy lows/infos:** loot-table `drops: [min,max]` actually rolls min + one
Bernoulli(0.5) — a modder's `[1,3]` never yields 3 (`loot.ts:235`); the cascade-potion
descs say "clear them" but the counted cards are never cleared (`consumables.ts:139-150`),
and the payoff counts flood targets before a non-guaranteed transmute; the hero-sheet
tooltip still says "+6 to distribute" (live: +4, `app.ts:727` vs :1495); `bankGold`/
`bankTithe` are dead exports and `resolveDelveExit`'s 'safe' branch is app-dead with
*older drop-overflow semantics* — a future rewire would silently destroy gear where the
live path auto-sells (delete or align); `sanitizeAccount` doesn't clamp upgrade tiers
(tampered `quality: 999` → absurd market stock) and `rollRareStock` indexes `rareWeights`
by position not key; `bandFor` assumes `rarityBands` sorted ascending with no loader
validation. Otherwise the economy audit came back clean and **closed-loop**: gold can't go
negative/fractional, no sell-buyback or upgrade-refund dupe exists, the pity sawtooth and
boss inverse-CDF match spec exactly (statistically tested), satchel/loadout round-trips
have no dupe path, and progression numbers (cap 21, +5 HP, XP 110·L^1.7, tithe 12%) match
YAML. Note the workspace CLAUDE.md's "§B2 still open: real loot/gold/XP, flee parting
blow, death tithe" is entirely stale — all shipped.

---

## 5. Bugs — net seam & the daily

The seam's five workspace invariants all **verified in code**: contract.ts matches
openapi.json field-for-field (deltas are type-level only), the version gate opaque-compares
both tokens, run-capture forces `modded:false`/fingerprint/non-empty versions, the client
keeps seed/actions/instruments opaque, and no content ever ships from the backend. The
daily is genuinely deterministic end-to-end — two clients with the same descriptor produce
the identical fight; no `Math.random`/`Date.now` in the daily path. The defects are in
volume, distribution, and integrity:

### N1 — Unbounded outbox × 60 fps tick logs: quota exhaustion, silent record loss, save-loss knock-on (HIGH)

The convergence finding of the review (net, UI, product, tests, and ledger tracks all hit
it independently). Chain, every link verified: `recordRun` **always** queues locally
regardless of the enable/consent flag (`run-capture.ts:23-34`, by design); the rAF loop
dispatches `{type:'tick', dtMs}` every frame (`app.ts:3842`) and dispatch records every
action (:2444); endScreen ships the whole log (:3863) — **~350–450 KB of JSON per 2–3 min
fight** (dtMs is an unrounded float, ~40 chars/tick), one record *per delve room*; the
outbox has **no size/count cap** (`MAX_BATCH` caps only the flush batch) and prunes only
on server ACK; the default config is `enabled:false` with an empty URL, so a normal player
**never flushes**. localStorage's ~5 MB origin quota (often 2.5 M UTF-16 chars) fills in
roughly one or two evenings; `saveOutbox` then swallows `QuotaExceededError`
(`outbox.ts:114-120`) — and its comment "records stay in memory this session" is **false**
(enqueue is load→append→save; the record is simply lost). The origin quota is shared, so
roster/bank/career writes (all best-effort `catch{}`) start silently failing at the
margin — silent loss of hero progress with zero signal. Secondary cost: every enqueue and
`pendingCount` round-trips the multi-MB queue through JSON on the main thread. **Fix
batch:** cap the outbox (count/bytes, evict-oldest, surface a "queue full" state),
quantize/coalesce ticks at capture (round dtMs; replay stays deterministic if the engine
consumes the recorded values), consider not queueing when the Embassy has never been
enabled, and fix the lying comment.

### N2 — Daily RNG stream reuse: several foes can NEVER be a daily foe (MEDIUM)

Three fresh `mulberry32(seedInt)` instances share one seed: `deriveDailySetup` draws
dungeon (u1) then class (u2); `beginDaily`'s second instance reuses **the same u1** for
the foe roll; `startCombat`'s third replays u1,u2 into board-gen. Consequence with current
content (2 eligible dungeons): warren is chosen iff u1<0.5, so its foe roll is confined to
[0,50) — **goblin_shaman, goblin_archer, goblin_sapper, warren_rat can never be the daily
foe**; sewers (u1≥0.5) can never feature dire_rat, and plague_rat drops from 22% to 4%
conditional. The variant pick consumes u2 — the class draw — so a Pyromancer daily vs a
goblin is *always* the bloodthirsty variant. Deterministic and fair across clients
(everyone gets the same wrong distribution); the daily's variety is structurally broken
and some cells are unreachable forever. **Fix:** domain-separated sub-seeds
(`seedToInt(seed+':foe')`, `…':board'`) or thread one Rng through — and do it **before**
real version tokens ship, since it re-rolls historical dailies.

### N3 — flushOutbox has no recovery path: one wedged batch stalls sync permanently (MEDIUM)

`embassy.ts:118-139` — `peekBatch` takes the same first 100 records FIFO; any
deterministic non-2xx throws before any prune, both callers swallow it (`.catch(()=>{})`
:393; bare `.finally` :513), and the next flush re-sends the identical batch forever. No
bisection, no byte budget, no per-record quarantine, no user-visible error — and no
outbox-clear UI. Reachable triggers today: a **401 from a token rotated by `/recover` on
another device** (permanently stalls uploads, silently); behind any production reverse
proxy, a byte-size 413 (records are ~0.5 MB each, see N1; nginx defaults to 1 MB); a 422
from contract drift poisoning the whole batch. The server's own 413 is count-based and
can't fire under default configs. **Fix:** halve the batch on 413 / peek by cumulative
bytes; surface a "re-link this device" state on 401/403; report flush failures in the Hall
of Records.

### N4 — Non-daily records are not replayable despite "replay-ready" framing (LOW, documented debt)

`capture.ts:10` — {seed, actions} deterministically replays **only the daily**. Delve/
practice records omit hero stats/gear/entry-HP/consumables/dreadFloor, and the foe variant
was rolled from `systemRng` *upstream* of the recorded seed (`app.ts:1562, 1603`) with
only the bare creatureId recorded. Acknowledged as deferred in three places — but
`contract.ts:52`'s "replay-ready" and the workspace invariant overstate what the corpus
can do, **and E7 (selection not in the log) means even the daily's replay breaks the
moment a selection shields a transmute.** Thread the extended-session snapshot before any
anti-cheat work relies on this corpus.

**Net lows/infos:** hardcoded `consentVersion` never reads the /health-advertised one
(known); `IngestResponse.rejected` dereferenced unguarded though wire-optional (known;
`?? []` at the boundary); the Sync button's failure is an unhandled rejection with no user
feedback; **server- and user-controlled strings interpolated into innerHTML in the Embassy
scenes** (bests fields, handles — including server-echoed ones — and the serverUrl into an
attribute; self-XSS-grade today, real stored-XSS the day another player's handle renders —
see §6 U3); `setModded` has zero callers (the mod-gate can never trip until the runtime
mod loader wires it — add the tripwire now); `gen:embassy-types` points at an unvendored
openapi.json **and** `openapi-typescript` isn't even a devDependency — the codegen "set up
but not yet run" is actually *broken as committed*, so contract.ts has no drift guard at
all; no fetch timeout/AbortController in `request()`; daily preview shows the base
creature name while the fight shows the variant-prefixed one; the daily is infinitely
retryable by construction (attempts are marked `kind:'daily'`+date but no ordinal/policy
exists — a future board is best-of-grinds by default; decide and record the retry policy).

---

## 6. Bugs — UI

The UI architecture verdict up front: `router.ts` (97 lines) + the extracted pure modules
are disciplined and good; teardown hygiene is unusually strong (scene-scoped timers,
body-singleton sweep, modal `_cancel`, stale-closure `view === V` guards); the splash-skip
pure module is genuinely wired to the DOM path. The monolith itself grew to **4,465
lines** (39% of non-test src) despite the carve-out track — the extraction happened
(~830 tested lines: save/bank/delve-run/item-desc/splash/career/combat-log/dev) and new
features land extracted-first, but app.ts still grew net +1,262 lines.

### U1 — (= C1) The daily-win roster pollution — see §4 C1. (HIGH)

### U2 — Live delve is unpersisted module state: a reload destroys committed consumables (MEDIUM)

`app.ts:275, 1584-1586` — `beginDelve` debits the consumable loadout out of the persisted
vault immediately (`takeConsumablesByRef` + `saveBank`), but the run holding them
(`DELVE`, "a plain serialisable object" per its own comment) lives only in module memory.
An accidental refresh / PWA process kill mid-delve permanently deletes the committed
consumables plus all carried gold and found gear — no message, no recovery path. That's
the death penalty minus only the tithe, imposed silently by a lifecycle event — and this
game ships as a PWA where mobile process kills are routine. **Fix:** persist `DELVE` under
its own envelope key with restore-or-forfeit on boot (it was designed serializable —
serialization was anticipated and never wired); at minimum return committed consumables to
Storage when no live DELVE consumes them on next load.

### U3 — Server-controlled strings rendered as innerHTML (MEDIUM)

`app.ts:543-546, 613-637, 442, 432` — the `$` helper does no sanitization by contract;
Embassy responses (bests fields, daily date/detail/criteria, the handle — including the
server-echoed register/recover handle) and the **user-settable server URL** (self-host is
a supported flow) interpolate straight into it. A malicious/compromised server injects
arbitrary HTML into a client holding the bearer token in localStorage; no CSP in
index.html. Hero names have the same missing escape everywhere (self-XSS-grade,
`maxlength=18`). One `esc()` helper (or textContent assignment, as `playBreakdown` already
does) closes the whole class — do it **before** any surface renders another player's
handle.

### U4 — Async goScene races: a settled request yanks navigation (MEDIUM)

`app.ts:513, 482, 495` — Sync's `flushOutbox().finally(() => goScene(hallOfRecords))` and
doRegister/doRecover's `goScene(registryScene)` never check whether the user is still
there. Click Sync → navigate away → start the daily → the response settles →
`goScene` tears down the **live daily fight** and teleports to the Hall of Records
(recoverable — same seed — but a destroyed run). The codebase already has the right idiom
(`view === V` guards); these three sites skip it. **Fix:** capture a scene token and only
navigate if still connected, or re-render in place.

### U5 — Rule 6 is enforced by one untested line in the monolith (MEDIUM, cross-filed with §12)

`app.ts:2434` — `V.state.selected = V.selected` is the *only* thing making
selection-protected turnover hold in real play; the engine side is pure and well-tested,
but nothing tests this handoff, and deleting the line keeps all 370 tests green while the
shipped game regresses to "the card I clicked morphed". Same risk class: the U6 `wasKeys`
snapshot (:2437-2438) and the awardXP persistence glue (:2447). **Fix:** when dispatch is
extracted (the stated plan), extract it as pure `stepWithSelection(run, action, selected,
deps)` and add the end-to-end test (tick-driven hostile transmute skips a selected card's
set-mate).

**UI lows/infos:** single-fight consumables are never deducted from Storage — buy one
potion, drink it in every practice fight forever, while practice still awards persisted XP
(the "interim free-pick" comment predates the economy; commit-and-return like the delve,
or make practice consumable-free); foe-assembly failure paths (`begin`/`delveRoom` on a
bad content id) strand the player on a permanently blank screen — and `delveRoom` has
already consumed the room; the **Data Wipe button ships un-gated** on character select
("a testing affordance" one mis-tap+confirm from total loss — gate on `isDev()` like
grantTestGear already is); `openLevelUp`'s document keydown listener leaks when the router
sweeps `#levelup` (generalize `_cancel?.()` to every BODY_SINGLETON); the `DAILY` flag
survives the return to town — safe today only because every combat entry point clears it
(fold into the same hub-entry resets as `DELVE`); Market's default tab hardcodes the YAML
group label 'Weapons' — a modder renaming `marketGroups[0]` opens the Market on a phantom
"Sold out" tab (default to `marketStock()[0]?.label`); `bank.ts:55`'s over-cap trim is a
no-op expression;
duplicate `MANA_NAMES`/`MANA_NAME`/`MANA` constants.

---

## 7. Hard-rule invariant audit

All six CLAUDE.md hard rules were audited against the code as built. Board mutation is
fully enumerable — four write sites, all funneling refills through `patch`/`patchFavor`.

1. **No duplicates — HOLDS.** Enforced in `distinctRandomBoard` + `patchOnce`
   (present-keys ∪ seen); wounds/transmutes only write null; grep-verified every
   `board[i] =` assignment.
2. **FLOOR — HOLDS on settled boards.** Every refill asserts it; locks and wounds are
   floor-aware; `floorCanary` makes silent fallbacks observable (dev). The transient-dip
   reading during pending gaps is *de facto* accepted (the fuzz test codifies it) but
   written down nowhere, the fuzz assertion is skipped whenever any pending exists (wound
   pendings persist across rounds — coverage is weaker than it looks), and `gap` is
   unbounded in the modder-facing schema (old I2, still open). One rare confirmed corner:
   limbless can lock all three matched slots and dead-board up to 5 s (dev-canary only).
3. **Pinned axes — HOLDS.** `randCard` writes only active axes; no bias vocabulary can
   reach axis 2; fuzz-asserted every step.
4. **Pure generator / spec→spec — HOLDS** with the designed gray zone: abilities/traps
   pass `FavorBias` draw-weights into `patchFavor` (the bias-objective channel), but
   `patchOnce` enforces floor/distinct/pin regardless, and the invariant tests stress it
   at the shipped BIAS_W=8. No difficulty bypass exists.
5. **Aggregate control — HOLDS.** Favoured-rate gate >0.55 under 8× bias in tests;
   positional effects exist only in the authored threat vocabulary.
6. **Selection-protected turnover — BUILT and correctly scoped for all sourced
   transmutes** (churn/drift/trap/trick; player casts exempt; "no legal target → skip"
   holds and can never break the floor). Four edges found: wound shatters and locks bypass
   the shield (rationale applies even if the letter doesn't — see §3 lows); `liveBurn`
   double-charges into it (E5); the matched trio is unshielded because the UI clears
   selection pre-dispatch (E6); and the shield's dependence on unrecorded selection breaks
   replay (E7). The **lock-layer makeable floor** has the strongest test in the repo
   (`floor-stress.test.ts`, 600 seeds × both orderings — the second ordering is exactly
   the historical ~13%-violation case, and the fix history is documented inline at
   `triggers.ts:321-326`).

**RNG discipline is clean.** No `Math.random` reaches any seeded engine path (all uses:
cosmetic jitter, ID generation, out-of-combat systemRng economy). The daily is
deterministic end-to-end; `dtMs` rides in the tick action so timing-dependent draws
replay. The replay break is selection (E7), not time. Two recorded infos: the daily's two
same-seed streams are perfectly correlated (N2 is the player-facing consequence;
decorrelate before anyone builds statistics on daily boards), and `belowFloorCount` is
invisible in production (dev-only warn — surface it in the dev instruments or the record's
tallies).

---

## 8. Architecture

### What is genuinely good (keep doing these)

- **The reducer seam is real and proven.** Single mutation path, non-mutating clone,
  events out, injected RNG and time; `seam.test.ts` proves `{seed, actions}` replays to an
  identical state *and event stream*. The multiplayer/anti-cheat claim is backed by an
  executable proof (modulo E4/E7's holes — which is exactly why the proof matters).
- **The purity discipline paid off everywhere it was applied**: net/ is the best-factored
  subsystem in the repo (12 pure decision modules + ~40 lines of actual I/O, every
  decision tested); the UI extraction pattern (splash/career/combat-log/delve-run) landed
  extracted-first; the fuzz harness drives the *whole* reducer against the hard
  invariants.
- **E1-class bugs are structurally prevented now** — every clock verb is relative with
  explicit floors/caps and a rationale comment. The old worst-bug family can't recur by
  construction.
- **Inline invariant archaeology**: constants and fixes cite their design decisions,
  dates, and the tests that caught prior bugs (`triggers.ts:321-326`, the `state.ts`
  constants block, ledger IDs in comments — E7 at `consumables.ts:200`, U6 at
  `app.ts:2435`, I4 at `generate.ts:130`). Review-to-code traceability at this level is
  rare and worth protecting.
- **The below-floor canary pattern** (never-hang fallbacks made observable without
  behavior change) deserves reuse; **idempotency done right end-to-end** in the outbox
  (client-minted eventId, replace-by-id, prune-on-ACK — lost acks converge on retry); the
  **terminal-vs-retryable protocol** is a genuinely good forward-compat posture; storage
  envelopes + migration tables are uniform across roster/bank/account/outbox.
- **The banner convention in docs works** (where it was applied — see §10), and
  **vitest sharing the vite YAML pipeline** means tests exercise the identical content
  that ships — no fixture drift by construction.

### Debt (the honest list)

- **`ui/app.ts` at 4,465 lines** is the single untested module and the growth trend is
  wrong (+1,262 since June 16 despite real extraction). The load-bearing economy glue is
  now covered, so this downgraded from "no safety net on the economy" to "the
  rendering/choreography layer is untestable debt" — but three hard-rule handoffs live in
  it untested (§6 U5). Next natural cuts, per the file's own banners: the Embassy scenes,
  smith, the rollover choreography's event→BPart[] builder (pure data — trivially
  testable), and `interpretChunk`'s classification.
- **A1 lives on**: engine events still carry rendered English+emoji strings
  (`events.ts:43-48`, `triggers.ts:277`, `combat.ts:169/295/333`). The server-authority
  direction makes this *more* relevant — migrate to `{id, params}` and let
  `combat-log.ts` (which already owns pure formatters) do the wording.
- **CombatState still isn't serializable** (Maps; shared foe/gen refs — verified nothing
  mutates them post-create, but it's the one fragility in the clone contract); no mid-run
  save exists, which is also U2's root cause.
- **Legacy-scale shims** are centralized and flagged (`LEGACY_DMG_SCALE` 10/3 at
  `triggers.ts:21`, the ethereal rebase at `ops.ts:115`) — honest, single-site debt
  awaiting the data rebase.
- `session.ts:41` still hardcodes `COMBAT_GEN`; the gen spec isn't in `SessionSetup` —
  this bites the moment the daily or dungeons vary generation.
- `DREAD_DEPTH_CAP` is enforced only by the UI's band table, not the engine.
- sw.js: cache name never rotates, old hashed bundles accumulate forever, and the
  `type==='basic'` filter means Google Fonts never cache — typography breaks offline.
  Self-host the two fonts.

---

## 9. Data pipeline, CI & tooling

The YAML pipeline verdict: **architecturally sound, invariants hold.** Zero runtime deps
(no `dependencies` key; ajv verified absent from a fresh production bundle); build-time
YAML→JS via a devDep plugin; schemas generated from the TS types with **zero regeneration
drift at HEAD** (re-ran the generator; committed schemas current); a clean two-layer split
(zero-dep runtime link-checker that throws at module init on dangling refs; heavy ajv
validation confined to tests by the import graph, not just convention). The Twelve Gates
content spot-checks clean: monotone difficulty, statlines on the parity line, every
cross-reference linking, genuinely differentiated dungeon identities. The affix magnitude
DSL is a tidy closed vocabulary that fully replaced closures — a credible dry run for the
Phase-3 effect-DSL.

### D1 — No test/typecheck/content gate in the ship pipeline (MEDIUM, the process headline)

`.github/workflows/deploy.yml` publishes to Pages on **every master push** running only
`pnpm install` + `pnpm build`. Vite doesn't typecheck; YAML enters as `unknown`+cast, so
tsc wouldn't catch content anyway; all validation is vitest-only. Consequences, both
end-to-end real: a dangling cross-reference **white-screens prod at boot** (buildRegistry
throws at module init; the build itself passes); a shape/vocabulary error ships silently
and degrades at runtime (unknown effect → `runEffect`'s `default: return null` — the exact
silent-no-op class the blast/cross/plus fix eliminated). Both MODDING.md §0 and
`validate.ts:7-8` describe a "build prebuild gate" that **was never wired**
(`"build": "vite build"`, no prebuild hook). And the repo's own working style permits
unattended direct pushes to master. The suite is 3.5 s — there is no excuse-cost. **Fix:**
`pnpm typecheck && pnpm test` in deploy.yml before build (or a prebuild hook).

### D2 — Daily determinism silently depends on YAML key order, with no pin (MEDIUM)

`app.ts:567-573` — `dailyCandidates()` is `Object.keys(GAMEDATA.dungeons).filter(…)` +
`CLASSES.map(…)`; `deriveDailySetup` indexes into these by seeded RNG, and
`daily-select.ts` *documents* the order as load-bearing ("a reordering changes every
daily — treat the order as part of the ruleset"). Nothing enforces it: **pure reorderings
pass all 370 tests** (the content snapshot is key-order-insensitive; no test pins the
candidate lists; `dailyCandidates` lives in the untested monolith), and the version-token
guard that should catch it is inert — both sides ship `0.0.0-dev`, so version equality
passes across any content change. A mid-cycle content push splits players on the same
seed into different fights, silently. **Fix:** extract `dailyCandidates` into a pure
module and pin its exact ordered output with a snapshot test; longer-term this is the
"real version tokens" item (content-hash the registry at build time).

**Pipeline lows/infos:** `Selector.center` is a dead schema field (autocompleted into a
silent no-op — the exact class the blast/cross/plus removal fixed; delete it);
`Dungeon.extends` is declared, link-checked, documented — and never applied (rename or
implement); consumable refIds in economy/progression YAML (`starterStash`,
`starterConsumables`) have no referential check — a typo silently strips starter potions
(one small test closes it); Selector `mode` collapses everything but `not_value` to
equality — schema-legal `all_different`/`contains` silently mean "equals" (narrow the
union); `Effect.max` is an undocumented legacy random-damage fallback; MODDING.md §0's
"validation runs at registry-build time" is stale text from a superseded plan.

**Tooling:** `gen:embassy-types` is broken as committed (§5); **no coverage provider is
installed** (`--coverage` can't run; the untested boundary is invisible without tooling);
no lint/format scripts; `gen:schema` is manual but drift-guarded by the
regenerate-in-test pattern — the right template, and the openapi/contract.ts guard is
exactly the missing application of it. The sims both run (<1 s each, deterministic) and
their ~15 hand-copied constants **currently match the engine exactly** — but nothing
guards the equality, `balance-sim.mjs`'s header still says the constants "don't exist in
code yet" (the port happened), and `progression-sim.mjs` deliberately models the
*pre*-rebalance rules with nothing labeling it superseded — re-running it reproduces
retired numbers. One retune away from fiction; add the constants-equality test or import
them.

---

## 10. Docs vs reality

~40 constants sampled against code; **~35 match exactly.** The drift concentrates in three
load-bearing docs that missed the 2026-06-17 rebalance and 2026-06-29 daily cycles.

### The worst offender: set-core/CLAUDE.md (HIGH — it actively misinstructs sessions)

Frozen at ~06-12/06-17. A session orienting from it is told: invariant 6 is "build
pending" (**built 06-14**: `protectedSlots` + protection.test.ts); "⭐ NEXT COMBAT BUILD:
ROUNDS v3" (**shipped 06-11**, revised twice since); B2 "still open: real loot/gold/XP,
flee parting blow, death tithe" (**all shipped 06-13/16**); "**Don't run the real balance
sim yet — it's gated**" (**it ran 06-17 and its rebalance is live** — BALANCE.md §9
all-ported, verified line-for-line). The doc map omits BALANCE.md entirely and describes
`src/` as core/data/engine/ui — **omitting `src/net/`**, the entire 20-file Embassy layer
(partially mitigated: the workspace CLAUDE.md covers the seam). No corrective pointer
exists anywhere — BALANCE.md's own header re-quotes the stale gate. **Rewrite the
"Immediate open threads" and working-style-gates sections against HEAD; add BALANCE.md and
src/net to the maps.** Also correct: the "100k+ clears/config" validation claim — the
in-repo gate is 25 clears × 240 configs (~6.2k board checks) + reducer fuzz; the 100k
figure is the archived prototype harness.

### TUNING.md — top banners accurate, body rows contradict them (MEDIUM ×3)

The file's own §-banners record the rebalance correctly; ~10 rows still marked ✅ LIVE
carry pre-rebalance values. Confirmed mismatches, every one found: **BOARD_WARD_COST — doc
1, code 2** (the one silent live-constant lie; also in CRAWL §5.6; a balancer sizing
Stand Ground concludes 15 wards where the engine gives 7); foe HP row "60/110/200" vs the
shipped ~100/250/400 re-anchor (the banner 100 lines up has it right — same file, three
answers); "+3/+2/+1, +6/level, +120 arc" vs `LU_POINTS=4` free-alloc (twice); LOOTTIER_K
"0.02" vs 0.12 (6× off on the gear-power growth axis); boss loot "30/40/30" vs
30/40/20/+10 spellbook; lootTier "foe L + dungeon L" vs `foeLevelEquiv + round(depth×0.34)`;
the retired EXCHANGE_BEATS table + "never a modal" (the popover is canon); dread constant
names drifted (values match). **Status labels wrong:** dread "PLANNED" (built 06-14), gear
"DISABLED" + pity "inert" (both live), foe-level-equiv/outlevel-XP "PLANNED" (both built
and load-bearing), the room-loot row cites `rollDelveLoot` (deleted 06-16), the D1–D5
ladder row (superseded by the shipped 14-dungeon 0–10 ladder). The header's "verified
2026-06-11" is honest about its age — re-verify the whole file against src/.

### The rest of the drift table

| Doc | Verdict |
|---|---|
| TODO.md | Mostly honest; **the Daily Dispatch item is `[ ]` but shipped at HEAD** (a57cc32 — tick it; the sibling "real versions + vendor openapi.json" is genuinely open). All spot-checked `[x]` claims true. |
| BALANCE.md | **Accurate — the model doc.** §9 port checklist verified line-for-line. One footnote: only the 3 pure nukes were repriced to VPM≈4; the §5.1 hybrid rows (Thorn Vines/Cold Blade/Riposte/Heal) keep old values — BALANCE's footer is honest, TUNING's "PORTED ✅" banner overstates. |
| CRAWL-DESIGN.md | Good banners; three gaps: §3 Leveling ("settled + BUILT") still specifies +6/level (+120 arc, splits that sum to 6 — unreachable with 4 points; the §3 gear-vs-levels banner records the temper but frames it as unbuilt); §5.5's banner still says v3 is "next" while the body carries retired mechanics unannotated (overcap block→charges, base 2/2/2, speed bands); §5.6 body elite/boss ×1.5/×2.0 vs the banner's 1.7/2.4. |
| TRAPS.md | One live lie: **§7.2 presents the retired speed-band cadence table as "(live — src/data/game-data.ts)"** — bands were retired by v3 (tempo derives from S−P); an author following TRAPS' own "source of truth for the vocabulary" charter specs cadence that nothing implements. Related dead code: `SpeedBand`/`Speed` exports, zero consumers. |
| docs/ (modder wiki) | **yaml-tuning.md's loot section documents fields that don't exist** (`marketTier`, `rarityWeights` + a copy-paste example) and omits the real dials (`rarityBands`, `depthTierRate`) — the wiki was written the same day the loot rework landed and never reconciled; a modder following the example gets ajv rejection (or, skipping tests, a runtime TypeError on `rarityBands`). Also "base 2/2/2" stale in yaml-catalogs.md + schema.ts comments (live: 10/10/10). Everything else sampled (classes/gear/affix DSL/economy/progression/delve tables) verified accurate. |
| GAME-DESIGN / PROJECT / THEORYCRAFT / UX / MODDING / DESIGN-GOALS / WRAPPERS / README | Clean — accurate status/supersession banners throughout. README's repo tree omits net/, sim/, docs/, BALANCE.md (low). |
| Workspace CLAUDE.md | Seam facts verified accurate (tokens, daily gate, codegen-unrun) — but its §B2 "still open" list is stale (§4) and the "replay-ready" invariant overstates (N4/E7). |

The meta-lesson repeats from last time with a sharper edge: **the banner convention is the
mitigation that works**, and every failure above is a doc that skipped it for one cycle.
TUNING.md may want its own regenerate-or-verify ritual the way schema.json got one.

---

## 11. Game design & product

### The loop as built (first-15-minutes walk)

Genuinely complete and well-crafted: creator auto-opens on an empty roster; briefing →
Engage → Speed-scaled grace means the clock never bites an unread board; the exit ladder
shipped exactly as designed (boss > cash-out > flee-with-parting-blow > death-with-tithe)
and the fork UI makes the dread math legible; loot triage auto-sells overflow ("nothing
silently lost"); death is legible and priced; every run banks something (XP always, gold
on safe exit). Session shape: a median clear ≈ 12–25 min with cash-out making any length
valid — on the DESIGN-GOALS target. The career-paced cinematics (`ui/career.ts`
compressing dwell from novice→veteran over lifetime rounds) are a quietly excellent
retention-aware touch.

The friction is all at the front door:

- **P1 — The first-60-seconds funnel doesn't exist (MEDIUM, the make-or-break).**
  DESIGN-GOALS names "make the Set rule click in the first 60 seconds" as one of two
  things commercial fate hinges on. A fresh boot lands on the 10-tile town with no
  first-run branch; the only rule text is a character-select footnote; the path to the
  (built, good) guided tutorial is town → Barracks → create → back → Training Ground →
  Engage — four scenes, six undirected clicks, every one optional. "Tutorial seen" isn't
  persisted. The coaching machinery is all there; the funnel *into* it is absent. **Fix:**
  fresh-save fast path — no roster → name+class → auto-launch guided tutorial → land in
  town with a "▶ next: Goblin Warren" cue.
- **P2 — Class kits exhaust at L3 (MEDIUM, the biggest retention hole).** Every class
  authors exactly 3 abilities + 1 passive; the cadence unlocks active slots at L3/6/10/14
  and passive slots at L8/16 — so from L3 the kit is complete, **both** passive unlocks
  open into nothing, and 18 of 21 levels (~55 of ~56 clears to cap) grant stats only.
  `gearAbilities()` exists with zero callers. Principle #7 (build variety via unlocks) has
  no delivery vehicle past the first hour. Known deferred (TODO Phase 5+), but it's pure
  YAML+abilities.ts content and the machinery already exists — author ~6/3 per class ahead
  of the full spellbook system.
- **P3 — No level guidance on the Twelve Gates (LOW).** One flat dropdown, "Difficulty N"
  the only signal; an L1 can walk into the D10 capstone; under-leveling has no warning
  (over-leveling is handled via the XP penalty). Show "for level ~N", warn at 3+ below.

### The daily & the watch-list

The daily's determinism discipline is professional-grade (documented draw-order,
no-draw-consumed authored axes, preview/fight mirror, ephemeral hero) — and then the
product layer around it undercuts it:

- **P4 — The daily promises a leaderboard that does not exist (MEDIUM).** The UI says
  "Your result uploads to the board when you sync" / "put your name on the board"; the
  entire wire surface is per-player bests, cross-player boards are explicitly phase-2. As
  shipped, the day-2 loop is play → upload → *nothing comes back*. Soften the copy now; a
  minimal `/daily/board` + results panel is the real fix. Unlimited same-seed retries are
  permitted and no attempt ordinal exists, so a future board is best-of-grinds by default
  — decide the retry policy and record it in the SERVICE docs.
- **P5 — "Fastest clear" is pause-cheesable and the record can't see it (MEDIUM).**
  `realTimeMs = state.now` (engine time); the uncapped spacebar pause freezes ticks, so
  paused planning leaves **zero trace in the {seed, actions} log** — phase-2 replay
  verification cannot catch it, and no wall-clock is captured anywhere. The server scores
  fastest-clear one day in three. **Fix now (cheap, retroactive-only-if-added-now):**
  capture wall-clock elapsed + pause count/duration into `instruments`; when the board
  lands, cap/disable pause in daily mode or score on wall-clock.
- **P6 — Dev mode is a shipping cheat whose runs upload as unmodded (MEDIUM).** The
  always-present corner toggle exposes "grant test gear → Storage" (mints real orange-tier
  gear into the shared account); `recordRun` gates only on `modded`, which nothing ever
  sets (`setModded` has zero callers). Dev-cheated delve/practice runs pollute the balance
  corpus and personal bests indistinguishably. The daily itself is insulated (ephemeral
  hero, no Storage). **Fix:** emit `instruments.devMode` (open object, no schema bump)
  and/or gate the grant out of production builds.
- **P7 — The version pins the daily's fairness rests on are vacuous (LOW today, HIGH at
  deploy).** Both tokens are hand-kept `0.0.0-dev`; the pin mechanism works and no content
  has changed since the tokens were introduced (verified via git), so nothing has *yet*
  split — but `dailyCandidates()` derives from live registry order (D2), so the first
  forgotten bump after a real deploy silently splits "the same daily" into incomparable
  boards. Wire `CLIENT_CONTENT_VERSION` to a build-time hash of the YAML registry (a Vite
  define suffices) before any public daily.
- Watch-list status: **daily seed — half shipped** (above); **big-chain achievements** —
  `combo.fightPeak` is computed and *still* neither persisted nor captured — a two-line
  add to `instruments` whose value is retroactive-only if added now, missed at exactly the
  moment the daily shipped; **relaxed/no-timer** — not built (spacebar pause is the seed;
  parked at the external-playtest gate, correctly — but note the gate items are what's
  keeping external players at zero); **clock-on-first-action** — substantially satisfied
  structurally (paused until Engage, grace hitstop); **graceful miss-degradation** —
  *resolved by architecture* (Rounds v3 has no per-set timer to miss; an invalid pick is a
  no-op; a slow round just banks less). New cheap hook-ins: wall-clock/pause telemetry
  (doubles as P5's fix), `careerRounds` as a progressive-disclosure/relaxed-default
  signal, and the daily code comment already pointing at hero-level scaling for D>1
  dailies.
- Out of the box the daily is unreachable for everyone (`DEFAULT_OFFICIAL_URL = ''`,
  enabled:false, no deployed service) — correct for the local-dev stage, but deploying the
  Embassy and baking the URL **is part of shipping the daily**, not ops trivia.

### The two standing pre-public blockers (third review in a row)

- **Colorblind (HIGH).** Unchanged: `CARD_HEX` is still `#f0565b/#46c46a/#5b94f5` — the
  classic deutan/protan confusion pair — and `cardSVG` encodes the color trait as hue
  *only* (shape and count get glyphs). One of three match axes is imperceptible to ~5% of
  the audience; there is no settings surface at all, and no relaxed/round-length option
  either. The fix is localized to `cardSVG` (per-color fill style: solid/outline/hatched,
  or a corner pip) + a CVD-safer triad. Move it from the town-buildout checklist to the
  daily/leaderboard go-public checklist — the Embassy track points at external players
  sooner than the town assumption did.
- **The rename (LOW severity, rising urgency).** `set.core` is now the page title, PWA
  manifest name, every scene h1, the Pages deploy, and the product identity Embassy
  handles register against. Each new surface raises the eventual cost; the Embassy/daily
  push is exactly the "public push" the flag was gated on. Pick the name, centralize the
  display string, keep "SET-like" as descriptive copy only. (The mechanics/trade-dress
  analysis from the June review stands unchanged: the exposure is purely the public name.)

### Retention shape & content

What exists for day-2: the level curve, the gear chase (loot flip + pity + marquee +
smith/enchant sinks), Merchant/Vault tracks, the daily (gated on an undeployed server).
What's missing: any social comparison, achievements (settled, unbuilt), kit growth past L3
(P2), the Heat dial (settled, unbuilt — the skilled-player ceiling), injuries. Content
volume: dungeons/foes are strong and genuinely differentiated (the right kind of volume);
abilities are thin (27 actives + 9 passives across 9 classes) — breadth-without-depth is
DESIGN-GOALS' own named red flag and is currently true. Art identity (the stated
marketable hook) had no movement — everything remains emoji/CSS placeholder.

### Highest-leverage next build — argued

**The fresh-save funnel (P1), bundled with the daily-integrity batch (N1 outbox cap +
tick coalescing, P5 wall-clock/pause capture, P7 version hash, P6 dev flag) as its
prerequisite.** (1) First-60-seconds comprehension is one of the two things DESIGN-GOALS
says fate hinges on, it is the weakest shipped surface, and every future channel — PWA
demo funnel, streamer clips, Show HN — converts through it; its leverage multiplies
everything else. (2) It is cheap: the coaching primitives, guided script, and teaching
dungeons all exist — this is routing plus a persisted flag; days, not weeks. (3) The rival
candidate (daily leaderboard) is *not actually ready to be public*: pause-cheesable
scores on vacuous version pins over an undeployed Embassy would be a cheatable board on an
unfair substrate — the integrity batch must land first regardless, and it is small enough
to ride along. (4) Class-kit content matters at hour 5+; onboarding matters at minute 1,
and external players are currently zero precisely because the playtest-gate items
(onboarding, colorblind) are unmet. Sequence: **funnel + integrity batch → colorblind +
relaxed mode (unblocks external playtest) → class-kit expansion → daily leaderboard on the
now-trustworthy corpus.**

---

## 12. Tests & performance

### The suite (what's genuinely strong)

370 tests / 43 files in ~3.5 s wall; consistently **behavior-first**, almost no
implementation mirroring. Standouts: `seam.test.ts` (the architectural crown jewel —
replay-determinism and clone semantics, an executable proof of the anti-cheat premise);
`engine.fuzz.test.ts` (18 sessions × 220 steps of seeded random play across
trap/lock/drift-heavy foes, asserting dup/pin/lock-aware-floor **every step**);
`generate.invariants.test.ts` (240-config dial sweep + weighted-bias stress + the I4
canary); `floor-stress.test.ts` (both orderings, explicitly calling out the historically
exposed one); garbage-hardened parsers everywhere (migrations, corrupt numerics,
never-throws); statistical assertions used correctly (inverse-CDF distribution, sawtooth
rate, null-not-zero ratio honesty in capture). The invariant tests encode the design
rules *by number* — the suite doubles as an executable index of the invariants. Round
grammar coverage is excellent (kill-race, tempo exactness, no-carry, overtime
hold/stack/lapse, extend-cap + uncapped bypass, flee matrix, replay no-op).

### The gaps

- **The untested boundary is exactly the three glue files that carry invariants**:
  `app.ts` (4,465 LOC — rule 6's handoff, the U6 snapshot, awardXP persistence — §6 U5),
  `net/embassy.ts` (`flushOutbox`'s gating/accounting — N3's home), and
  `net/run-capture.ts` (`recordRun` — the enforcement point of seam invariant 3,
  referenced by zero tests). All are pure-enough to test with stubbed fetch/localStorage;
  every sibling module already has exactly that style of test.
- **No coverage provider installed** — the boundary above is invisible without tooling.
- **CI runs nothing** (D1). The schema drift-guard, the whole suite, and typecheck all
  bite only when someone runs them locally.
- **The sims are one retune from fiction** (hand-copied constants, no drift guard, stale
  headers — §9); `progression-sim` reproduces retired numbers by design with no label.
- T4 partially open: geometry selectors beyond `row` (corners/border/diagonal/half/
  inner) have no direct unit tests; the fuzz exercises only shipped-trap shapes.
- The fuzz floor assertion is skipped whenever any pending exists (§7 rule 2) — tolerate
  only timed pendings instead.

### Performance

No CPU hazards: the per-tick clone is microseconds at 15 slots; findSets is C(15,3)=455;
board re-render is signature-gated; localStorage writes are event-driven, not per-frame.
Two watch items: `updateBar` runs twice per frame with ~30 unconditional DOM writes + two
`querySelectorAll` sweeps (bounded; diff-guard if the HUD grows), and **the real issue is
data volume, not CPU** — the tick log (N1) is the per-frame cost that matters, serialized
per fight into storage and the wire.

---

## 13. Context for future sessions

Durable facts surfaced in this review that aren't (yet) in any doc:

- **Review methodology note:** every high/medium finding in §§3–6 was independently
  re-verified by an adversarial agent with file:line evidence at HEAD `a57cc32`; one
  finding was refuted in the process (§3, the pending-gap dead-board claim — the match-path
  refill guards it). Severity labels reflect the *corrected* post-verification assessment.
- **The convergence cluster:** N1 (tick log × uncapped outbox), E7 (selection not in the
  log), N2 (RNG stream reuse), N4 (non-daily replay), P5 (pause invisibility), P6
  (dev-mode uploads), P7/D2 (vacuous version pins over order-dependent candidates) are all
  facets of one theme — **the record/corpus layer shipped its write path before its
  integrity path.** Fix them as a batch; each gets cheaper before public data exists and
  harder after.
- **Actual content volume:** 14 dungeons (12 gates + tutorial/training, difficulty 0–10),
  ~80 foes across genuinely shared families, 9 classes × (3 actives + 1 passive), 27
  actives + 9 passives total, 24 affixes (19 live, 5 staged — the roller only mints
  `live && make`), ~20 consumables. Daily-eligible pool today: 2 dungeons × 9 classes
  (difficulty ≤ 1) — and N2 makes several of even those foes unreachable.
- **Settled-in-code, recorded here:** practice/delve foe *variants* roll from `systemRng`
  (only the daily's foe is seed-derived); the daily hero is standardized level-1
  (`makeChar`, starter consumables, no gear, full HP); `RunMode 'practice'` folds to wire
  kind `'delve'` disambiguated by `instruments.mode`; recovery (`applyRecovery`) doesn't
  restore `consent` (harmless today); market/rare vendor stocks are module-state,
  deliberately unpersisted; `loadBank()` seeds the starter stash on first read
  (side-effectful loader, idempotent).
- **Live tuning constants** (code is source of truth; TUNING.md is stale in spots — §10):
  ROUND_MS 20 s, CHARGE_CAP 15, BOARD_WARD_COST **2**/WOUND 3, MANA_CAP 15, player HP 100
  (+5/level, cap 21, LU_POINTS **4** ≤3/stat), foe HP anchors ~100/250/400, TIER_BUDGET
  1/1.7/2.4, LOOTTIER_K **0.12**, GOLD_K 0.12, tithe 0.12, XP 110·L^1.7,
  COMBAT_GEN = n15/active[0,1,3]/camo1/escape6/**floor1**, BIAS_W 8, dread RISE 0.5 /
  onset 7 / bleed 6%, COMBO_OVERTIME_CAP_MS **0** (uncapped — see E2), DAILY_MAX_DIFFICULTY 1.
- **The test suite ≠ the prototype's soak claims**: the in-repo conformance gate is ~6.2k
  seeded board checks + reducer fuzz per run; the "100k+ clears" figure in CLAUDE.md is
  the archived prototype harness.
- **Known-unwired surfaces:** `setModded` (no callers), `handleAvailable` (unused),
  `daily(date)` param (no caller), `gearAbilities()` (zero callers — the P2 hook),
  `combo.fightPeak` (computed, never captured/persisted), `Dungeon.extends` (link-checked,
  never applied), `bankGold`/`bankTithe` (dead), `resolveDelveExit` 'safe' branch
  (app-dead, stale semantics).
- **Candidate degenerate lines to playtest first:** the OVERTIME infinite hold (E2) is the
  new №1, replacing the old clock-pinning list (that whole family died with the clock
  model); the enchant-transfer crafting line (C2); Maneuver-with-held-selection prime
  farming (E5); pause-planning on daily criteria (P5).

---

## 14. Prioritized action list

**Now — correctness (small, high-payoff):**
1. E1 — win check after the rollover proc blocks (the zombie foe). One guard, one test.
2. C1/U1 — `if (!DAILY)` in `awardXP` (phantom-hero roster pollution) + the save-level test.
3. D1 — `pnpm typecheck && pnpm test` in deploy.yml. Three lines, closes the biggest
   process hole in the repo.
4. E4 — the `[i,i,i]` distinctness guard in `completeSet`. One line at the anti-cheat seam.
5. U3 — the `esc()` helper at the Embassy/name interpolation sites (before any foreign
   handle ever renders).
6. Doc triage: rewrite CLAUDE.md's open-threads/gates sections against HEAD (it actively
   misinstructs — §10); tick TODO's daily item; fix TUNING's ward-cost/foe-HP/+4/
   LOOTTIER_K rows and status labels.

**The daily-integrity batch (before the Embassy leaves localhost — fix as one unit, §13):**
7. N1 — outbox cap + tick quantization/coalescing (+ fix the lying quota comment).
8. P5 — capture wall-clock + pause count into `instruments` (retroactive-only if added now).
9. P7/D2 — content-hash version tokens (build-time Vite define) + pin `dailyCandidates()`
   order with a snapshot test (extract it pure first).
10. N2 — domain-separated daily sub-seeds (re-rolls historical dailies — do it while they
    don't exist).
11. P6 — `instruments.devMode` flag (or gate grant-gear out of prod).
12. E7 — selection into the action log (`setSelection` action); N3 — 413/401 handling +
    surfaced flush errors. P4 — soften the "board" copy until a board exists.

**Engine/design debt (next combat pass):**
13. E2 — cap or dread-integrate COMBO OVERTIME (the anti-stall hole).
14. E3 — soak on `instant_attack` (or document the exemption); E5 — shield-aware
    `liveBurn`; E6 — match-trigger ordering vs the matched trio; the primed-mark cleanup.
15. C2 — flag the enchant-transfer exploit in BALANCE.md for the gated sim pass; C3 —
    settle `drain_mana` spread-vs-color (the D6 identity depends on it).
16. U2 — persist `DELVE` (restore-or-forfeit); U4 — scene-token guards on the three async
    goScene sites; gate the Data Wipe button.

**Product (the argued sequence, §11):**
17. P1 — the fresh-save funnel (boot → create → guided tutorial → first delve, persisted
    tutorial-seen). Highest-leverage build in the repo.
18. Colorblind redundant encoding + CVD triad (+ relaxed/round-length option in the same
    settings pass) — the external-playtest unblock, third review running.
19. P2 — class-kit content expansion (~6/3 per class; the machinery exists).
20. The rename — before the Embassy goes beyond localhost.
21. Daily leaderboard (server `/daily/board` + results panel + retry policy) — only after
    7–12 make the corpus trustworthy.

**Hygiene (ride-alongs):**
22. U5/tests — extract dispatch as a pure `stepWithSelection` + the rule-6 end-to-end
    test; test `flushOutbox`/`recordRun`; add the coverage provider; sim-constants drift
    guard; vendor openapi.json + actually wire `gen:embassy-types` (add the missing dep).
23. sw.js cache rotation + self-hosted fonts; A1 event `{id, params}` migration when
    combat-log next gets touched; delete the dead surfaces (§13); schema tightenings
    (`gap` maximum, `Selector.center`, mode union, starter-consumable link test).
