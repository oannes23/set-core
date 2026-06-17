/* Generate JSON Schemas from src/data/schema.ts (the single source of truth for the content
   vocabulary). Emits:
     - content/schema.json            — the whole GameData (used by data/validate.ts in CI)
     - content/schemas/<name>.schema.json — one per YAML content file, for editor autocomplete
       (the `# yaml-language-server: $schema=…` header on each YAML file points at these).
   Run: pnpm gen:schema   (kept in sync by the drift guard in data/validate.test.ts). */
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createGenerator } from 'ts-json-schema-generator'

const here = dirname(fileURLToPath(import.meta.url))
const contentDir = join(here, '..', 'src', 'data', 'content')
const schemasDir = join(contentDir, 'schemas')
mkdirSync(schemasDir, { recursive: true })

const gen = (type: string, path = 'src/data/schema.ts'): unknown =>
  createGenerator({ path, type, tsconfig: 'tsconfig.json', skipTypeCheck: true }).createSchema(type)

const write = (path: string, schema: unknown): void => {
  writeFileSync(path, JSON.stringify(schema, null, 2) + '\n', 'utf8')
  console.log(`wrote ${path.replace(join(here, '..') + '/', '')}`)
}

// whole-GameData schema (validation gate)
write(join(contentDir, 'schema.json'), gen('GameData'))

// per-file schemas (editor autocomplete). Each maps a content/<file>.yaml to its root type + the
// source file that type lives in (defaults to schema.ts).
const FILES: Array<{ file: string; type: string; path?: string }> = [
  { file: 'traps', type: 'TrapsFile' }, { file: 'drifts', type: 'DriftsFile' },
  { file: 'creatures', type: 'CreaturesFile' }, { file: 'variants', type: 'VariantsFile' },
  { file: 'templates', type: 'TemplatesFile' }, { file: 'dungeons', type: 'DungeonsFile' },
  { file: 'encounter', type: 'EncounterFile' }, { file: 'classes', type: 'ClassesFile' },
  { file: 'gear', type: 'GearFile', path: 'src/data/gear.ts' },
  { file: 'loot', type: 'LootFile', path: 'src/engine/loot.ts' },
  { file: 'economy', type: 'EconomyFile', path: 'src/engine/economy.ts' },
  { file: 'affixes', type: 'AffixFile', path: 'src/data/affixes.ts' },
  { file: 'progression', type: 'ProgressionFile', path: 'src/engine/progression.ts' },
  { file: 'delve', type: 'DelveFile', path: 'src/engine/delve.ts' },
]
for (const { file, type, path } of FILES) write(join(schemasDir, `${file}.schema.json`), gen(type, path))
