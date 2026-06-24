# `src/net/` — the Embassy online seam

The **only** layer in the client that talks to the network. Everything here is gated, optional, and
offline-first: with the Embassy disabled (or no server URL, or a modded game) **no request is ever
made**. The engine/core never import this layer — dependency flow is one-way (`net → engine` for
*types only*; engine never imports net). See `SERVICE.md` / `SERVICE-RESPONSE.md` / `SERVICE-REPLY.md`
at the repo root for the full contract and the open questions.

## Modules

| File | Role | Tested |
|---|---|---|
| `contract.ts` | Canonical client mirror of the service wire types (until codegen — see below). | type-only |
| `record.ts` | Pure: assemble a replay-ready `RunRecord` + mint UUIDs (`eventId`, fingerprint). | `record.test.ts` |
| `account.ts` | The account-level identity store (fingerprint write-once + handle/token/recovery/consent). | `account.test.ts` |
| `outbox.ts` | The metrics outbox: idempotent enqueue, prune-on-accept, drop-terminal-rejects, FIFO batch. | `outbox.test.ts` |
| `daily.ts` | Pure: resolve a `/daily` descriptor → available (seed-derived or authored-`spec`) / unavailable. | `daily.test.ts` |
| `capture.ts` | Pure: map a finished run's facts → a wire `RunRecord` (context/outcome/instruments). | `capture.test.ts` |
| `run-capture.ts` | Glue: `recordRun` fills fingerprint/versions/mod-flag, builds the record, queues it (gated). | (thin glue) |
| `embassy-status.ts` | Pure: the Embassy scene's view-state (gate modded/no-server/open · status · pending). | `embassy-status.test.ts` |
| `version.ts` | The client `rulesetVersion` / `contentVersion` tokens (placeholders until real versioning). | — |
| `config.ts` | The runtime switches (enable flag, server URL, mod-gate) + the `isAvailable` predicate. | `config.test.ts` |
| `embassy.ts` | The network client: thin endpoint wrappers + `flushOutbox`. The one place `fetch` is called. | (I/O glue) |

The action recorder is **live**: `ui/app.ts` seeds the run's RNG in `startCombat` (so `{seed, actions}`
replays the in-combat run) and calls `recordRun(...)` at the top of `endScreen` — every finished fight
(practice or delve) queues to the outbox, gated so a modded game records nothing.

The interesting **decisions** live in the pure modules (record/outbox/account/config) and are
unit-tested; `embassy.ts` is deliberately thin I/O glue so the untested surface stays minimal.

## Persistence

Each store is its **own** `localStorage` key with the repo's envelope discipline (`{ v, … }`, stable
key, schema version in the payload, one migration per bump — mirrors `ui/save.ts`):

- `setcore.embassy.account.v1` — the identity record.
- `setcore.embassy.outbox.v1` — the pending run records.
- `setcore.embassy.config.v1` — enable flag + server URL (the `modded` flag is a live runtime fact,
  re-derived each session, not persisted as truth).

## The contract & codegen

`contract.ts` is **hand-maintained today**. The service is the source of truth and emits an OpenAPI
schema; once we vendor its `openapi.json` here, generate the wire types:

```bash
# vendor the service's schema (from the set-embassy repo), then:
pnpm gen:embassy-types     # → src/net/embassy-types.ts (generated; do not hand-edit)
```

When that lands, keep `contract.ts` as the stable app-facing surface and adapt it to the generated
shapes there — nothing outside `net/` should import the raw generated `paths`/`components`.

## The Embassy scene (built — `ui/app.ts`)

A nested town hub (the `guildDistrictScene` pattern): **Embassy → Registry / Hall of Records**, plus
dim future-quarter stubs (Daily Dispatch, Consulate, Mercenary Post). `embassy-status.embassyView`
drives the branching:
- **Registry** — connection (enable toggle + server URL), register-with-consent (→ `embassy.register`
  → `markRegistered`, surfaces the recovery code), decline, and recover-on-new-device (→
  `embassy.recover` → `applyRecovery`). Register is gated on `canRegister` (server reachable).
- **Hall of Records** — the local upload-queue depth, a **Sync now** (`flushOutbox`), and the player's
  bests (`embassy.bests`) when registered + connected.
- Arriving at the Embassy auto-flushes the outbox (best-effort). A **modded** game shows the closed
  state; **offline** is a local-only archive (runs still record; nothing syncs).

## Remaining

- **Daily seed→board generation + the Daily Dispatch quarter** — `daily.resolveDaily` already decides
  available/unavailable + authored-vs-seed; what's left is feeding its `seed` + `fixed` selections into
  the deterministic generator / `engine/session.ts` and lighting up the (currently dim) Daily card.
- **Wire real client versions** (`version.ts`) + vendor `openapi.json` → `pnpm gen:embassy-types`.
- **Browser smoke-test** the Embassy scene + the recorder (no e2e harness in the repo).
- **Future quarters** (stubbed + dim): Consulate (friends · visiting cities · shared shops),
  Mercenary Post (hire heroes out for gold · hero-of-the-day). Documented in `SERVICE.md` phase-2.

### Known limitations / follow-ups

- **Replay depth:** the captured `seed` drives board-gen + tick RNG, so the *in-combat* run replays from
  `{seed, actions}` given the same initial combat state. FULL server-side re-simulation also needs the
  foe snapshot + stat/gear context threaded through an extended `engine/session.ts` seam (deferred — TODO
  §A step 6). The action log + seed are captured now so that work needs no re-instrumentation.
- **`startCombat` now seeds the run RNG** (was the shared global `systemRng`). Distribution-identical, but
  it's a live-combat behavior change with **no e2e harness in the repo** — wants a browser smoke-test.
- **Client versions are placeholders** (`version.ts` = `'0'`) until wired to real content/build versioning.
- **Practice fights** fold to a `delve`-kind record disambiguated by `instruments.mode` — a possible
  first-class `kind: 'practice'` is flagged for the service team.
