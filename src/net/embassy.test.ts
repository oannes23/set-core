/* flushOutbox recovery (N3) — the I/O orchestration around the pure outbox transforms, driven with a
   stubbed fetch + localStorage. Covers the branches the pure tests can't: 413 → bisect → success, and a
   401/403 → error:'auth' (a rotated token must surface, not silently stall forever). */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushOutbox } from './embassy'
import { setEnabled, setServerUrl } from './config'
import { updateAccount, markRegistered, __resetAccountCache } from './account'
import { enqueueRecord, loadOutbox } from './outbox'
import type { RunRecord } from './contract'

class MemStorage {
  store = new Map<string, string>()
  getItem(k: string): string | null { return this.store.has(k) ? this.store.get(k)! : null }
  setItem(k: string, v: string): void { this.store.set(k, String(v)) }
  removeItem(k: string): void { this.store.delete(k) }
  clear(): void { this.store.clear() }
}

const rec = (id: string): RunRecord => ({
  eventId: id, fingerprint: 'fp', schemaVersion: 1, rulesetVersion: 'r', contentVersion: 'c',
  integrity: { modded: false, manifestHash: null },
  context: { kind: 'delve', dailyDate: null, classId: 'c', foeId: null, seed: '1', specRef: 's' },
  outcome: { result: 'win', terms: 1, realTimeMs: null, depthReached: null }, actions: [], instruments: {},
})

const mockRes = (status: number, body: unknown): Response => ({
  ok: status >= 200 && status < 300, status,
  json: async () => body, text: async () => JSON.stringify(body),
} as unknown as Response)

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemStorage())
  __resetAccountCache()
  setEnabled(true)
  setServerUrl('https://embassy.test')
  updateAccount((a) => markRegistered(a, { handle: 'h', token: 'tok', recoveryCode: 'rc', at: 0 }))
})
afterEach(() => vi.unstubAllGlobals())

describe('flushOutbox — N3 recovery', () => {
  it('bisects the batch on a 413 down to a single record that succeeds (no infinite loop, no record loss)', async () => {
    for (const id of ['a', 'b', 'c', 'd']) enqueueRecord(rec(id))
    // 413 for any multi-record batch; 200 accepting the batch once it's a single record.
    vi.stubGlobal('fetch', vi.fn(async (_url: string, opts: { body: string }) => {
      const { records } = JSON.parse(opts.body) as { records: RunRecord[] }
      return records.length > 1 ? mockRes(413, { detail: 'too large' }) : mockRes(200, { accepted: records.map((r) => r.eventId), rejected: [] })
    }))
    const r = await flushOutbox()
    expect(r.attempted).toBe(1) // bisected 4 → 2 → 1
    expect(r.accepted).toBe(1)
    expect(r.remaining).toBe(3) // the other three survive for the next pass
    expect(loadOutbox().map((x) => x.eventId)).toEqual(['b', 'c', 'd']) // 'a' pruned, order preserved
    expect(r.error).toBeUndefined()
  })

  it('surfaces a 403 (rotated/invalid token) as error:auth WITHOUT dropping any records', async () => {
    for (const id of ['a', 'b']) enqueueRecord(rec(id))
    vi.stubGlobal('fetch', vi.fn(async () => mockRes(403, { detail: 'bad token' })))
    const r = await flushOutbox()
    expect(r.error).toBe('auth')
    expect(r.status).toBe(403)
    expect(r.accepted).toBe(0)
    expect(loadOutbox()).toHaveLength(2) // nothing lost — the queue is intact for a re-link
  })

  it('flushes cleanly on a 200 and prunes the accepted records', async () => {
    for (const id of ['a', 'b']) enqueueRecord(rec(id))
    vi.stubGlobal('fetch', vi.fn(async (_url: string, opts: { body: string }) => {
      const { records } = JSON.parse(opts.body) as { records: RunRecord[] }
      return mockRes(200, { accepted: records.map((r) => r.eventId), rejected: [] })
    }))
    const r = await flushOutbox()
    expect(r.accepted).toBe(2)
    expect(r.remaining).toBe(0)
    expect(loadOutbox()).toHaveLength(0)
  })
})
