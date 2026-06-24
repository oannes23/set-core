/* The pure account-identity transforms (no localStorage I/O here). */
import { describe, it, expect } from 'vitest'
import {
  acknowledgeRecovery,
  applyRecovery,
  ensureFingerprint,
  freshAccount,
  isRegistered,
  markDeclined,
  markRegistered,
  parseAccount,
  sanitizeAccount,
} from './account'
import { CONSENT_VERSION } from './contract'

describe('freshAccount', () => {
  it('mints an anonymous account with a fingerprint and nothing else', () => {
    const a = freshAccount('fp-1')
    expect(a).toEqual({ fingerprint: 'fp-1', status: 'anonymous', handle: null, token: null, recoveryCode: null, consent: null })
  })
})

describe('ensureFingerprint (write-once)', () => {
  it('keeps an existing fingerprint untouched', () => {
    const a = freshAccount('keep')
    expect(ensureFingerprint(a, () => 'new').fingerprint).toBe('keep')
  })
  it('mints one only when missing', () => {
    const a = { ...freshAccount(''), fingerprint: '' }
    expect(ensureFingerprint(a, () => 'minted').fingerprint).toBe('minted')
  })
})

describe('sanitizeAccount', () => {
  it('fills defaults + regenerates a missing fingerprint (never crashes without one)', () => {
    const a = sanitizeAccount({})
    expect(a.fingerprint).toBeTruthy()
    expect(a.status).toBe('anonymous')
  })
  it('drops an unknown status back to anonymous and preserves a valid consent record', () => {
    const a = sanitizeAccount({ fingerprint: 'f', status: 'bogus', consent: { version: '1', at: 5 } })
    expect(a.status).toBe('anonymous')
    expect(a.consent).toEqual({ version: '1', at: 5 })
  })
  it('blanks empty-string fields to null', () => {
    const a = sanitizeAccount({ fingerprint: 'f', handle: '', token: '' })
    expect(a.handle).toBeNull()
    expect(a.token).toBeNull()
  })
})

describe('parseAccount', () => {
  it('returns null for no stored payload (caller mints fresh)', () => {
    expect(parseAccount(null)).toBeNull()
    expect(parseAccount('')).toBeNull()
  })
  it('reads a valid envelope', () => {
    const raw = JSON.stringify({ v: 1, account: freshAccount('fp-2') })
    expect(parseAccount(raw)?.fingerprint).toBe('fp-2')
  })
  it('returns null on garbage / a non-envelope', () => {
    expect(parseAccount('nope')).toBeNull()
    expect(parseAccount(JSON.stringify({ account: {} }))).toBeNull()
  })
})

describe('lifecycle transforms', () => {
  it('markRegistered records consent + handle + token + recovery code', () => {
    const a = markRegistered(freshAccount('f'), { handle: 'Ash', token: 'tok', recoveryCode: 'a-b-c-d', at: 100 })
    expect(a.status).toBe('registered')
    expect(a.handle).toBe('Ash')
    expect(a.token).toBe('tok')
    expect(a.recoveryCode).toBe('a-b-c-d')
    expect(a.consent).toEqual({ version: CONSENT_VERSION, at: 100 })
    expect(isRegistered(a)).toBe(true)
  })
  it('markDeclined closes the Embassy but keeps the fingerprint', () => {
    const a = markDeclined(freshAccount('f'))
    expect(a.status).toBe('declined')
    expect(a.fingerprint).toBe('f')
    expect(isRegistered(a)).toBe(false)
  })
  it('acknowledgeRecovery clears the held recovery code', () => {
    const reg = markRegistered(freshAccount('f'), { handle: 'Ash', token: 't', recoveryCode: 'secret', at: 1 })
    expect(acknowledgeRecovery(reg).recoveryCode).toBeNull()
  })
  it('applyRecovery re-binds a fresh token + handle and marks registered', () => {
    const a = applyRecovery(freshAccount('new-device-fp'), 'tok2', 'Ash')
    expect(a.status).toBe('registered')
    expect(a.token).toBe('tok2')
    expect(a.handle).toBe('Ash')
  })
  it('isRegistered requires BOTH registered status and a token', () => {
    expect(isRegistered({ ...freshAccount('f'), status: 'registered', token: null })).toBe(false)
  })
})
