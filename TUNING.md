# TUNING.md — live engine constants (code is the source of truth)

**The numbers below live in code; this file is a mirror, not an authority.**
Design docs should cite `TUNING.md` instead of inlining numbers — when a
constant changes in code, update it here (one place) rather than chasing prose
across the design docs. Verified against `src/` on 2026-06-10 (incl. the Resolution v2 retune: slower bands, ~+25% creature damage — fewer, weightier, telegraphed exchanges).

## Resolution v2 — "sets steer, stats carry" (Model B)

| Constant | Value | File | Meaning |
|---|---|---|---|
| `BASE_STATS` | power 2 · endurance 2 · speed 2 | `src/engine/state.ts` | The parity statline (per-card values 1/2/3, identical to the old magnitude system) |
| `QUALITY` | ① ×0.7 · ② ×1.0 · ③ ×1.4 | `src/engine/resolve.ts` | Card magnitude = action quality; per card `round(stat × q)` |
| Set damage | deterministic | `src/engine/resolve.ts` | A set always delivers exactly what it reads (no roll); `weightedRoll` remains for enemy strikes + abilities |
| `DEFAULT_WINDUP_S` | 4 | `src/engine/state.ts` | Telegraphed-exchange windup: the strike is pre-rolled, REVEALED, and COMMITTED (Move pushes → charges) |
| Authored windups | Behemoth 8 · King 6 · Butcher 6 | `src/data/game-data.ts` (`windup`) | Heavy hitters rise visibly longer |

## Combat & Tactics (v2)

| Constant | Value | File | Meaning |
|---|---|---|---|
| `CHARGE_CAP` | 5 | `src/engine/state.ts` | Tactics charge queue/bank cap; overflow income is wasted |
| `CHURN_MS` | 800 | `src/engine/state.ts` | Maneuver spends ONE charge per this interval (serial, never a batch) |
| `SWAP_SPINUP_MS` | 3000 | `src/engine/state.ts` | After a tactic swap, charges reset and income is lost until spin-up elapses |
| `MANA_CAP` | 15 | `src/engine/state.ts` | Per-color mana cap; gains past it are pure loss (gear may raise later) |
| `CLOCK_CAP` | 20 | `src/engine/state.ts` | Move-stall cap on the enemy clock = `max(20s, foe cadence)` |
| `DMG_REGEN_MS` | 10000 | `src/engine/state.ts` | A shattered (wounded) card reforms after this |
| `START_GRACE_MS` | 3000 | `src/engine/state.ts` | UI freezes the clock after Engage (read the board, no ticks advance) |
| `DEFAULT_PLAYER_MAX` | 30 | `src/engine/state.ts` | `createCombat`'s default player max HP; the save layer mirrors it |
| `BIAS_W` | 8 | `src/engine/select.ts` | Transmute-regen weight toward the favoured color/shape/magnitude |

## Board generation

| Constant | Value | File | Meaning |
|---|---|---|---|
| `COMBAT_GEN.n` | 15 | `src/engine/combat.ts` | Board size (5×3 grid) |
| `COMBAT_GEN.active` | `[0, 1, 3]` | `src/engine/combat.ts` | Active axes: color, shape, number — shading (axis 2) dropped/pinned |
| `COMBAT_GEN.camoDepth` | 1 | `src/engine/combat.ts` | Target easiest-k (gimmes always present) |
| `COMBAT_GEN.escapeRoutes` | 6 | `src/engine/combat.ts` | Sets at the easiest k |
| `COMBAT_GEN.floor` | 1 | `src/engine/combat.ts` | Minimum sets on the board, always |

## Enemy pacing

| Constant | Value | File | Meaning |
|---|---|---|---|
| Speed bands | lumbering 24s · slow 19s · steady 15s · swift 12s · frenzied 9s | `src/data/game-data.ts` (`speed`) | Per-foe attack cadence (TRAPS.md §7.2) |
| Ember Drift `every` | 7s | `src/data/game-data.ts` (`drifts.ember`) | The shipped dungeon drift: 1 card / 7s toward red (per-dungeon tuning lever) |
| Enemy hit → wound | 1 rune shattered | `src/engine/triggers.ts` (`shatterCard`) | A hit that bites HP past Block shatters one card (a Wound); it reforms after `DMG_REGEN_MS` |

## Trap severity law

| Rule | Value | File | Meaning |
|---|---|---|---|
| `scale: 'set_mag'` | `max(1, totalMagnitude − 4)` | `src/engine/triggers.ts` (`scaledBySetMag`), `src/data/schema.ts` | Effect severity scales with the springing set's total magnitude (1·1·1 → 1 … 3·3·3 → 5). Used by Confusion v2 |

## Dev-instrument design targets (measured live in the combat dev panel)

| Instrument | Target | Source |
|---|---|---|
| Reshape share (player-driven board change vs drift/trap/trick) | **65–70% player** | TRAPS.md §5.5; measured in `src/ui/app.ts` dev panel |
| Trap-spring rate (hostile traps sprung per match) | **~30%** | TRAPS.md §2 master tuning law; measured in `src/ui/app.ts` dev panel |
