/* The pure Embassy view-state (no DOM). */
import { describe, it, expect } from 'vitest'
import { canRegister, canViewRecords, embassyGate, embassyView, fingerprintShort } from './embassy-status'
import { freshAccount, markDeclined, markRegistered, type EmbassyAccount } from './account'
import type { EmbassyConfig } from './config'

const cfg = (over: Partial<EmbassyConfig> = {}): EmbassyConfig => ({ enabled: true, serverUrl: 'https://x', modded: false, ...over })
const registered = (): EmbassyAccount => markRegistered(freshAccount('fp-abc123def456'), { handle: 'Ash', token: 't', recoveryCode: 'r', at: 1 })

describe('fingerprintShort', () => {
  it('returns the uppercased tail without dashes', () => {
    expect(fingerprintShort('aaaa-bbbb-cccc-d1e2f3')).toBe('D1E2F3')
  })
  it('handles an empty fingerprint', () => {
    expect(fingerprintShort('')).toBe('—')
  })
})

describe('embassyGate', () => {
  it('is modded when the game is modded (even if otherwise reachable)', () => {
    expect(embassyGate(cfg({ modded: true }))).toBe('modded')
  })
  it('is no-server when disabled or URL-less', () => {
    expect(embassyGate(cfg({ enabled: false }))).toBe('no-server')
    expect(embassyGate(cfg({ serverUrl: '' }))).toBe('no-server')
  })
  it('is open when enabled + a URL + unmodded', () => {
    expect(embassyGate(cfg())).toBe('open')
  })
})

describe('embassyView', () => {
  it('reflects an anonymous local-only player', () => {
    const v = embassyView(freshAccount('fp-zzz999'), cfg({ enabled: false }), 3)
    expect(v).toMatchObject({ gate: 'no-server', status: 'anonymous', handle: null, pendingUploads: 3 })
    expect(canRegister(v)).toBe(false) // no server
  })
  it('reflects a registered, connected player who can view records', () => {
    const v = embassyView(registered(), cfg(), 0)
    expect(v).toMatchObject({ gate: 'open', status: 'registered', handle: 'Ash' })
    expect(canRegister(v)).toBe(false) // already registered
    expect(canViewRecords(v)).toBe(true)
  })
  it('lets a connected anonymous player register', () => {
    expect(canRegister(embassyView(freshAccount('f'), cfg(), 0))).toBe(true)
  })
  it('lets a declined player re-open registration when connected', () => {
    const v = embassyView(markDeclined(freshAccount('f')), cfg(), 0)
    expect(v.status).toBe('declined')
    expect(canRegister(v)).toBe(true)
  })
  it('clamps a negative pending count', () => {
    expect(embassyView(freshAccount('f'), cfg(), -5).pendingUploads).toBe(0)
  })
})
