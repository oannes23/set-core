/* The pure outbox queue transforms (no localStorage I/O here). */
import { describe, it, expect } from 'vitest'
import { applyIngestResult, enqueue, MAX_BATCH, partitionRejections, parseOutbox, peekBatch, pruneAccepted, pruneTerminal } from './outbox'
import type { IngestRejection, RunRecord } from './contract'

const rec = (eventId: string): RunRecord => ({
  eventId,
  fingerprint: 'fp',
  schemaVersion: 1,
  rulesetVersion: 'r1',
  contentVersion: 'c1',
  integrity: { modded: false, manifestHash: null },
  context: { kind: 'delve', dailyDate: null, classId: 'c', foeId: null, seed: '1', specRef: 's' },
  outcome: { result: 'win', terms: 1, realTimeMs: null, depthReached: null },
  actions: [],
  instruments: {},
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
  it('splits terminal (modded/missing-version/fingerprint-mismatch) from retryable', () => {
    const rejections: IngestRejection[] = [
      { eventId: 'a', reason: 'modded' },
      { eventId: 'b', reason: 'rate-limited' }, // unknown → retryable? no: unknown is terminal-safe
      { eventId: 'c', reason: 'missing-version' },
    ]
    const { terminal, retryable } = partitionRejections(rejections)
    // 'modded' + 'missing-version' are terminal; an unknown reason is NOT in the terminal set → retryable.
    expect(terminal.map((r) => r.eventId).sort()).toEqual(['a', 'c'])
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
