/* ui/prefs — the fresh-save funnel decisions + the preference store. localStorage I/O is best-effort
   (try/catch), so the store works in-memory in the node test env, exactly like ui/dev. */
import { describe, it, expect, beforeEach } from 'vitest'
import { getPrefs, setPref, bootRoute, showQuestCue } from './prefs'

describe('bootRoute — the fresh-save funnel gate', () => {
  it('funnels ONLY a brand-new player (no heroes AND tutorial never run)', () => {
    expect(bootRoute(0, false)).toBe('funnel')
  })
  it('sends everyone else to town', () => {
    expect(bootRoute(0, true)).toBe('town') // returning player who deleted all heroes → no re-funnel
    expect(bootRoute(1, false)).toBe('town') // has a hero already (e.g. legacy save pre-flag)
    expect(bootRoute(3, true)).toBe('town')
  })
})

describe('showQuestCue — the one-time "next: Goblin Warren" town cue', () => {
  it('shows right after the tutorial, once, with a hero to send', () => {
    expect(showQuestCue(true, false, true)).toBe(true)
  })
  it('is suppressed once dismissed, before the tutorial, or with no hero', () => {
    expect(showQuestCue(true, true, true)).toBe(false) // already seen
    expect(showQuestCue(false, false, true)).toBe(false) // tutorial not run yet
    expect(showQuestCue(true, false, false)).toBe(false) // no active hero
  })
})

describe('preference store — in-memory round-trip', () => {
  beforeEach(() => { setPref('tutorialSeen', false); setPref('questCueSeen', false); setPref('colorblind', false) })

  it('defaults to false and persists sets', () => {
    expect(getPrefs()).toEqual({ tutorialSeen: false, questCueSeen: false, colorblind: false })
    setPref('tutorialSeen', true)
    expect(getPrefs().tutorialSeen).toBe(true)
    expect(getPrefs().questCueSeen).toBe(false) // independent
    expect(getPrefs().colorblind).toBe(false) // independent
  })

  it('returns a copy (callers cannot mutate the cache)', () => {
    const p = getPrefs()
    p.tutorialSeen = true
    expect(getPrefs().tutorialSeen).toBe(false)
  })
})
