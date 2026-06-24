/* net/contract — the Embassy wire types (client-side canonical mirror of the service contract).
   Source of truth is the SERVICE itself (its OpenAPI schema); see SERVICE-RESPONSE.md §3/§4. Until the
   service's `openapi.json` is vendored here and `pnpm gen:embassy-types` generates `embassy-types.ts`
   (see README.md), THIS file is the hand-maintained mirror the client builds against. When codegen
   lands, keep these names as the stable app-facing surface and adapt to the generated shapes here —
   nothing outside net/ should import the raw generated `paths`/`components`.

   schemaVersion is pinned to the contract version the response doc shipped (1). */

export const SCHEMA_VERSION = 1
/** The consent text revision the player agrees to at registration (advertised by /health). */
export const CONSENT_VERSION = '1'

/** A run's tamper/integrity envelope. MVP = honor-system `modded` flag; `manifestHash` is the
 *  reserved slot for the future content-hash gate (no schema break when it lands). */
export interface Integrity {
  modded: boolean
  manifestHash: string | null
}

/** Where a run came from + enough to regenerate its boards (replay substrate). */
export interface RunContext {
  kind: 'delve' | 'daily'
  dailyDate: string | null // set for daily runs (the UTC date), null for free delves
  classId: string
  foeId: string | null // the headline/boss foe, for slicing bests
  seed: string
  specRef: string
}

/** The result codes the WIRE uses. NB the engine says 'lose'; the wire says 'loss' — map at assembly. */
export type RunResult = 'win' | 'loss' | 'flee'

/** All numbers nullable: a flee/loss may lack a clear time (SERVICE-RESPONSE.md §3.2). */
export interface RunOutcome {
  result: RunResult
  terms: number | null // "sets matched to clear" (minimize) — the fewest-terms criterion
  realTimeMs: number | null
  depthReached: number | null
}

/** One run = the unit batched into POST /ingest. `actions` + `instruments` are opaque/open. */
export interface RunRecord {
  eventId: string // client-generated UUID; the idempotency key
  fingerprint: string
  schemaVersion: number
  rulesetVersion: string
  contentVersion: string
  integrity: Integrity
  context: RunContext
  outcome: RunOutcome
  actions: readonly unknown[] // ordered, replay-ready (CombatAction[] at the source); server stores opaque
  instruments: Record<string, unknown> // open object — add keys without a schema bump
}

// ---- endpoint payloads (SERVICE-RESPONSE.md §4) ----

export interface HealthResponse {
  status: string
  schemaVersion: number
  rulesetVersion: string
  contentVersion: string
  consentVersion: string
}

export interface HandleAvailableResponse {
  name: string
  available: boolean
}

export interface RegisterRequest {
  fingerprint: string
  handle: string
  consentVersion: string
  client: { rulesetVersion: string; contentVersion: string }
}
export interface RegisterResponse {
  token: string
  recoveryCode: string
  handle: string
}

export interface RecoverRequest {
  recoveryCode: string
  fingerprint: string
}
export interface RecoverResponse {
  token: string
  handle: string
}

export interface IngestRequest {
  records: RunRecord[]
}
export interface IngestRejection {
  eventId: string
  reason: string
}
export interface IngestResponse {
  accepted: string[]
  rejected: IngestRejection[]
}

export interface BestEntry {
  criterion: string
  classId: string
  foeId: string | null
  dailyDate: string | null
  value: number
  eventId: string
  achievedAt: string
}
export interface BestsResponse {
  bests: BestEntry[]
}

export interface DailyResponse {
  date: string
  seed: string
  specRef: string
  rulesetVersion: string
  contentVersion: string
  criteria: string[]
}

/** /ingest per-record reject reasons we treat as TERMINAL — the client drops these from the outbox
 *  rather than retrying forever (re-sending would never drain). Pending the service team's confirmation
 *  (SERVICE-REPLY.md §4) that these three are non-retryable; any future TRANSIENT reason must be named
 *  distinctly so we can branch instead of guessing from the string. Unknown reasons are treated as
 *  terminal too (safer than an infinite retry loop) — revisit if the team adds soft rejects. */
export const TERMINAL_REJECT_REASONS: ReadonlySet<string> = new Set([
  'modded',
  'fingerprint-mismatch',
  'missing-version',
])
