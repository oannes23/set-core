/* net/outbox — the local metrics OUTBOX: run records queue here, flush to the Embassy on a visit, and
   are pruned only after the server ACKs their eventIds (so a lost ack can't lose data, and a re-send
   can't double-count — POST /ingest is idempotent on eventId). Its own localStorage key, same envelope
   discipline as ui/save.ts. Lets the client delete uploaded records to avoid local bloat (the goal).

   PURE queue transforms (enqueue/prune/peek/partition) are exported + unit-tested; storage I/O is
   best-effort. The flush itself lives in net/embassy.ts (it does the actual fetch); this module owns
   the data + the decisions about what to keep, retry, or drop. */

import { type IngestRejection, type RunRecord, TERMINAL_REJECT_REASONS } from './contract'

/** Mirror of the service cap (SERVICE-RESPONSE.md §7: EMBASSY_MAX_BATCH default 100). One /ingest POST
 *  sends at most this many records; the rest flush on the next pass. */
export const MAX_BATCH = 100

const KEY = 'setcore.embassy.outbox.v1' // stable — versioning lives in the payload envelope
const SCHEMA_V = 1

interface Envelope {
  v: number
  records: unknown[]
}

const MIGRATIONS: Record<number, (e: Envelope) => Envelope> = {}

function migrate(env: Envelope): Envelope {
  let cur = env
  while (cur.v < SCHEMA_V && MIGRATIONS[cur.v]) cur = MIGRATIONS[cur.v](cur)
  return cur
}

/** A minimally-valid outbox record: must carry a non-empty eventId (the dedupe/idempotency key). The
 *  interior is otherwise trusted (records are produced by net/record.assembleRunRecord). */
function isRecord(x: unknown): x is RunRecord {
  return typeof x === 'object' && x !== null && typeof (x as RunRecord).eventId === 'string' && (x as RunRecord).eventId.length > 0
}

// ---- pure queue transforms (no I/O) ----

/** Append a record IDEMPOTENTLY: a record whose eventId is already queued REPLACES the queued one
 *  (latest wins) rather than duplicating. Order is otherwise preserved (FIFO flush). */
export function enqueue(records: readonly RunRecord[], rec: RunRecord): RunRecord[] {
  const i = records.findIndex((r) => r.eventId === rec.eventId)
  if (i < 0) return [...records, rec]
  const next = records.slice()
  next[i] = rec
  return next
}

/** Drop the records the server ACCEPTED (POST /ingest → accepted[]). */
export function pruneAccepted(records: readonly RunRecord[], acceptedIds: readonly string[]): RunRecord[] {
  if (acceptedIds.length === 0) return records.slice()
  const done = new Set(acceptedIds)
  return records.filter((r) => !done.has(r.eventId))
}

/** Is a rejection terminal (drop — retrying never succeeds) vs retryable (keep — try next flush)?
 *  The service's `terminal` boolean is AUTHORITATIVE (SERVICE-REPLY-RESPONSE.md §4); only when it's
 *  absent (a flag-less/legacy response) do we fall back to the confirmed-terminal reason set. */
function isTerminal(r: IngestRejection): boolean {
  return typeof r.terminal === 'boolean' ? r.terminal : TERMINAL_REJECT_REASONS.has(r.reason)
}

/** Split per-record rejections into TERMINAL (drop) vs RETRYABLE (keep) — branch on the boolean. */
export function partitionRejections(rejections: readonly IngestRejection[]): { terminal: IngestRejection[]; retryable: IngestRejection[] } {
  const terminal: IngestRejection[] = []
  const retryable: IngestRejection[] = []
  for (const r of rejections) (isTerminal(r) ? terminal : retryable).push(r)
  return { terminal, retryable }
}

/** Drop the terminally-rejected records so the queue can drain (they'd never be accepted). */
export function pruneTerminal(records: readonly RunRecord[], rejections: readonly IngestRejection[]): RunRecord[] {
  const { terminal } = partitionRejections(rejections)
  if (terminal.length === 0) return records.slice()
  const dead = new Set(terminal.map((r) => r.eventId))
  return records.filter((r) => !dead.has(r.eventId))
}

/** Apply a full /ingest response: drop accepted + terminally-rejected; keep retryable for next time. */
export function applyIngestResult(records: readonly RunRecord[], accepted: readonly string[], rejected: readonly IngestRejection[]): RunRecord[] {
  return pruneTerminal(pruneAccepted(records, accepted), rejected)
}

/** The next batch to flush (FIFO, capped at MAX_BATCH). */
export function peekBatch(records: readonly RunRecord[], max = MAX_BATCH): RunRecord[] {
  return records.slice(0, Math.max(0, max))
}

/** Parse a raw stored payload → a clean record list (envelope → migrate → filter). Never throws. */
export function parseOutbox(raw: string | null): RunRecord[] {
  if (!raw) return []
  try {
    const data = JSON.parse(raw) as unknown
    const env: Envelope | null =
      data && typeof data === 'object' && typeof (data as Envelope).v === 'number' && Array.isArray((data as Envelope).records) ? (data as Envelope) : null
    if (!env) return []
    return migrate(env).records.filter(isRecord)
  } catch {
    return []
  }
}

// ---- best-effort I/O ----

export function loadOutbox(): RunRecord[] {
  try {
    return parseOutbox(localStorage.getItem(KEY))
  } catch {
    return []
  }
}

export function saveOutbox(records: readonly RunRecord[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: SCHEMA_V, records }))
  } catch {
    /* private mode / quota — records stay in memory this session and re-queue next run */
  }
}

/** Queue one record (load → enqueue → save). The per-run entry point from the run glue. */
export function enqueueRecord(rec: RunRecord): void {
  saveOutbox(enqueue(loadOutbox(), rec))
}

/** How many records are waiting to upload. */
export function pendingCount(): number {
  return loadOutbox().length
}
