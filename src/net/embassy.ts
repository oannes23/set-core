/* net/embassy — THE network seam. The ONLY module in the client that makes a request; everything else
   (engine/core/ui logic) stays pure + offline-first. Every call is gated by net/config.isAvailable:
   disabled, no server URL, or modded ⇒ no fetch happens, full stop (the mod-gate / consent gate).

   Thin wrappers over the service endpoints (SERVICE-RESPONSE.md §4) + the high-level `flushOutbox`
   that ties the outbox ↔ account ↔ ingest together. The interesting DECISIONS (what to enqueue, what
   to prune/retry) live in net/outbox + net/record and are unit-tested there; this file is I/O glue.

   NOTE: the daily-fetch→regenerate path and the register/consent UI are DEFERRED until the service team
   answers SERVICE-REPLY.md §1–2 (the daily-roll contract + where versions come from). `daily()` and the
   register/recover wrappers exist so the contract is exercised, but the Embassy SCENE wiring waits. */

import { getConfig, isAvailable } from './config'
import {
  type BestsResponse,
  type DailyResponse,
  type HandleAvailableResponse,
  type HealthResponse,
  type IngestResponse,
  type RecoverRequest,
  type RecoverResponse,
  type RegisterRequest,
  type RegisterResponse,
  type RunRecord,
} from './contract'
import { applyIngestResult, loadOutbox, partitionRejections, peekBatchByBytes, saveOutbox } from './outbox'
import { isRegistered, loadAccount } from './account'

/** Thrown when a request is attempted while the Embassy is unavailable (disabled / no URL / modded).
 *  Callers should gate on isAvailable() first; this is the belt-and-suspenders backstop. */
export class EmbassyUnavailableError extends Error {
  constructor() {
    super('Embassy is unavailable (disabled, no server URL, or modded game)')
    this.name = 'EmbassyUnavailableError'
  }
}

interface RequestOpts {
  method?: 'GET' | 'POST'
  body?: unknown
  token?: string // bearer for authed endpoints
  query?: Record<string, string>
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const cfg = getConfig()
  if (!isAvailable(cfg)) throw new EmbassyUnavailableError()
  const base = cfg.serverUrl.replace(/\/+$/, '')
  const qs = opts.query ? '?' + new URLSearchParams(opts.query).toString() : ''
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`
  const res = await fetch(`${base}${path}${qs}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  if (!res.ok) throw new EmbassyHttpError(res.status, path, await safeText(res))
  return (await res.json()) as T
}

/** A non-2xx response from the service (carries the status so callers can branch — e.g. 409 handle
 *  taken, 404 bad recovery code, 413 batch too large, 503 ingest disabled). */
export class EmbassyHttpError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly bodyText: string,
  ) {
    super(`Embassy ${status} on ${path}`)
    this.name = 'EmbassyHttpError'
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

// ---- endpoint wrappers (SERVICE-RESPONSE.md §4) ----

export const health = (): Promise<HealthResponse> => request<HealthResponse>('/health')

export const handleAvailable = (name: string): Promise<HandleAvailableResponse> =>
  request<HandleAvailableResponse>('/handle/available', { query: { name } })

export const register = (body: RegisterRequest): Promise<RegisterResponse> =>
  request<RegisterResponse>('/register', { method: 'POST', body })

export const recover = (body: RecoverRequest): Promise<RecoverResponse> =>
  request<RecoverResponse>('/recover', { method: 'POST', body })

export const ingest = (records: RunRecord[], token: string): Promise<IngestResponse> =>
  request<IngestResponse>('/ingest', { method: 'POST', body: { records }, token })

export const bests = (token: string): Promise<BestsResponse> => request<BestsResponse>('/me/bests', { token })

/** date defaults to "today UTC" server-side when omitted. */
export const daily = (date?: string): Promise<DailyResponse> =>
  request<DailyResponse>('/daily', { query: date ? { date } : undefined })

// ---- high-level flows ----

export interface FlushResult {
  attempted: number
  accepted: number
  retryable: number
  dropped: number // terminally rejected
  remaining: number
  /** N3 — set when the flush FAILED to make progress (nothing pruned): 'auth' = token rotated/revoked
   *  (401/403 — the device must re-link), 'http' = another non-2xx (see status), 'network' = fetch threw.
   *  Absent on success. Lets the UI surface a real error instead of a silent perpetual stall. */
  error?: 'auth' | 'http' | 'network'
  status?: number
}

/** Stay under a reverse-proxy request-body limit (nginx defaults to 1 MB; each record is ~0.5 MB), so a
 *  full batch can't 413 forever. On a 413 anyway we bisect down to a single record. */
const INGEST_MAX_BYTES = 900_000

/** Flush the outbox to /ingest (batch bounded by count AND bytes), then prune accepted + terminally
 *  rejected, keeping retryables for next time. Safe no-op when the Embassy is unavailable or the account
 *  isn't registered. Idempotent: re-running after a lost ack converges (eventId dedupe).
 *
 *  N3 recovery: a deterministic non-2xx used to throw past both callers and re-send the identical batch
 *  forever (a silent permanent stall). Now: a 413 bisects the batch; a 401/403 (token rotated by /recover
 *  on another device) returns `error:'auth'` so the UI can prompt a re-link; any other failure returns an
 *  error result instead of throwing. */
export async function flushOutbox(): Promise<FlushResult> {
  const empty: FlushResult = { attempted: 0, accepted: 0, retryable: 0, dropped: 0, remaining: 0 }
  const acc = loadAccount()
  if (!isAvailable() || !isRegistered(acc) || !acc.token) return empty

  const queued = loadOutbox()
  let batch = peekBatchByBytes(queued, INGEST_MAX_BYTES)
  if (batch.length === 0) return empty

  let res
  for (;;) {
    try {
      res = await ingest(batch, acc.token)
      break
    } catch (e) {
      if (e instanceof EmbassyHttpError) {
        if (e.status === 413 && batch.length > 1) { batch = batch.slice(0, Math.floor(batch.length / 2)); continue } // too large → bisect
        const error = e.status === 401 || e.status === 403 ? 'auth' : 'http'
        return { ...empty, remaining: queued.length, error, status: e.status }
      }
      return { ...empty, remaining: queued.length, error: 'network' }
    }
  }

  const next = applyIngestResult(queued, res.accepted, res.rejected)
  saveOutbox(next)

  const { terminal, retryable } = partitionRejections(res.rejected)
  return {
    attempted: batch.length,
    accepted: res.accepted.length,
    retryable: retryable.length,
    dropped: terminal.length,
    remaining: next.length,
  }
}
