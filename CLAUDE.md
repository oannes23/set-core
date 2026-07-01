# CLAUDE.md — guidance for Claude Code sessions on SET.core

Read `PROJECT.md` first — it is the full design context and the source of truth
for *why* the generation/tuning math is the way it is. This file is the fast
orientation. (Last reconciled against HEAD 2026-07-01, alongside the FABLE.md
re-review — trust that pass over anything older.)

**Design-doc map** (read in this order for the *game* on top of the core):
- `PROJECT.md` — the Set core + generation/tuning math (why the levers exist).
- `GAME-DESIGN.md` — the real game: locked f=3 / N=15 **5×3** board, trigger bus,
  transmute verb. Wins over the prototype defaults where they conflict.
- `CRAWL-DESIGN.md` — **set.crawl**, the data-driven dungeon-crawler: run loop,
  entity architecture, combat resolution, stances, gear taxonomy. §5.5 is the
  pre-v3 historical baseline; §5.6+ banners mark what shipped.
- `TRAPS.md` — the reactive **threat layer**: trap vocabulary, the board verbs
  (destroy / transmute / lock / + conditions), dungeon·elite·boss attachment, foe
  composition (creature ⊕ variant ⊕ template), enemy-transmute tuning.
  (⚠ §7.2's speed-band cadence table is RETIRED — foes derive tempo from S−P.)
- `TUNING.md` — the **live-constants reference** (code is source of truth). ⚠ Its
  top banners are accurate but ~10 body rows still carry pre-2026-06-17-rebalance
  values (`FABLE.md` §10 lists every mismatch) — verify against code before citing.
- `BALANCE.md` — **the combat-economy model doc**: the unified verb↔stat↔defense
  model, the sim-settled decisions (§8), and the ported rebalance (§9). The most
  accurate numbers doc in the repo; cite it for combat math rationale.
- `FABLE.md` — the **2026-07-01 ten-track review** (adversarially verified): bug
  ledgers by layer, invariant audit, docs-drift table, product analysis, and the
  **prioritized action list (§14) — the live "what next" queue**.
- `REVIEW-2026-06-16.md` — historical: the 4-agent state-of-project deep dive
  (superseded by FABLE.md; its E4-closed claim was wrong).
- `DESIGN-GOALS.md` — **guiding principles & go-to-market north star**. Principles,
  not a backlog — steer judgment calls + the killer-feature watch-list.
- `WRAPPERS.md` — shipping decision: web client + PWA (Tauri/Capacitor documented);
  Godot rejected.
- `MODDING.md` — the **YAML content-conversion track** (Phases 0–2 DONE 2026-06-17): how all content
  became external YAML, the loader/registry/derived-validator architecture, the affix magnitude DSL,
  and the remaining Phase 3 (the effect-DSL). Dependency invariant: runtime deps stay empty.
  (⚠ its "build prebuild gate" is described but was never wired — validation is vitest-only.)
- `docs/` — the **modder wiki**: `glossary.md` + the full YAML config reference (`yaml-content.md`
  registry, `yaml-catalogs.md` classes/gear/affixes, `yaml-tuning.md` loot/economy/progression/delve).
  Cite these for "what fields does X.yaml take". (⚠ yaml-tuning.md's loot section documents
  retired fields — see FABLE.md §10 until reconciled.)
- The **workspace `../CLAUDE.md`** (set-crawl/) — the seam between this repo and the
  `crawl-records` backend: contract handshake docs, seam invariants, local dev wiring.
  Read it for any work touching `src/net/` or the daily.

## What this is
A skill-component minigame based on the card game **Set**, grown into a full
dungeon-crawler roguelite. Lineage: `set.core` (skill core) → `set.combat`
(classes, abilities, Tactics, the threat layer) → **`set.crawl`** — and the crawl
**loop is complete**: create → town (10-location hub + sub-districts) → delve
(room chain, fork, boss) → loot triage → town, with a closed economy (gold/gear/
XP/tithe), twelve authored dungeons, and an online seam (the **Embassy**:
registration, run upload, personal bests, and a deterministic **Daily Dispatch**).
**The live game is the modular TypeScript client in `src/`** (`core`/`data`/
`engine`/`ui`/**`net`**, entry root `index.html`, run with `pnpm dev`). The original
single-file prototypes under `prototype/` are **archived** behavioral oracles —
read them for *intent*, but new code lands in `src/`. All game content is external
YAML in `src/data/content/` with generated JSON Schemas.

## Mental model (don't lose this)
- Set = finite affine geometry **AG(f,3)**. Cards are points in (ℤ/3)^f; a set is
  a line; three cards are a set iff every coordinate sums to 0 mod 3.
- Two cards uniquely determine the third: `third(a,b)_i = (-(a_i+b_i)) mod 3`.
- **Keep 3 values per feature.** Vary `f` for difficulty, never `v`.
- Density: `E[sets] = C(N,3)/(3^f − 2)`.
- The dials are NOT one difficulty scale. F = difficulty spine (moves findability
  AND availability). N = texture (U-shaped, not monotonic). Timer = pressure
  (maps to character skill). k-bias = pure findability. See PROJECT.md §4.
- **The seam insight (online layer):** the game core is a pure deterministic
  generator from a seed/spec — so the daily ships as a tiny seed + version pins
  (never content), and a run's ordered action log + seed is the future replay/
  anti-cheat substrate. Details + invariants in the workspace `../CLAUDE.md`.

## Hard rules / invariants (assert in any refactor)
1. No duplicate cards on a board.
2. At least `FLOOR` sets present at all times (never a dead board). *De facto*
   reading as built: the floor may dip transiently while transmute/wound pendings
   reform; every refill re-asserts it (lock-aware), and `floorCanary` counts any
   below-floor fallback (dev-warn).
3. Dropped/inactive axes are pinned to a constant → must stay all-same →
   never affect set validity. (Cards are always 4-tuples internally.)
4. Generator is a **pure function of a target spec**. Abilities/encounters are
   **spec→spec transforms**, never direct generator inputs. This is the
   structural fairness guarantee — do not add a difficulty input that bypasses it.
5. Control aggregate stats; randomize specifics (no positional tells).
6. **Selection-protected turnover (settled 2026-06-13; BUILT 2026-06-14).** No card
   *turnover* (any sourced transmute — drift / churn / trap / trick) may target a card
   that is currently **selected** OR is a **set-mate of a selected card**. Kills the
   "I clicked 2 of the 3 and the last one morphed" bad-feel — your pattern-finding
   beats your click speed, never the reverse. Holding a partial selection therefore
   *shields* those cards: an acceptable (clever) exploit. Player casts are exempt;
   "no legal target → skip" holds, so protection can never break the FLOOR.
   As built: `protectedSlots` (`src/engine/select.ts:118`) + the shield filter in
   `transmute` (`triggers.ts`), tested in `protection.test.ts`; the UI hands the live
   selection to the engine each dispatch (`app.ts` — an untested line; see FABLE §6 U5).
   **Known edges (FABLE §3/§7):** wound shatters and locks bypass the shield; the
   matched trio is unshielded during match-trigger firing (E6); and selection isn't
   in the action log, which breaks replay determinism (E7). Weigh these on any
   turnover-adjacent change.

## Working style notes
- The generation core is well validated and has held through two engine rewrites.
  The in-repo gate is `generate.invariants.test.ts` (a 240-config dial sweep +
  weighted-bias stress + the below-floor canary, ~6.2k seeded board checks/run)
  plus `engine.fuzz.test.ts` (whole-reducer random play asserting dup/pin/
  lock-aware-floor every step). The old "100k+ clears" figure was the archived
  prototype harness — don't cite it for the current suite. Before shipping any
  change to generation, run this suite; extend it if you add a dial.
- The live game is the framework-free TS client in `src/` (Vite/Vitest toolchain);
  shipping is settled as **web client + PWA** per `WRAPPERS.md`. The archived
  prototypes are oracles only — don't grow them.
- **Lock-layer invariant (built, keep asserting):** ≥ FLOOR sets must be completable from
  *unlocked* cards (the makeable-set floor, `TRAPS.md` §6). `floor-stress.test.ts` is
  the proof; keep it green.
- **Keep everything testable, and keep tests quick.** Engine/core logic → vitest
  unit/integration. For UI work, push logic into a pure module and test *that* — never
  the DOM. This policy is genuinely followed (save/bank/delve-run/splash/career/
  combat-log all landed extracted-first); `ui/app.ts` (~4.5k lines) remains the one
  untested monolith — new glue lands already-extracted + tested, and dispatch is the
  next extraction target (it carries hard-rule-6's handoff untested).
- **The net seam (`src/net/`) is the only networked layer** — offline-first, gated,
  pure decision modules around one fetch wrapper. The engine never imports it; keep
  that direction. Wire-shape changes are server-first (edit `contract.py` in
  crawl-records → `make openapi` → mirror into `src/net/contract.ts`); seam
  invariants live in the workspace `../CLAUDE.md`.
- **Watch for killer-feature hook-ins.** `DESIGN-GOALS.md` carries the watch-list.
  Status: daily seed **shipped** (leaderboard half is not — personal bests only);
  graceful miss-degradation **resolved by architecture** (Rounds v3 has no per-set
  timer); clock-on-first-action substantially satisfied; relaxed/no-timer mode and
  big-chain achievements (`combo.fightPeak` — computed, still uncaptured) remain
  open hooks. Flag clean hook-in points rather than letting them pass.
- **Balance work goes through the sims — and the sims ran.** `sim/balance-sim.mjs`
  drove the 2026-06-17 rebalance; its decisions live in `BALANCE.md` §8 and are
  ported (§9). Caveats: the sims hand-copy ~15 engine constants with no drift guard
  (verify against code before trusting a run), and `progression-sim.mjs` deliberately
  models the *pre*-rebalance rules (historical). Future balance passes: extend
  balance-sim, settle in BALANCE.md, then port — don't hand-tune constants ad hoc.
  The generation-invariant sweep above is separate and always runs.
- **Know the open correctness ledger before touching combat/net/UI:** `FABLE.md`
  §§3–6 (2026-07-01, adversarially verified). Headliners: the zombie-foe win-check
  hole (E1), uncapped COMBO OVERTIME freezing the anti-stall (E2), the daily
  phantom-hero roster leak (C1), and the tick-log/outbox quota batch (N1). §14 is
  the sequenced action list.

## Repo / workflow
- **Personal repo** — committing and **pushing directly to the default branch
  (`master`) is fine**, including in auto/unattended mode. No PR/branch dance
  required unless a change is genuinely risky. Commit/push when the user asks.
- ⚠ **Every push to master deploys to GitHub Pages with no CI gate** (no test, no
  typecheck, no content validation — FABLE §9 D1). Until the gate lands in
  `deploy.yml`, run `pnpm typecheck && pnpm test` (~4 s) before any push.

## State of the build (reconciled 2026-07-01)

**Shipped and live** (compressed; each was once an "open thread" here):
- The threat layer (trigger bus, locks, geometry selectors, dungeon drift) — in `src/engine`.
- The foundation migration — the modular client is the game; prototypes archived.
- **ROUNDS v3** (built 2026-06-11, revised since): 20 s rounds, verbs accumulate →
  rollover exchange (kill-race ordering), telegraph decoupled to level-parity E,
  Block no-carry, Move-banked Dodge with cadence caps, computed wound laws, the
  decimal rebase (HP 100 / stats 10), the breakdown-popover rollover, combo +
  OVERTIME, **dread escalation** (the structural anti-stall: unguardable bleed +
  foe/player multipliers — but see FABLE E2 for the OVERTIME hole).
- Tactics v3 stances (Stand Ground ward-banker / Maneuver live-burn), dev
  instruments (reshape share, spring rate) live in the combat UI.
- **Phase B2 complete**: delve flow (boss inverse-CDF, elite sawtooth, dread bands,
  fork), **real loot/gold/XP, the flee parting blow, the death tithe**, the full
  exit ladder — all tested (`delve-run.ts`, `loot.ts`, `smith.ts`, `bank.ts`).
- The town buildout: Vault, Market, Smithy/Enchanter, Merchant House tracks, Guild
  District shell; progression (cap 21, +5 HP & **+4 free stat points/level ≤3/stat**).
- The YAML conversion (MODDING Phases 0–2): all content external, generated schemas,
  registry link-checker, affix magnitude DSL. The **Twelve Gates** D1→D10 dungeon
  ladder (~80 foes).
- The 2026-06-17 **balance pass** (sim-driven, BALANCE.md): foe HP re-anchor
  ~100/250/400, nuke reprice VPM≈4, LOOTTIER_K 0.12, innate +6→+4, defensive
  models A+B.
- The **Embassy net layer** (`src/net/`, 12 modules, all decision logic tested):
  identity/registration, offline outbox, run capture, personal bests, and the
  **Daily Dispatch** — a fully deterministic seed-derived daily (dungeon/class/foe/
  board all from the shared seed; standardized ephemeral hero).

**Next up — `FABLE.md` §14 is the sequenced queue.** In brief: the correctness
quick-hits (zombie foe, phantom hero, CI gate, `[i,i,i]` guard, esc()); then the
**daily-integrity batch** before the Embassy leaves localhost (outbox cap + tick
coalescing, wall-clock/pause capture, content-hash version tokens + candidate-order
pin, daily sub-seed decorrelation, dev-mode flag); then the product sequence
(fresh-save funnel → colorblind + relaxed mode → class-kit expansion → daily
leaderboard). Cross-repo follow-ups (real version tokens, vendored openapi codegen,
daily depth) are tracked in the workspace `../CLAUDE.md`.

**Still-open design questions** (see `TRAPS.md` §8 / `CRAWL-DESIGN.md` §6): per-foe
transmute *numbers* (framework set, tune in play); ability slots vs. learned
library (bites P2 — kits exhaust unlocks at L3); cooldowns vs. resource-only;
whether the enemy ever gets an active resource-spending layer; MODDING Phase 3
(the effect-DSL — abilities/passives/consumables are still TS closures).
