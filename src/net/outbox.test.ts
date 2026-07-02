/* The pure outbox queue transforms (no localStorage I/O here). */
import { describe, it, expect } from 'vitest'
import { applyIngestResult, capOutbox, enqueue, MAX_BATCH, OUTBOX_MAX_RECORDS, partitionRejections, parseOutbox, peekBatch, peekBatchByBytes, pruneAccepted, pruneTerminal, recordBytes } from './outbox'
import type { IngestRejection, RunRecord } from './contract'

const rec = (eventId: string, pad = 0): RunRecord => ({
  eventId,
  fingerprint: 'fp',
  schemaVersion: 1,
  rulesetVersion: 'r1',
  contentVersion: 'c1',
  integrity: { modded: false, manifestHash: null },
  context: { kind: 'delve', dailyDate: null, classId: 'c', foeId: null, seed: '1', specRef: 's' },
  outcome: { result: 'win', terms: 1, realTimeMs: null, depthReached: null },
  actions: pad > 0 ? [{ type: 'tick', dtMs: pad }] : [], // `pad` inflates the serialized size for byte-cap tests
  instruments: pad > 1 ? { blob: 'x'.repeat(pad) } : {},
})

describe('capOutbox (N1 — bound the local queue)', () => {
  it('evicts OLDEST beyond the record count cap', () => {
    const q = Array.from({ length: OUTBOX_MAX_RECORDS + 5 }, (_, i) => rec(`e${i}`))
    const capped = capOutbox(q)
    expect(capped).toHaveLength(OUTBOX_MAX_RECORDS)
    expect(capped[0].eventId).toBe('e5') // e0..e4 evicted (oldest-first)
    expect(capped[capped.length - 1].eventId).toBe(`e${OUTBOX_MAX_RECORDS + 4}`) // newest kept
  })
  it('trims oldest until under the byte cap, always keeping the newest', () => {
    const big = [rec('a', 5000), rec('b', 5000), rec('c', 5000)]
    const capped = capOutbox(big, 100, 8000) // ~5KB each, 8KB budget → only the newest 1 fits
    expect(capped.map((r) => r.eventId)).toEqual(['c'])
  })
  it('keeps at least the newest record even if it alone exceeds the byte cap', () => {
    expect(capOutbox([rec('a', 100), rec('huge', 50000)], 100, 1000).map((r) => r.eventId)).toEqual(['huge'])
  })
  it('is a no-op when already under both caps', () => {
    const q = [rec('a'), rec('b')]
    expect(capOutbox(q).map((r) => r.eventId)).toEqual(['a', 'b'])
  })
})

describe('peekBatchByBytes (N3 — byte-bounded flush batch)', () => {
  it('stops before exceeding the byte budget but always takes at least one', () => {
    const q = [rec('a', 5000), rec('b', 5000), rec('c', 5000)]
    expect(peekBatchByBytes(q, 8000).map((r) => r.eventId)).toEqual(['a']) // a fits; a+b would exceed
  })
  it('takes a single oversized record rather than stalling on it', () => {
    expect(peekBatchByBytes([rec('huge', 50000), rec('b')], 1000).map((r) => r.eventId)).toEqual(['huge'])
  })
  it('respects the count cap too', () => {
    const q = Array.from({ length: 5 }, (_, i) => rec(`e${i}`))
    expect(peekBatchByBytes(q, 1e9, 3)).toHaveLength(3)
  })
})

describe('recordBytes', () => {
  it('grows with the action-log payload (the tick log dominates)', () => {
    expect(recordBytes(rec('a', 5000))).toBeGreaterThan(recordBytes(rec('a')))
  })
})

describe('enqueue (idempotent)', () => {
  it('appends a new record', () => {
    const q = enqueue([rec('a')], rec('b'))
    expect(q.map((r) => r.eventId)).toEqual(['a', 'b'])
  })
  it('replaces (not duplicates) a record with a known eventId, preserving position', () => {
    const updated = { ...rec('a'), instruments: { setsMatched: 5 } }
    const q = enqueue([rec('a'), rec('b')], updated)
    expect(q.map((r) => r.eventId)).toEqual(['a', 'b'])
    expect(q[0].instruments).toEqual({ setsMatched: 5 })
  })
})

describe('pruneAccepted', () => {
  it('drops accepted ids, keeps the rest', () => {
    const q = pruneAccepted([rec('a'), rec('b'), rec('c')], ['a', 'c'])
    expect(q.map((r) => r.eventId)).toEqual(['b'])
  })
  it('is a no-op for an empty accepted list', () => {
    expect(pruneAccepted([rec('a')], []).map((r) => r.eventId)).toEqual(['a'])
  })
})

describe('partitionRejections', () => {
  it('branches on the authoritative `terminal` boolean when present', () => {
    const rejections: IngestRejection[] = [
      { eventId: 'a', reason: 'modded', terminal: true },
      { eventId: 'b', reason: 'busy', terminal: false }, // a future soft reject → retryable
      { eventId: 'c', reason: 'missing-version', terminal: true },
    ]
    const { terminal, retryable } = partitionRejections(rejections)
    expect(terminal.map((r) => r.eventId).sort()).toEqual(['a', 'c'])
    expect(retryable.map((r) => r.eventId)).toEqual(['b'])
  })
  it('falls back to the reason set for a flag-less (legacy) rejection', () => {
    const rejections: IngestRejection[] = [
      { eventId: 'a', reason: 'modded' }, // known-terminal reason → terminal
      { eventId: 'b', reason: 'rate-limited' }, // unknown + no flag → retryable
    ]
    const { terminal, retryable } = partitionRejections(rejections)
    expect(terminal.map((r) => r.eventId)).toEqual(['a'])
    expect(retryable.map((r) => r.eventId)).toEqual(['b'])
  })
})

describe('pruneTerminal', () => {
  it('drops terminally-rejected records, keeps retryable ones queued', () => {
    const q = pruneTerminal([rec('a'), rec('b')], [
      { eventId: 'a', reason: 'fingerprint-mismatch' },
      { eventId: 'b', reason: 'transient-x' },
    ])
    expect(q.map((r) => r.eventId)).toEqual(['b'])
  })
})

describe('applyIngestResult', () => {
  it('drops accepted + terminal, keeps retryable for the next flush', () => {
    const q = applyIngestResult(
      [rec('a'), rec('b'), rec('c'), rec('d')],
      ['a'],
      [
        { eventId: 'b', reason: 'modded' }, // terminal → drop
        { eventId: 'c', reason: 'busy' }, // retryable → keep
      ],
    )
    expect(q.map((r) => r.eventId).sort()).toEqual(['c', 'd'])
  })
})

describe('peekBatch', () => {
  it('caps at MAX_BATCH and is FIFO', () => {
    const many = Array.from({ length: MAX_BATCH + 5 }, (_, i) => rec(`e${i}`))
    const batch = peekBatch(many)
    expect(batch).toHaveLength(MAX_BATCH)
    expect(batch[0].eventId).toBe('e0')
  })
})

describe('parseOutbox', () => {
  it('returns [] for null / garbage / a non-envelope', () => {
    expect(parseOutbox(null)).toEqual([])
    expect(parseOutbox('not json')).toEqual([])
    expect(parseOutbox(JSON.stringify({ nope: 1 }))).toEqual([])
  })
  it('reads a valid envelope and filters records missing an eventId', () => {
    const raw = JSON.stringify({ v: 1, records: [rec('a'), { fingerprint: 'x' }, rec('b')] })
    expect(parseOutbox(raw).map((r) => r.eventId)).toEqual(['a', 'b'])
  })
})
