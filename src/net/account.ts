/* net/account — the ACCOUNT-level identity store: one record per install, the player's online
   fingerprint + (once they consent at the Embassy) their handle / token / recovery code / consent
   state. A SEPARATE localStorage key from the character roster (ui/save.ts) and the bank — same
   envelope `{ v, ... }` discipline: stable KEY, schema version in the PAYLOAD, one migration per bump.

   The FINGERPRINT is generated at first runtime and written ONCE (never read by game logic — it exists
   only to key this player's online records). Everything else stays null until the first Embassy visit.
   Pure transforms + the parse/migrate path are exported for testing; storage I/O is best-effort (a
   failure is non-fatal — the in-memory account still works this session). Mirrors ui/save.ts. */

import { CONSENT_VERSION } from './contract'
import { newId } from './record'

/** anonymous = fingerprint minted, never been to the Embassy · registered = consented + has a token ·
 *  declined = visited the Embassy and declined consent (Embassy stays closed until they opt in). */
export type AccountStatus = 'anonymous' | 'registered' | 'declined'

export interface ConsentRecord {
  version: string
  at: number // epoch ms when consent was granted (display/audit only)
}

export interface EmbassyAccount {
  fingerprint: string // write-once UUID; the online key. NEVER branch game logic on this.
  status: AccountStatus
  handle: string | null
  token: string | null // bearer token (account-level secret); re-issued on /recover
  /** the recovery code, surfaced once at registration. Held locally so the Embassy can re-show it until
   *  the player acknowledges they've written it down (then `acknowledgeRecovery` clears it). */
  recoveryCode: string | null
  consent: ConsentRecord | null
}

const KEY = 'setcore.embassy.account.v1' // stable — versioning lives in the payload envelope
const SCHEMA_V = 1

interface Envelope {
  v: number
  account: unknown
}

/** v(n)→v(n+1) payload migrations — one entry per schema bump, folded in order (none yet). */
const MIGRATIONS: Record<number, (e: Envelope) => Envelope> = {}

function migrate(env: Envelope): Envelope {
  let cur = env
  while (cur.v < SCHEMA_V && MIGRATIONS[cur.v]) cur = MIGRATIONS[cur.v](cur)
  return cur
}

const STATUSES: ReadonlySet<AccountStatus> = new Set<AccountStatus>(['anonymous', 'registered', 'declined'])

function str(x: unknown): string | null {
  return typeof x === 'string' && x.length > 0 ? x : null
}

/** A fresh anonymous account with a newly-minted fingerprint. */
export function freshAccount(fingerprint = newId()): EmbassyAccount {
  return { fingerprint, status: 'anonymous', handle: null, token: null, recoveryCode: null, consent: null }
}

/** Validate + normalize a stored account. A missing/blank fingerprint is regenerated (write-once means
 *  "never overwrite an existing one", not "crash without one"). Never throws. */
export function sanitizeAccount(x: unknown): EmbassyAccount {
  const a = (typeof x === 'object' && x !== null ? x : {}) as Partial<EmbassyAccount>
  const fingerprint = str(a.fingerprint) ?? newId()
  const status: AccountStatus = typeof a.status === 'string' && STATUSES.has(a.status as AccountStatus) ? (a.status as AccountStatus) : 'anonymous'
  const c = a.consent
  const consent: ConsentRecord | null =
    c && typeof c === 'object' && typeof (c as ConsentRecord).version === 'string'
      ? { version: (c as ConsentRecord).version, at: typeof (c as ConsentRecord).at === 'number' && Number.isFinite((c as ConsentRecord).at) ? (c as ConsentRecord).at : 0 }
      : null
  return { fingerprint, status, handle: str(a.handle), token: str(a.token), recoveryCode: str(a.recoveryCode), consent }
}

/** Parse a raw stored payload → a clean account (envelope detect → migrate → sanitize). Returns null
 *  only when there is NO stored payload at all (caller mints a fresh one). Never throws. */
export function parseAccount(raw: string | null): EmbassyAccount | null {
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as unknown
    const env: Envelope | null =
      data && typeof data === 'object' && typeof (data as Envelope).v === 'number' ? (data as Envelope) : null
    if (!env) return null
    return sanitizeAccount(migrate(env).account)
  } catch {
    return null
  }
}

// ---- pure transforms (testable; no I/O) ----

/** Write-once fingerprint guarantee: returns the account unchanged if it already has one. */
export function ensureFingerprint(acc: EmbassyAccount, id: () => string = newId): EmbassyAccount {
  return acc.fingerprint ? acc : { ...acc, fingerprint: id() }
}

export interface RegisteredFields {
  handle: string
  token: string
  recoveryCode: string
  consentVersion?: string
  at: number // epoch ms (caller supplies; this module stays pure of the clock)
}

/** Record a successful /register: consented, handle + token + recovery code in hand. */
export function markRegistered(acc: EmbassyAccount, f: RegisteredFields): EmbassyAccount {
  return {
    ...acc,
    status: 'registered',
    handle: f.handle,
    token: f.token,
    recoveryCode: f.recoveryCode,
    consent: { version: f.consentVersion ?? CONSENT_VERSION, at: f.at },
  }
}

/** The player declined consent at the Embassy — closed until they opt in (status flips back on register). */
export function markDeclined(acc: EmbassyAccount): EmbassyAccount {
  return { ...acc, status: 'declined' }
}

/** The player has written down their recovery code — stop holding the secret locally. */
export function acknowledgeRecovery(acc: EmbassyAccount): EmbassyAccount {
  return acc.recoveryCode === null ? acc : { ...acc, recoveryCode: null }
}

/** Re-bind after /recover on a new install/device: a fresh token (+ the handle the code resolved to). */
export function applyRecovery(acc: EmbassyAccount, token: string, handle: string): EmbassyAccount {
  return { ...acc, status: 'registered', token, handle }
}

/** Is this account allowed to make authed calls (has consented + holds a token)? */
export function isRegistered(acc: EmbassyAccount): boolean {
  return acc.status === 'registered' && !!acc.token
}

// ---- best-effort I/O (browser localStorage; no-ops + in-memory in the node test env) ----

let cache: EmbassyAccount | null = null

/** Load the account, or mint + persist a fresh one on first run (the write-once fingerprint is born
 *  here). Cached in-memory so repeated calls are stable even when storage is unavailable. */
export function initAccount(): EmbassyAccount {
  if (cache) return cache
  let acc: EmbassyAccount | null = null
  try {
    acc = parseAccount(localStorage.getItem(KEY))
  } catch {
    acc = null
  }
  if (!acc) {
    acc = freshAccount()
    cache = acc
    saveAccount(acc)
    return acc
  }
  cache = acc
  return acc
}

/** The current account (initializing on first access). */
export function loadAccount(): EmbassyAccount {
  return cache ?? initAccount()
}

/** Persist + update the in-memory cache (best-effort; a storage failure is non-fatal). */
export function saveAccount(acc: EmbassyAccount): void {
  cache = acc
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: SCHEMA_V, account: acc }))
  } catch {
    /* private mode / quota — the in-memory account still works this session */
  }
}

/** load → transform → save convenience (mirrors ui/save.ts wrappers). */
export function updateAccount(fn: (acc: EmbassyAccount) => EmbassyAccount): EmbassyAccount {
  const next = fn(loadAccount())
  saveAccount(next)
  return next
}

/** TEST-ONLY: drop the in-memory cache so a test starts from storage (or a fresh mint). */
export function __resetAccountCache(): void {
  cache = null
}
