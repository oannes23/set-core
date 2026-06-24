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
| `config.ts` | The runtime switches (enable flag, server URL, mod-gate) + the `isAvailable` predicate. | `config.test.ts` |
| `embassy.ts` | The network client: thin endpoint wrappers + `flushOutbox`. The one place `fetch` is called. | (I/O glue) |

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

## Deferred (blocked on `SERVICE-REPLY.md` §1–2)

- The Embassy **scene** wiring (register/consent UI, daily fetch→regenerate, bests display) waits on
  the daily-roll contract + the version-source answer.
- The **action recorder** capture point in `ui/app.ts` (the engine already produces the
  `CombatAction[]` replay log via `engine/session.ts`; `record.assembleRunRecord` packages it — the
  remaining work is tapping the live run's action stream + outcome + instruments at run-end).
