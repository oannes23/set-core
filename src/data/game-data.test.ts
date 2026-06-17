/* The ROUND-TRIP oracle for the YAML migration: the YAML-sourced GAMEDATA must deep-equal the
   pre-migration literal, captured in __fixtures__/gamedata.snapshot.json. This guards the mechanical
   TS-literal → YAML conversion against any drift (folded-scalar whitespace, number/string coercion).

   (Referential integrity — every creature/dungeon/encounter id resolves — now lives in registry.ts
   `linkErrors` and runs at load time inside buildRegistry; it is exercised by registry.test.ts. The
   per-creature statline shape is covered by validate.test.ts against the generated schema.) */

import { test, expect } from 'vitest'
import { GAMEDATA } from './game-data'
import snapshot from './__fixtures__/gamedata.snapshot.json'

test('YAML-sourced GAMEDATA matches the pre-migration snapshot', () => {
  expect(GAMEDATA).toEqual(snapshot)
})
