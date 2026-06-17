/* validate.ts — ajv schema validation derived from schema.ts (build/test-only).
   Also guards that the committed content/schema.json has not drifted from schema.ts. */
import { test, expect } from 'vitest'
import { createGenerator } from 'ts-json-schema-generator'
import { GAMEDATA } from './game-data'
import { validateGameData } from './validate'
import committedSchema from './content/schema.json'

test('the real content passes schema validation', () => {
  const r = validateGameData(GAMEDATA)
  if (!r.ok) throw new Error('expected valid, got:\n' + r.errors.join('\n'))
  expect(r.ok).toBe(true)
})

test('a bad token value (wrong axis vocabulary) is rejected', () => {
  const bad = JSON.parse(JSON.stringify(GAMEDATA))
  // {axis:'color', value:'move'} is incoherent — move is a shape token, not a color.
  const tid = Object.keys(bad.traps).find((id: string) => bad.traps[id].when?.axis === 'color' && bad.traps[id].when?.value) as string
  bad.traps[tid].when.value = 'move'
  const r = validateGameData(bad)
  expect(r.ok).toBe(false)
})

test('a structurally malformed creature (missing stats) is rejected', () => {
  const bad = JSON.parse(JSON.stringify(GAMEDATA))
  const cid = Object.keys(bad.creatures)[0]
  delete bad.creatures[cid].stats
  expect(validateGameData(bad).ok).toBe(false)
})

const gen = (type: string, path = 'src/data/schema.ts'): unknown =>
  createGenerator({ path, type, tsconfig: 'tsconfig.json', skipTypeCheck: true }).createSchema(type)

test('committed schema.json matches schema.ts (no drift — run `pnpm gen:schema`)', () => {
  expect(gen('GameData')).toEqual(committedSchema)
})

// the per-file editor schemas (the `$schema` header targets) must also stay fresh. Mirrors the
// FILES table in scripts/gen-schema.ts (file → root type → source file).
const PER_FILE: Array<{ file: string; type: string; path?: string }> = [
  { file: 'traps', type: 'TrapsFile' }, { file: 'drifts', type: 'DriftsFile' },
  { file: 'creatures', type: 'CreaturesFile' }, { file: 'variants', type: 'VariantsFile' },
  { file: 'templates', type: 'TemplatesFile' }, { file: 'dungeons', type: 'DungeonsFile' },
  { file: 'encounter', type: 'EncounterFile' }, { file: 'classes', type: 'ClassesFile' },
  { file: 'gear', type: 'GearFile', path: 'src/data/gear.ts' },
  { file: 'loot', type: 'LootFile', path: 'src/engine/loot.ts' },
  { file: 'economy', type: 'EconomyFile', path: 'src/engine/economy.ts' },
]
for (const { file, type, path } of PER_FILE) {
  test(`committed schemas/${file}.schema.json matches its type`, async () => {
    const committed = (await import(`./content/schemas/${file}.schema.json`)).default
    expect(gen(type, path)).toEqual(committed)
  })
}
