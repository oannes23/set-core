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

/** N1 — hard caps on the LOCAL outbox. A record carries the whole per-fight tick log (~0.3–0.5 MB), and
 *  the default (offline/unregistered) player NEVER flushes, so an uncapped queue exhausts the ~5 MB origin
 *  quota within an evening — after which new records are silently dropped AND roster/bank saves start
 *  failing (shared quota). Bound BOTH count and total bytes, evicting OLDEST-first (the least likely to
 *  still matter). */
export const OUTBOX_MAX_RECORDS = 50
export const OUTBOX_MAX_BYTES = 2_000_000 // ~2 MB — well under quota, leaving headroom for roster/bank/career

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

/** Rough serialized size of a record (the tick log dominates it). Best-effort; 0 on failure. */
export function recordBytes(rec: RunRecord): number {
  try {
    return JSON.stringify(rec).length
  } catch {
    return 0
  }
}

/** N1 — trim the queue to BOTH caps, evicting OLDEST-first (FIFO). Always keeps at least the newest
 *  record (a single over-cap record is the server's to reject, not ours to lose silently). Returns the
 *  trimmed queue; compare lengths to know how many were evicted. */
export function capOutbox(records: readonly RunRecord[], maxRecords = OUTBOX_MAX_RECORDS, maxBytes = OUTBOX_MAX_BYTES): RunRecord[] {
  let kept = records.length > maxRecords ? records.slice(records.length - maxRecords) : records.slice()
  let total = kept.reduce((n, r) => n + recordBytes(r), 0)
  while (kept.length > 1 && total > maxBytes) {
    total -= recordBytes(kept[0])
    kept = kept.slice(1)
  }
  return kept
}

/** N3 — the next flush batch bounded by cumulative BYTES as well as count, so a reverse-proxy body limit
 *  (nginx defaults to 1 MB; each record is ~0.5 MB) can't 413 the whole batch forever. Always includes at
 *  least the first record. */
export function peekBatchByBytes(records: readonly RunRecord[], maxBytes: number, maxCount = MAX_BATCH): RunRecord[] {
  const out: RunRecord[] = []
  let total = 0
  for (const r of records.slice(0, Math.max(0, maxCount))) {
    const b = recordBytes(r)
    if (out.length > 0 && total + b > maxBytes) break
    out.push(r)
    total += b
  }
  return out
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
    /* private mode / quota exceeded: this write is LOST (enqueue is load→append→save — there is no live
       in-memory queue to fall back to). capOutbox keeps us under quota so this stays rare; nothing to do here. */
  }
}

/** Queue one record (load → enqueue → CAP → save). The per-run entry point from the run glue. The cap
 *  (N1) bounds the local queue so a never-flushing player can't exhaust the origin quota. */
export function enqueueRecord(rec: RunRecord): void {
  saveOutbox(capOutbox(enqueue(loadOutbox(), rec)))
}

/** How many records are waiting to upload. */
export function pendingCount(): number {
  return loadOutbox().length
}
