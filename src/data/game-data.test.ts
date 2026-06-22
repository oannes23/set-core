/* CONTENT REGRESSION snapshot: the YAML-sourced GAMEDATA must deep-equal the captured fixture in
   __fixtures__/gamedata.snapshot.json. Originally the round-trip oracle for the one-time YAML
   migration (it guarded the TS-literal → YAML conversion against folded-scalar whitespace / number
   coercion); that migration is complete, so it now serves as a coarse guard against ACCIDENTAL edits
   to existing content. When you deliberately add or change content, regenerate the fixture (write
   JSON.stringify(GAMEDATA) to the path) — the schema (validate.test.ts) and referential-integrity
   (registry.test.ts `linkErrors`, run at load inside buildRegistry) checks are the real correctness
   guards; this one just flags unintended drift. */

import { test, expect } from 'vitest'
import { GAMEDATA } from './game-data'
import snapshot from './__fixtures__/gamedata.snapshot.json'

test('YAML-sourced GAMEDATA matches the captured content snapshot', () => {
  expect(GAMEDATA).toEqual(snapshot)
})
